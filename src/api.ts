import type { MemberStatus, Role, TripData } from './types'

export interface AccountUser {
  id: string
  name: string
  email: string
}

export interface TripSummaryRecord {
  id: string
  name: string
  destination: string
  startDate: string
  endDate: string
  updatedAt: string
  version: number
  role: Role
}

export interface TripRecord {
  trip: TripData
  version: number
  role: Role
}

export interface SessionRecord {
  user: AccountUser
  trips: TripSummaryRecord[]
}

interface ErrorPayload {
  code?: string
  message?: string
  current?: TripRecord
}

export class ApiError extends Error {
  status: number
  code: string
  current?: TripRecord

  constructor(status: number, payload: ErrorPayload) {
    super(payload.message || '目前無法連線到伺服器，請稍後再試。')
    this.status = status
    this.code = payload.code ?? 'REQUEST_FAILED'
    this.current = payload.current
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 12000)
  try {
    const response = await fetch(path, {
      ...init,
      credentials: 'same-origin',
      headers: {
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...init.headers,
      },
      signal: controller.signal,
    })
    const payload = await response.json().catch(() => ({})) as ErrorPayload
    if (!response.ok) throw new ApiError(response.status, payload)
    return payload as T
  } catch (error) {
    if (error instanceof ApiError) throw error
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ApiError(0, { code: 'TIMEOUT', message: '連線等候超過 12 秒，請確認網路後重試。' })
    }
    throw new ApiError(0, { code: 'NETWORK_ERROR', message: '目前連不到同行伺服器。已保存的旅程仍可離線查看。' })
  } finally {
    window.clearTimeout(timeout)
  }
}

function operationId(prefix: string) {
  const id = typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `${prefix}-${id}`
}

export const travelApi = {
  session: () => request<SessionRecord>('/api/session'),
  register: (input: { name: string; email: string; password: string }) => request<SessionRecord>('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify(input),
  }),
  login: (input: { email: string; password: string }) => request<SessionRecord>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify(input),
  }),
  logout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST', body: '{}' }),
  listTrips: () => request<{ trips: TripSummaryRecord[] }>('/api/trips'),
  getTrip: (tripId: string) => request<TripRecord>(`/api/trips/${encodeURIComponent(tripId)}`),
  createTrip: (input: { name: string; destination: string; startDate: string; endDate: string }) => request<TripRecord>('/api/trips', {
    method: 'POST',
    body: JSON.stringify({ ...input, operationId: operationId('create-trip') }),
  }),
  updateTrip: (record: TripRecord, trip: TripData) => request<TripRecord>(`/api/trips/${encodeURIComponent(trip.id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ version: record.version, trip, operationId: operationId('update-trip') }),
  }),
  createInvite: (tripId: string) => request<{ token: string; expiresAt: string }>(`/api/trips/${encodeURIComponent(tripId)}/invites`, {
    method: 'POST',
    body: JSON.stringify({ operationId: operationId('create-invite') }),
  }),
  acceptInvite: (token: string) => request<TripRecord>(`/api/invites/${encodeURIComponent(token)}/accept`, {
    method: 'POST',
    body: JSON.stringify({ operationId: operationId('accept-invite') }),
  }),
  updateMyStatus: (tripId: string, status: MemberStatus) => request<TripRecord>(`/api/trips/${encodeURIComponent(tripId)}/me/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status, operationId: operationId('update-status') }),
  }),
}
