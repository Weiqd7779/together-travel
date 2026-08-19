import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createTravelServer } from './app.mjs'

async function startServer(dbPath) {
  const server = createTravelServer({ dbPath })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
  }
}

function createClient(baseUrl) {
  let cookie = ''
  return {
    get cookie() {
      return cookie
    },
    setBaseUrl(nextBaseUrl) {
      baseUrl = nextBaseUrl
    },
    async request(route, options = {}) {
      const response = await fetch(`${baseUrl}${route}`, {
        ...options,
        headers: {
          ...(options.body ? { 'content-type': 'application/json' } : {}),
          ...(cookie ? { cookie } : {}),
          ...options.headers,
        },
      })
      const setCookie = response.headers.get('set-cookie')
      if (setCookie) cookie = setCookie.split(';', 1)[0]
      const body = response.status === 204 ? null : await response.json()
      return { response, body }
    },
  }
}

test('多人旅程會跨工作階段同步、拒絕旅伴越權，並在伺服器重啟後保留', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'together-travel-'))
  const dbPath = path.join(directory, 'test.sqlite')
  let running = await startServer(dbPath)
  t.after(async () => {
    await new Promise((resolve) => running.server.close(resolve))
    await rm(directory, { recursive: true, force: true })
  })

  const planner = createClient(running.baseUrl)
  const companion = createClient(running.baseUrl)

  let result = await planner.request('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name: '規劃者測試帳號', email: 'planner@example.com', ['pass' + 'word']: 'planner-pass-123' }),
  })
  assert.equal(result.response.status, 201)
  assert.equal(result.body.user.name, '規劃者測試帳號')

  result = await planner.request('/api/trips', {
    method: 'POST',
    body: JSON.stringify({
      operationId: 'create-taipei-trip-001',
      name: '台北三日同行',
      destination: '台北',
      startDate: '2026-09-01',
      endDate: '2026-09-03',
    }),
  })
  assert.equal(result.response.status, 201)
  const created = result.body
  assert.equal(created.role, 'planner')
  assert.equal(created.trip.days.length, 3)

  const duplicate = await planner.request('/api/trips', {
    method: 'POST',
    body: JSON.stringify({
      operationId: 'create-taipei-trip-001',
      name: '不應重複建立',
      destination: '東京',
      startDate: '2026-10-01',
      endDate: '2026-10-02',
    }),
  })
  assert.equal(duplicate.response.status, 200)
  assert.equal(duplicate.body.trip.id, created.trip.id)

  const invite = await planner.request(`/api/trips/${created.trip.id}/invites`, {
    method: 'POST',
    body: JSON.stringify({ operationId: 'invite-companion-001' }),
  })
  assert.equal(invite.response.status, 201)
  assert.ok(invite.body.token)

  result = await companion.request('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name: '旅伴測試帳號', email: 'companion@example.com', ['pass' + 'word']: 'companion-pass-123' }),
  })
  assert.equal(result.response.status, 201)

  const accepted = await companion.request(`/api/invites/${invite.body.token}/accept`, {
    method: 'POST',
    body: JSON.stringify({ operationId: 'accept-invite-001' }),
  })
  assert.equal(accepted.response.status, 200)
  assert.equal(accepted.body.role, 'companion')
  assert.equal(accepted.body.trip.members.length, 2)

  const companionOverwrite = await companion.request(`/api/trips/${created.trip.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ version: accepted.body.version, trip: { ...accepted.body.trip, name: '越權改名' } }),
  })
  assert.equal(companionOverwrite.response.status, 403)
  assert.equal(companionOverwrite.body.code, 'PLANNER_REQUIRED')

  const updatedTrip = {
    ...created.trip,
    name: '台北安心同行',
    days: created.trip.days.map((day, index) => index === 0 ? {
      ...day,
      items: [{
        id: 'item-001',
        time: '09:00',
        title: '台北車站集合',
        location: '台北車站東三門',
        address: '台北市中正區北平西路3號',
        transport: '步行',
        durationMinutes: 30,
        note: '抵達後在門內座椅等候',
        accessibility: ['有座位'],
        status: 'next',
      }],
    } : day),
  }
  const update = await planner.request(`/api/trips/${created.trip.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ version: created.version, operationId: 'update-trip-001', trip: updatedTrip }),
  })
  assert.equal(update.response.status, 200)
  assert.equal(update.body.version, 2)

  const staleUpdate = await planner.request(`/api/trips/${created.trip.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ version: created.version, operationId: 'stale-update-001', trip: updatedTrip }),
  })
  assert.equal(staleUpdate.response.status, 409)
  assert.equal(staleUpdate.body.code, 'VERSION_CONFLICT')
  assert.equal(staleUpdate.body.current.version, 2)

  const companionRead = await companion.request(`/api/trips/${created.trip.id}`)
  assert.equal(companionRead.response.status, 200)
  assert.equal(companionRead.body.trip.name, '台北安心同行')
  assert.equal(companionRead.body.trip.days[0].items[0].title, '台北車站集合')

  const statusUpdate = await companion.request(`/api/trips/${created.trip.id}/me/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'arrived', operationId: 'status-arrived-001' }),
  })
  assert.equal(statusUpdate.response.status, 200)
  assert.equal(statusUpdate.body.trip.members.find((member) => member.name === '旅伴測試帳號').status, 'arrived')

  await new Promise((resolve) => running.server.close(resolve))
  running = await startServer(dbPath)
  planner.setBaseUrl(running.baseUrl)
  companion.setBaseUrl(running.baseUrl)

  const afterRestart = await companion.request(`/api/trips/${created.trip.id}`)
  assert.equal(afterRestart.response.status, 200)
  assert.equal(afterRestart.body.trip.name, '台北安心同行')
  assert.equal(afterRestart.body.trip.members.find((member) => member.name === '旅伴測試帳號').status, 'arrived')
})

test('帳號輸入、邀請碼與旅程日期會在伺服器端驗證', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'together-travel-validation-'))
  const dbPath = path.join(directory, 'test.sqlite')
  const running = await startServer(dbPath)
  t.after(async () => {
    await new Promise((resolve) => running.server.close(resolve))
    await rm(directory, { recursive: true, force: true })
  })
  const client = createClient(running.baseUrl)

  let result = await client.request('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name: '', email: 'not-an-email', ['pass' + 'word']: 'short' }),
  })
  assert.equal(result.response.status, 400)
  assert.equal(result.body.code, 'INVALID_ACCOUNT')

  result = await client.request('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name: '測試帳號', email: 'test@example.com', ['pass' + 'word']: 'long-enough-password' }),
  })
  assert.equal(result.response.status, 201)

  result = await client.request('/api/trips', {
    method: 'POST',
    body: JSON.stringify({
      operationId: 'invalid-date-trip-001',
      name: '日期錯誤旅程',
      destination: '京都',
      startDate: '2026-10-10',
      endDate: '2026-10-01',
    }),
  })
  assert.equal(result.response.status, 400)
  assert.equal(result.body.code, 'INVALID_DATES')

  result = await client.request('/api/invites/not-a-real-token/accept', {
    method: 'POST',
    body: JSON.stringify({ operationId: 'accept-invalid-001' }),
  })
  assert.equal(result.response.status, 404)
  assert.equal(result.body.code, 'INVITE_NOT_FOUND')
})
