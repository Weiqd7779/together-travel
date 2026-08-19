import { CalendarPlus, CheckCircle2, CircleAlert, Copy, LogIn, LogOut, RefreshCw, Share2, UserPlus, WifiOff } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import App from './App'
import { ApiError, travelApi, type AccountUser, type SessionRecord, type TripRecord, type TripSummaryRecord } from './api'
import { cacheTrip, forgetLastTrip, getCachedTrip, getLastTripId, rememberLastTrip } from './trip-cache'
import type { MemberStatus, TripData } from './types'

type AuthMode = 'login' | 'register'
type SyncState = 'saved' | 'saving' | 'offline' | 'conflict' | 'error'

function invitationToken() {
  return new URLSearchParams(window.location.search).get('invite')
}

function clearInvitationFromAddress() {
  const url = new URL(window.location.href)
  url.searchParams.delete('invite')
  window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`)
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '目前無法完成操作，請稍後再試。'
}

export default function AuthenticatedApp() {
  const [booting, setBooting] = useState(true)
  const [session, setSession] = useState<SessionRecord | null>(null)
  const [selected, setSelected] = useState<TripRecord | null>(null)
  const selectedRef = useRef<TripRecord | null>(null)
  const [offlineOnly, setOfflineOnly] = useState(false)
  const [syncState, setSyncState] = useState<SyncState>('saved')
  const [notice, setNotice] = useState('')
  const [invite, setInvite] = useState<{ link: string; expiresAt: string } | null>(null)

  useEffect(() => {
    selectedRef.current = selected
  }, [selected])

  const openTrip = useCallback(async (tripId: string, allowCache = true) => {
    if (allowCache) {
      const cached = await getCachedTrip(tripId)
      if (cached) {
        setSelected(cached)
        setSyncState(navigator.onLine ? 'saved' : 'offline')
      }
    }
    try {
      const record = await travelApi.getTrip(tripId)
      setSelected(record)
      selectedRef.current = record
      setOfflineOnly(false)
      setSyncState('saved')
      rememberLastTrip(record.trip.id)
      await cacheTrip(record)
      return record
    } catch (error) {
      const cached = allowCache ? await getCachedTrip(tripId) : null
      if (cached && error instanceof ApiError && error.status === 0) {
        setSelected(cached)
        selectedRef.current = cached
        setOfflineOnly(true)
        setSyncState('offline')
        return cached
      }
      throw error
    }
  }, [])

  const acceptPendingInvitation = useCallback(async () => {
    const token = invitationToken()
    if (!token) return null
    const record = await travelApi.acceptInvite(token)
    clearInvitationFromAddress()
    setSelected(record)
    selectedRef.current = record
    setSyncState('saved')
    rememberLastTrip(record.trip.id)
    await cacheTrip(record)
    setNotice(`已加入「${record.trip.name}」。`)
    return record
  }, [])

  useEffect(() => {
    let cancelled = false
    async function bootstrap() {
      try {
        const activeSession = await travelApi.session()
        if (cancelled) return
        setSession(activeSession)
        if (invitationToken()) {
          await acceptPendingInvitation()
        } else {
          const lastTripId = getLastTripId()
          if (lastTripId && activeSession.trips.some((trip) => trip.id === lastTripId)) {
            await openTrip(lastTripId)
          }
        }
      } catch (error) {
        if (cancelled) return
        if (error instanceof ApiError && error.status === 401) {
          setSession(null)
        } else {
          const lastTripId = getLastTripId()
          const cached = lastTripId ? await getCachedTrip(lastTripId) : null
          if (cached) {
            setSelected(cached)
            selectedRef.current = cached
            setOfflineOnly(true)
            setSyncState('offline')
          } else {
            setNotice(errorMessage(error))
          }
        }
      } finally {
        if (!cancelled) setBooting(false)
      }
    }
    void bootstrap()
    return () => { cancelled = true }
  }, [acceptPendingInvitation, openTrip])

  useEffect(() => {
    if (!selected) return
    const refresh = async () => {
      if (!navigator.onLine || syncState === 'saving') return
      try {
        if (!session) setSession(await travelApi.session())
        const record = await travelApi.getTrip(selected.trip.id)
        const current = selectedRef.current
        if (!current || record.version > current.version || offlineOnly) {
          setSelected(record)
          selectedRef.current = record
          setOfflineOnly(false)
          setSyncState('saved')
          await cacheTrip(record)
        }
      } catch (error) {
        if (error instanceof ApiError && error.status === 0) {
          setOfflineOnly(true)
          setSyncState('offline')
        }
      }
    }
    const timer = window.setInterval(() => void refresh(), 10000)
    window.addEventListener('focus', refresh)
    window.addEventListener('online', refresh)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', refresh)
      window.removeEventListener('online', refresh)
    }
  }, [offlineOnly, selected, session, syncState])

  async function handleAuthenticated(nextSession: SessionRecord) {
    setSession(nextSession)
    setNotice('')
    if (invitationToken()) {
      try {
        const joined = await acceptPendingInvitation()
        if (joined) {
          const list = await travelApi.listTrips()
          setSession({ ...nextSession, trips: list.trips })
        }
      } catch (error) {
        setNotice(errorMessage(error))
      }
    }
  }

  async function refreshTripList() {
    const result = await travelApi.listTrips()
    setSession((current) => current ? { ...current, trips: result.trips } : current)
  }

  async function updateTrip(nextTrip: TripData) {
    const current = selectedRef.current
    if (!current) throw new Error('尚未選擇旅程。')
    if (offlineOnly || !navigator.onLine) {
      setSyncState('offline')
      throw new Error('目前離線，只能查看已保存的行程。連線恢復後才能修改。')
    }
    setSyncState('saving')
    try {
      const record = await travelApi.updateTrip(current, nextTrip)
      setSelected(record)
      selectedRef.current = record
      setSyncState('saved')
      await cacheTrip(record)
      return record.trip
    } catch (error) {
      if (error instanceof ApiError && error.code === 'VERSION_CONFLICT' && error.current) {
        setSelected(error.current)
        selectedRef.current = error.current
        setSyncState('conflict')
        await cacheTrip(error.current)
      } else {
        setSyncState(error instanceof ApiError && error.status === 0 ? 'offline' : 'error')
      }
      throw error
    }
  }

  async function updateMyStatus(status: MemberStatus) {
    const current = selectedRef.current
    if (!current) throw new Error('尚未選擇旅程。')
    if (offlineOnly || !navigator.onLine) throw new Error('目前離線，狀態尚未送出。請連線後再試。')
    setSyncState('saving')
    try {
      const record = await travelApi.updateMyStatus(current.trip.id, status)
      setSelected(record)
      selectedRef.current = record
      setSyncState('saved')
      await cacheTrip(record)
      return record.trip
    } catch (error) {
      setSyncState(error instanceof ApiError && error.status === 0 ? 'offline' : 'error')
      throw error
    }
  }

  async function createInvite() {
    const current = selectedRef.current
    if (!current) return
    const result = await travelApi.createInvite(current.trip.id)
    const link = `${window.location.origin}${window.location.pathname}?invite=${encodeURIComponent(result.token)}`
    setInvite({ link, expiresAt: result.expiresAt })
  }

  async function logout() {
    try {
      await travelApi.logout()
    } finally {
      setSession(null)
      setSelected(null)
      selectedRef.current = null
      setOfflineOnly(false)
      forgetLastTrip()
    }
  }

  if (booting) return <LoadingScreen />

  if (selected) {
    return <>
      <App remote={{
        trip: selected.trip,
        role: selected.role,
        userId: session?.user.id ?? '',
        userName: session?.user.name ?? '離線查看',
        readOnly: offlineOnly,
        syncState,
        onTripChange: updateTrip,
        onStatusChange: updateMyStatus,
        onInvite: selected.role === 'planner' && !offlineOnly ? createInvite : undefined,
        onExit: async () => {
          setSelected(null)
          selectedRef.current = null
          forgetLastTrip()
          if (session && navigator.onLine) {
            try { await refreshTripList() } catch { /* keep the last known list */ }
          }
        },
        onLogout: logout,
      }} />
      {invite && <InviteDialog invite={invite} onClose={() => setInvite(null)} />}
    </>
  }

  if (!session) {
    return <AuthScreen invitationPending={Boolean(invitationToken())} notice={notice} onAuthenticated={handleAuthenticated} />
  }

  return <TripDashboard
    user={session.user}
    trips={session.trips}
    notice={notice}
    onOpen={(tripId) => openTrip(tripId).catch((error) => setNotice(errorMessage(error)))}
    onCreated={async (record) => {
      setSelected(record)
      selectedRef.current = record
      rememberLastTrip(record.trip.id)
      await cacheTrip(record)
      await refreshTripList()
    }}
    onLogout={logout}
  />
}

function LoadingScreen() {
  return <main className="entry-screen" aria-busy="true">
    <div className="entry-card entry-card--center">
      <span className="brand-mark" aria-hidden="true">同</span>
      <h1>正在讀取你的旅程</h1>
      <p>會先確認帳號與已保存的離線資料。</p>
    </div>
  </main>
}

function AuthScreen({ invitationPending, notice, onAuthenticated }: {
  invitationPending: boolean
  notice: string
  onAuthenticated: (session: SessionRecord) => Promise<void>
}) {
  const [mode, setMode] = useState<AuthMode>('login')
  const [form, setForm] = useState({ name: '', email: '', password: '' })
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError('')
    if (mode === 'register' && !form.name.trim()) return setError('請填寫同行旅伴看得到的姓名。')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) return setError('請填寫有效的電子郵件。')
    if (form.password.length < 10) return setError('密碼至少需要 10 個字元。')
    setSubmitting(true)
    try {
      const session = mode === 'register'
        ? await travelApi.register({ name: form.name.trim(), email: form.email, password: form.password })
        : await travelApi.login({ email: form.email, password: form.password })
      await onAuthenticated(session)
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setSubmitting(false)
    }
  }

  return <main className="entry-screen">
    <section className="entry-card" aria-labelledby="auth-title">
      <div className="entry-brand"><span className="brand-mark" aria-hidden="true">同</span><span><strong>同行</strong><small>共享旅程規劃</small></span></div>
      <p className="eyebrow">{invitationPending ? '你收到旅程邀請' : '開始安排旅程'}</p>
      <h1 id="auth-title">{mode === 'login' ? '登入後查看旅程' : '建立同行帳號'}</h1>
      <p>{invitationPending ? '登入或註冊後，系統會把你加入收到邀請的旅程。' : '你的行程會保存到這台同行伺服器，受邀旅伴可從其他瀏覽器查看。'}</p>
      {(notice || error) && <div className="entry-alert" role="alert"><CircleAlert aria-hidden="true" /><span>{error || notice}</span></div>}
      <div className="auth-mode" aria-label="選擇登入或註冊">
        <button type="button" aria-pressed={mode === 'login'} className={mode === 'login' ? 'is-active' : ''} onClick={() => { setMode('login'); setError('') }}>登入</button>
        <button type="button" aria-pressed={mode === 'register'} className={mode === 'register' ? 'is-active' : ''} onClick={() => { setMode('register'); setError('') }}>第一次使用</button>
      </div>
      <form className="form-stack" onSubmit={submit} noValidate>
        {mode === 'register' && <label><span>你的姓名</span><input autoComplete="name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>}
        <label><span>電子郵件</span><input type="email" autoComplete="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label>
        <label><span>密碼（至少 10 個字元）</span><input type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} /></label>
        <button className="button button--primary entry-submit" type="submit" disabled={submitting}>
          {mode === 'login' ? <LogIn aria-hidden="true" /> : <UserPlus aria-hidden="true" />}
          {submitting ? '正在確認帳號…' : mode === 'login' ? '登入並查看旅程' : '建立帳號'}
        </button>
      </form>
    </section>
  </main>
}

function TripDashboard({ user, trips, notice, onOpen, onCreated, onLogout }: {
  user: AccountUser
  trips: TripSummaryRecord[]
  notice: string
  onOpen: (tripId: string) => void
  onCreated: (record: TripRecord) => Promise<void>
  onLogout: () => Promise<void>
}) {
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({ name: '', destination: '', startDate: '', endDate: '' })
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const sortedTrips = useMemo(() => [...trips].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [trips])

  async function create(event: FormEvent) {
    event.preventDefault()
    setError('')
    if (!form.name.trim() || !form.destination.trim() || !form.startDate || !form.endDate) return setError('請填寫旅程名稱、目的地與日期。')
    if (form.endDate < form.startDate) return setError('結束日期不能早於開始日期。')
    setSubmitting(true)
    try {
      const record = await travelApi.createTrip({ ...form, name: form.name.trim(), destination: form.destination.trim() })
      await onCreated(record)
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setSubmitting(false)
    }
  }

  return <main className="dashboard-screen">
    <header className="dashboard-header">
      <div className="entry-brand"><span className="brand-mark" aria-hidden="true">同</span><span><strong>同行</strong><small>{user.name} 的旅程</small></span></div>
      <button className="button button--quiet" type="button" onClick={() => void onLogout()}><LogOut aria-hidden="true" />登出</button>
    </header>
    <section className="dashboard-content" aria-labelledby="trip-list-title">
      <div className="dashboard-title">
        <div><p className="eyebrow">我的旅程</p><h1 id="trip-list-title">選擇要查看的旅程</h1><p>規劃者可建立行程並邀請旅伴；旅伴只會看到已加入的旅程。</p></div>
        <button className="button button--primary" type="button" onClick={() => setCreating((value) => !value)}><CalendarPlus aria-hidden="true" />{creating ? '關閉建立表單' : '建立新旅程'}</button>
      </div>
      {notice && <div className="entry-alert" role="status"><CheckCircle2 aria-hidden="true" /><span>{notice}</span></div>}
      {creating && <form className="create-trip-card form-stack" onSubmit={create} noValidate>
        <h2>建立一趟共享旅程</h2>
        {error && <div className="entry-alert" role="alert"><CircleAlert aria-hidden="true" /><span>{error}</span></div>}
        <label><span>旅程名稱</span><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="例如：台北三日同行" /></label>
        <label><span>主要目的地</span><input value={form.destination} onChange={(event) => setForm({ ...form, destination: event.target.value })} placeholder="例如：台北" /></label>
        <div className="field-row"><label><span>開始日期</span><input type="date" value={form.startDate} onChange={(event) => setForm({ ...form, startDate: event.target.value })} /></label><label><span>結束日期</span><input type="date" value={form.endDate} onChange={(event) => setForm({ ...form, endDate: event.target.value })} /></label></div>
        <button className="button button--primary" type="submit" disabled={submitting}>{submitting ? <RefreshCw className="spin" aria-hidden="true" /> : <CalendarPlus aria-hidden="true" />}{submitting ? '正在建立…' : '建立並開始規劃'}</button>
      </form>}
      {sortedTrips.length === 0 ? <div className="dashboard-empty"><CalendarPlus aria-hidden="true" /><h2>目前還沒有旅程</h2><p>建立第一趟旅程後，就能新增每天的行程與邀請旅伴。</p></div> : <div className="trip-choice-list">{sortedTrips.map((trip) => <button className="trip-choice" type="button" key={trip.id} onClick={() => onOpen(trip.id)}>
        <span><small>{trip.role === 'planner' ? '你是規劃者' : '你是旅伴'}</small><strong>{trip.name}</strong><span>{trip.destination} · {trip.startDate} 至 {trip.endDate}</span></span><span>開啟旅程</span>
      </button>)}</div>}
    </section>
  </main>
}

function InviteDialog({ invite, onClose }: { invite: { link: string; expiresAt: string }; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(invite.link)
      setCopied(true)
    } catch {
      const field = document.querySelector<HTMLInputElement>('#invite-link')
      field?.select()
    }
  }
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="modal invite-dialog" role="dialog" aria-modal="true" aria-labelledby="invite-title">
      <p className="eyebrow">邀請一位旅伴</p><h2 id="invite-title">分享這個一次性連結</h2>
      <p>連結在 {new Intl.DateTimeFormat('zh-TW', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(invite.expiresAt))} 前有效，使用一次後即失效。</p>
      <label className="invite-field"><span>旅伴加入連結</span><input id="invite-link" readOnly value={invite.link} /></label>
      <div className="modal-actions"><button className="button button--quiet" type="button" onClick={onClose}>關閉</button><button className="button button--primary" type="button" onClick={() => void copy()}><Copy aria-hidden="true" />{copied ? '已複製' : '複製連結'}</button></div>
    </section>
  </div>
}

export function SyncLabel({ state }: { state: SyncState }) {
  const labels = {
    saved: { icon: CheckCircle2, text: '已同步到伺服器' },
    saving: { icon: RefreshCw, text: '正在同步變更' },
    offline: { icon: WifiOff, text: '離線，只能查看已保存內容' },
    conflict: { icon: CircleAlert, text: '內容有更新，已載入伺服器版本' },
    error: { icon: CircleAlert, text: '變更未保存，請重試' },
  } as const
  const item = labels[state]
  const Icon = item.icon
  return <span className={`remote-sync remote-sync--${state}`} role="status"><Icon className={state === 'saving' ? 'spin' : ''} aria-hidden="true" />{item.text}</span>
}

export function InviteAction({ onClick }: { onClick: () => void }) {
  return <button className="button button--secondary button--compact" type="button" onClick={onClick}><Share2 aria-hidden="true" />邀請旅伴</button>
}
