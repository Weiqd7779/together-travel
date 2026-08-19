import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, extname, join, normalize, resolve } from 'node:path'
import { promisify } from 'node:util'
import http from 'node:http'
import { DatabaseSync } from 'node:sqlite'

const scrypt = promisify(scryptCallback)
const SESSION_COOKIE = 'together_session'
const SESSION_DAYS = 30
const MAX_BODY_BYTES = 1_000_000
const memberStatuses = new Set(['together', 'arrived', 'late', 'exploring'])

class ApiError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message)
    this.status = status
    this.code = code
    this.extra = extra
  }
}

function nowIso() {
  return new Date().toISOString()
}

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex')
}

function createToken() {
  return randomBytes(32).toString('base64url')
}

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map((part) => {
    const separator = part.indexOf('=')
    if (separator < 0) return ['', '']
    return [part.slice(0, separator).trim(), decodeURIComponent(part.slice(separator + 1).trim())]
  }).filter(([key]) => key))
}

function sessionCookie(token, request) {
  const secure = request.headers['x-forwarded-proto'] === 'https'
    || process.env.NODE_ENV === 'production' && request.socket.encrypted
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}${secure ? '; Secure' : ''}`
}

function clearSessionCookie() {
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`
}

function sendJson(response, status, payload, headers = {}) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'same-origin',
    ...headers,
  })
  response.end(JSON.stringify(payload))
}

async function readJson(request) {
  const contentType = request.headers['content-type'] ?? ''
  if (!contentType.toLowerCase().startsWith('application/json')) {
    throw new ApiError(415, 'JSON_REQUIRED', '請使用 JSON 格式送出資料。')
  }
  let size = 0
  const chunks = []
  for await (const chunk of request) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw new ApiError(413, 'BODY_TOO_LARGE', '送出的資料超過 1 MB。')
    chunks.push(chunk)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
  } catch {
    throw new ApiError(400, 'INVALID_JSON', '送出的資料格式無法讀取。')
  }
}

function assertSameOrigin(request) {
  const origin = request.headers.origin
  const host = request.headers.host
  if (!origin || !host) return
  try {
    if (new URL(origin).host !== host) {
      throw new ApiError(403, 'ORIGIN_REJECTED', '這個請求不是從同行 App 送出。')
    }
  } catch (error) {
    if (error instanceof ApiError) throw error
    throw new ApiError(403, 'ORIGIN_REJECTED', '無法確認請求來源。')
  }
}

function openDatabase(dbPath) {
  mkdirSync(dirname(dbPath), { recursive: true })
  const db = new DatabaseSync(dbPath)
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;')
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_salt TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS trips (
      id TEXT PRIMARY KEY,
      data_json TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS memberships (
      trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('planner', 'companion')),
      status TEXT NOT NULL DEFAULT 'together',
      joined_at TEXT NOT NULL,
      PRIMARY KEY (trip_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS invites (
      id TEXT PRIMARY KEY,
      trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      created_by TEXT NOT NULL REFERENCES users(id),
      expires_at TEXT NOT NULL,
      used_by TEXT REFERENCES users(id),
      used_at TEXT,
      revoked_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS operations (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      operation_id TEXT NOT NULL,
      action TEXT NOT NULL,
      status INTEGER NOT NULL,
      response_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (user_id, operation_id, action)
    );
    CREATE INDEX IF NOT EXISTS memberships_user_idx ON memberships(user_id);
    CREATE INDEX IF NOT EXISTS invites_trip_idx ON invites(trip_id);
  `)
  return db
}

function getSessionUser(db, request) {
  const token = parseCookies(request.headers.cookie)[SESSION_COOKIE]
  if (!token) return null
  const row = db.prepare(`
    SELECT users.id, users.name, users.email
    FROM sessions JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ?
  `).get(hashToken(token), nowIso())
  return row ?? null
}

function requireUser(db, request) {
  const user = getSessionUser(db, request)
  if (!user) throw new ApiError(401, 'AUTH_REQUIRED', '請先登入。')
  return user
}

function requireOperationId(value) {
  if (typeof value !== 'string' || value.length < 8 || value.length > 100 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new ApiError(400, 'OPERATION_ID_REQUIRED', '缺少有效的操作識別碼，請重新送出。')
  }
  return value
}

function readStoredOperation(db, userId, operationId, action) {
  const row = db.prepare('SELECT status, response_json FROM operations WHERE user_id = ? AND operation_id = ? AND action = ?')
    .get(userId, operationId, action)
  return row ? { status: row.status, payload: JSON.parse(row.response_json) } : null
}

function storeOperation(db, userId, operationId, action, status, payload) {
  db.prepare(`
    INSERT INTO operations (user_id, operation_id, action, status, response_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(userId, operationId, action, status, JSON.stringify(payload), nowIso())
}

function dateRange(startDate, endDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate ?? '') || !/^\d{4}-\d{2}-\d{2}$/.test(endDate ?? '')) return []
  const start = new Date(`${startDate}T00:00:00Z`)
  const end = new Date(`${endDate}T00:00:00Z`)
  if (Number.isNaN(start.valueOf()) || Number.isNaN(end.valueOf()) || end < start) return []
  const dates = []
  for (let date = start; date <= end && dates.length <= 30; date = new Date(date.valueOf() + 86400000)) {
    dates.push(date.toISOString().slice(0, 10))
  }
  return dates
}

function textField(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
}

function createEmptyTrip({ id, name, destination, startDate, endDate }) {
  return {
    id,
    name,
    destination,
    startDate,
    endDate,
    hotel: { name: '', address: '', phone: '' },
    emergencyContact: { name: '', relation: '', phone: '' },
    members: [],
    days: dateRange(startDate, endDate).map((date) => ({ date, items: [] })),
    alertDismissed: true,
    updatedAt: nowIso(),
  }
}

function validateTripInput(value, expectedId) {
  if (!value || typeof value !== 'object' || value.id !== expectedId) {
    throw new ApiError(400, 'INVALID_TRIP', '旅程資料不完整，請重新載入後再試。')
  }
  const name = textField(value.name, 80)
  const destination = textField(value.destination, 80)
  const dates = dateRange(value.startDate, value.endDate)
  if (!name || !destination) throw new ApiError(400, 'INVALID_TRIP', '請填寫旅程名稱與目的地。')
  if (dates.length === 0 || dates.length > 30) {
    throw new ApiError(400, 'INVALID_DATES', '旅程日期必須由早到晚，且最多 30 天。')
  }
  if (!Array.isArray(value.days) || value.days.length !== dates.length || value.days.some((day, index) => day?.date !== dates[index] || !Array.isArray(day.items))) {
    throw new ApiError(400, 'INVALID_TRIP_DAYS', '旅程天數和日期不一致，請重新載入後再試。')
  }
  for (const day of value.days) {
    for (const item of day.items) {
      if (!item || typeof item.id !== 'string' || !/^\d{2}:\d{2}$/.test(item.time ?? '') || !textField(item.title, 120)) {
        throw new ApiError(400, 'INVALID_ITINERARY_ITEM', '有一筆行程缺少時間或名稱，請檢查後再試。')
      }
    }
  }
  return {
    ...value,
    name,
    destination,
    startDate: value.startDate,
    endDate: value.endDate,
    members: [],
    updatedAt: nowIso(),
  }
}

function membershipFor(db, tripId, userId) {
  return db.prepare('SELECT role, status FROM memberships WHERE trip_id = ? AND user_id = ?').get(tripId, userId) ?? null
}

function tripResponse(db, tripId, userId) {
  const membership = membershipFor(db, tripId, userId)
  if (!membership) throw new ApiError(404, 'TRIP_NOT_FOUND', '找不到這趟旅程，或你尚未加入。')
  const row = db.prepare('SELECT data_json, version, updated_at FROM trips WHERE id = ?').get(tripId)
  if (!row) throw new ApiError(404, 'TRIP_NOT_FOUND', '找不到這趟旅程。')
  const members = db.prepare(`
    SELECT users.id, users.name, memberships.role, memberships.status
    FROM memberships JOIN users ON users.id = memberships.user_id
    WHERE memberships.trip_id = ?
    ORDER BY memberships.joined_at ASC
  `).all(tripId).map((member) => ({ ...member, phone: '' }))
  const trip = JSON.parse(row.data_json)
  return {
    trip: { ...trip, members, updatedAt: row.updated_at },
    version: row.version,
    role: membership.role,
  }
}

function listTrips(db, userId) {
  return db.prepare(`
    SELECT trips.id, trips.data_json, trips.version, trips.updated_at, memberships.role
    FROM memberships JOIN trips ON trips.id = memberships.trip_id
    WHERE memberships.user_id = ?
    ORDER BY trips.updated_at DESC
  `).all(userId).map((row) => {
    const trip = JSON.parse(row.data_json)
    return {
      id: row.id,
      name: trip.name,
      destination: trip.destination,
      startDate: trip.startDate,
      endDate: trip.endDate,
      updatedAt: row.updated_at,
      version: row.version,
      role: row.role,
    }
  })
}

async function createPasswordHash(password, salt = randomBytes(16).toString('hex')) {
  const hash = await scrypt(password, salt, 64)
  return { salt, hash: Buffer.from(hash).toString('hex') }
}

async function verifyPassword(password, salt, expectedHex) {
  const actual = Buffer.from(await scrypt(password, salt, 64))
  const expected = Buffer.from(expectedHex, 'hex')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

function createSession(db, userId) {
  const token = createToken()
  const createdAt = nowIso()
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString()
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
    .run(hashToken(token), userId, expiresAt, createdAt)
  return token
}

function publicUser(row) {
  return { id: row.id, name: row.name, email: row.email }
}

async function handleApi(request, response, db, url) {
  if (request.method !== 'GET') assertSameOrigin(request)

  if (request.method === 'GET' && url.pathname === '/api/health') {
    return sendJson(response, 200, { ok: true, storage: 'sqlite' })
  }

  if (request.method === 'POST' && url.pathname === '/api/auth/register') {
    const body = await readJson(request)
    const name = textField(body.name, 60)
    const email = textField(body.email, 254).toLowerCase()
    const password = typeof body.password === 'string' ? body.password : ''
    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 10 || password.length > 200) {
      throw new ApiError(400, 'INVALID_ACCOUNT', '請填寫姓名、有效的電子郵件，並設定至少 10 個字元的密碼。')
    }
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) {
      throw new ApiError(409, 'EMAIL_EXISTS', '這個電子郵件已經註冊，請直接登入。')
    }
    const id = randomUUID()
    const createdAt = nowIso()
    const passwordData = await createPasswordHash(password)
    db.prepare('INSERT INTO users (id, name, email, password_salt, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, name, email, passwordData.salt, passwordData.hash, createdAt)
    const token = createSession(db, id)
    return sendJson(response, 201, { user: { id, name, email }, trips: [] }, { 'set-cookie': sessionCookie(token, request) })
  }

  if (request.method === 'POST' && url.pathname === '/api/auth/login') {
    const body = await readJson(request)
    const email = textField(body.email, 254).toLowerCase()
    const password = typeof body.password === 'string' ? body.password : ''
    const row = db.prepare('SELECT * FROM users WHERE email = ?').get(email)
    if (!row || !await verifyPassword(password, row.password_salt, row.password_hash)) {
      throw new ApiError(401, 'LOGIN_FAILED', '電子郵件或密碼不正確。')
    }
    const token = createSession(db, row.id)
    return sendJson(response, 200, { user: publicUser(row), trips: listTrips(db, row.id) }, { 'set-cookie': sessionCookie(token, request) })
  }

  if (request.method === 'POST' && url.pathname === '/api/auth/logout') {
    const token = parseCookies(request.headers.cookie)[SESSION_COOKIE]
    if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token))
    return sendJson(response, 200, { ok: true }, { 'set-cookie': clearSessionCookie() })
  }

  if (request.method === 'GET' && url.pathname === '/api/session') {
    const user = requireUser(db, request)
    return sendJson(response, 200, { user: publicUser(user), trips: listTrips(db, user.id) })
  }

  if (request.method === 'GET' && url.pathname === '/api/trips') {
    const user = requireUser(db, request)
    return sendJson(response, 200, { trips: listTrips(db, user.id) })
  }

  if (request.method === 'POST' && url.pathname === '/api/trips') {
    const user = requireUser(db, request)
    const body = await readJson(request)
    const operationId = requireOperationId(body.operationId)
    const previous = readStoredOperation(db, user.id, operationId, 'create-trip')
    if (previous) return sendJson(response, 200, previous.payload)
    const name = textField(body.name, 80)
    const destination = textField(body.destination, 80)
    const dates = dateRange(body.startDate, body.endDate)
    if (!name || !destination) throw new ApiError(400, 'INVALID_TRIP', '請填寫旅程名稱與目的地。')
    if (dates.length === 0 || dates.length > 30) throw new ApiError(400, 'INVALID_DATES', '旅程日期必須由早到晚，且最多 30 天。')
    const id = randomUUID()
    const createdAt = nowIso()
    const trip = createEmptyTrip({ id, name, destination, startDate: body.startDate, endDate: body.endDate })
    db.exec('BEGIN IMMEDIATE')
    try {
      db.prepare('INSERT INTO trips (id, data_json, version, created_by, created_at, updated_at) VALUES (?, ?, 1, ?, ?, ?)')
        .run(id, JSON.stringify(trip), user.id, createdAt, createdAt)
      db.prepare("INSERT INTO memberships (trip_id, user_id, role, status, joined_at) VALUES (?, ?, 'planner', 'together', ?)")
        .run(id, user.id, createdAt)
      const payload = tripResponse(db, id, user.id)
      storeOperation(db, user.id, operationId, 'create-trip', 201, payload)
      db.exec('COMMIT')
      return sendJson(response, 201, payload)
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  const tripMatch = url.pathname.match(/^\/api\/trips\/([0-9a-f-]+)$/i)
  if (tripMatch && request.method === 'GET') {
    const user = requireUser(db, request)
    return sendJson(response, 200, tripResponse(db, tripMatch[1], user.id))
  }

  if (tripMatch && request.method === 'PATCH') {
    const user = requireUser(db, request)
    const tripId = tripMatch[1]
    const membership = membershipFor(db, tripId, user.id)
    if (!membership) throw new ApiError(404, 'TRIP_NOT_FOUND', '找不到這趟旅程，或你尚未加入。')
    if (membership.role !== 'planner') throw new ApiError(403, 'PLANNER_REQUIRED', '只有規劃者可以修改旅程。')
    const body = await readJson(request)
    const operationId = requireOperationId(body.operationId)
    const previous = readStoredOperation(db, user.id, operationId, `update-trip:${tripId}`)
    if (previous) return sendJson(response, previous.status, previous.payload)
    const version = Number(body.version)
    const trip = validateTripInput(body.trip, tripId)
    const updatedAt = nowIso()
    db.exec('BEGIN IMMEDIATE')
    try {
      const result = db.prepare('UPDATE trips SET data_json = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?')
        .run(JSON.stringify(trip), updatedAt, tripId, version)
      if (result.changes !== 1) {
        db.exec('ROLLBACK')
        const current = tripResponse(db, tripId, user.id)
        throw new ApiError(409, 'VERSION_CONFLICT', '旅程已由另一個工作階段更新，已載入最新內容。', { current })
      }
      const payload = tripResponse(db, tripId, user.id)
      storeOperation(db, user.id, operationId, `update-trip:${tripId}`, 200, payload)
      db.exec('COMMIT')
      return sendJson(response, 200, payload)
    } catch (error) {
      if (db.isTransaction) db.exec('ROLLBACK')
      throw error
    }
  }

  const inviteCreateMatch = url.pathname.match(/^\/api\/trips\/([0-9a-f-]+)\/invites$/i)
  if (inviteCreateMatch && request.method === 'POST') {
    const user = requireUser(db, request)
    const tripId = inviteCreateMatch[1]
    const membership = membershipFor(db, tripId, user.id)
    if (!membership) throw new ApiError(404, 'TRIP_NOT_FOUND', '找不到這趟旅程。')
    if (membership.role !== 'planner') throw new ApiError(403, 'PLANNER_REQUIRED', '只有規劃者可以邀請旅伴。')
    const body = await readJson(request)
    const operationId = requireOperationId(body.operationId)
    const previous = readStoredOperation(db, user.id, operationId, `create-invite:${tripId}`)
    if (previous) return sendJson(response, 200, previous.payload)
    const token = createToken()
    const createdAt = nowIso()
    const expiresAt = new Date(Date.now() + 7 * 86400000).toISOString()
    db.exec('BEGIN IMMEDIATE')
    try {
      db.prepare('INSERT INTO invites (id, trip_id, token_hash, created_by, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(randomUUID(), tripId, hashToken(token), user.id, expiresAt, createdAt)
      const payload = { token, expiresAt }
      storeOperation(db, user.id, operationId, `create-invite:${tripId}`, 201, payload)
      db.exec('COMMIT')
      return sendJson(response, 201, payload)
    } catch (error) {
      if (db.isTransaction) db.exec('ROLLBACK')
      throw error
    }
  }

  const inviteAcceptMatch = url.pathname.match(/^\/api\/invites\/([A-Za-z0-9_-]+)\/accept$/)
  if (inviteAcceptMatch && request.method === 'POST') {
    const user = requireUser(db, request)
    await readJson(request)
    const row = db.prepare('SELECT * FROM invites WHERE token_hash = ?').get(hashToken(inviteAcceptMatch[1]))
    if (!row) throw new ApiError(404, 'INVITE_NOT_FOUND', '邀請連結無效，請向規劃者索取新連結。')
    if (row.revoked_at || row.expires_at <= nowIso()) throw new ApiError(410, 'INVITE_EXPIRED', '邀請連結已過期，請向規劃者索取新連結。')
    if (row.used_by && row.used_by !== user.id) throw new ApiError(410, 'INVITE_USED', '這個邀請連結已被使用。')
    db.exec('BEGIN IMMEDIATE')
    try {
      db.prepare("INSERT OR IGNORE INTO memberships (trip_id, user_id, role, status, joined_at) VALUES (?, ?, 'companion', 'together', ?)")
        .run(row.trip_id, user.id, nowIso())
      if (!row.used_by) db.prepare('UPDATE invites SET used_by = ?, used_at = ? WHERE id = ?').run(user.id, nowIso(), row.id)
      const payload = tripResponse(db, row.trip_id, user.id)
      db.exec('COMMIT')
      return sendJson(response, 200, payload)
    } catch (error) {
      if (db.isTransaction) db.exec('ROLLBACK')
      throw error
    }
  }

  const statusMatch = url.pathname.match(/^\/api\/trips\/([0-9a-f-]+)\/me\/status$/i)
  if (statusMatch && request.method === 'PATCH') {
    const user = requireUser(db, request)
    const tripId = statusMatch[1]
    if (!membershipFor(db, tripId, user.id)) throw new ApiError(404, 'TRIP_NOT_FOUND', '找不到這趟旅程。')
    const body = await readJson(request)
    if (!memberStatuses.has(body.status)) throw new ApiError(400, 'INVALID_STATUS', '請選擇有效的旅伴狀態。')
    db.prepare('UPDATE memberships SET status = ? WHERE trip_id = ? AND user_id = ?').run(body.status, tripId, user.id)
    db.prepare('UPDATE trips SET updated_at = ? WHERE id = ?').run(nowIso(), tripId)
    return sendJson(response, 200, tripResponse(db, tripId, user.id))
  }

  throw new ApiError(404, 'NOT_FOUND', '找不到這個 API。')
}

function mimeType(filePath) {
  return ({
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.json': 'application/json; charset=utf-8',
    '.webmanifest': 'application/manifest+json; charset=utf-8',
  })[extname(filePath)] ?? 'application/octet-stream'
}

function serveStatic(response, staticDir, pathname) {
  if (!staticDir || !existsSync(staticDir)) {
    return sendJson(response, 503, { code: 'APP_NOT_BUILT', message: '尚未建立前端正式版，請先執行 npm run build。' })
  }
  const safePath = normalize(decodeURIComponent(pathname)).replace(/^(\.\.(\/|\\|$))+/, '')
  let filePath = resolve(staticDir, `.${safePath}`)
  const root = resolve(staticDir)
  if (!filePath.startsWith(root)) filePath = join(root, 'index.html')
  if (!existsSync(filePath) || statSync(filePath).isDirectory()) filePath = join(root, 'index.html')
  const cacheControl = filePath.endsWith('index.html') || filePath.endsWith('sw.js') || filePath.endsWith('manifest.webmanifest')
    ? 'no-cache'
    : 'public, max-age=31536000, immutable'
  response.writeHead(200, {
    'content-type': mimeType(filePath),
    'cache-control': cacheControl,
    'x-content-type-options': 'nosniff',
  })
  response.end(readFileSync(filePath))
}

export function createTravelServer({ dbPath, staticDir = null } = {}) {
  if (!dbPath) throw new Error('dbPath is required')
  const db = openDatabase(dbPath)
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)
    try {
      if (url.pathname.startsWith('/api/')) await handleApi(request, response, db, url)
      else serveStatic(response, staticDir, url.pathname)
    } catch (error) {
      if (response.headersSent) return response.end()
      if (error instanceof ApiError) {
        return sendJson(response, error.status, { code: error.code, message: error.message, ...error.extra })
      }
      console.error(error)
      return sendJson(response, 500, { code: 'SERVER_ERROR', message: '伺服器暫時無法完成操作，請稍後再試。' })
    }
  })
  server.on('close', () => db.close())
  return server
}
