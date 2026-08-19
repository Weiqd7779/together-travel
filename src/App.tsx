import {
  Accessibility,
  BellRing,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Clock3,
  Coffee,
  Edit3,
  Footprints,
  HandHelping,
  Hotel,
  LocateFixed,
  Link2,
  LogOut,
  MapPinned,
  MapPin,
  Navigation,
  Phone,
  Plus,
  RotateCcw,
  Save,
  Settings2,
  Share2,
  ShieldAlert,
  Soup,
  Trash2,
  Undo2,
  UserRound,
  Users,
  Volume2,
  WifiOff,
  X,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { nearbyPlaces } from './data'
import { mapUrl, parseGoogleMapsLink } from './maps'
import { loadState, resetState, saveState } from './storage'
import {
  datesRemovedByRange,
  addMinutes,
  advanceItineraryItems,
  durationOptions,
  formatDuration,
  formatDateLabel,
  formatDayNumber,
  formatShortWeekday,
  getDateRange,
  getDayLabel,
  getActiveItem,
  getPreviousCompletedItem,
  getSelectedDay,
  normalizeSelectedDate,
  normalizeItineraryProgress,
  isQuarterHour,
  replaceDayItems,
  resizeTripDays,
  rewindItineraryItems,
} from './trip'
import type {
  ItineraryItem,
  MeetingPoint,
  MemberStatus,
  NearbyPlace,
  PlaceType,
  Role,
  TabId,
  TripData,
} from './types'

const tabItems: Array<{ id: TabId; label: string; icon: LucideIcon }> = [
  { id: 'today', label: '首頁', icon: CalendarDays },
  { id: 'trip', label: '行程', icon: MapPinned },
  { id: 'nearby', label: '附近', icon: LocateFixed },
  { id: 'group', label: '旅伴', icon: Users },
  { id: 'help', label: '協助', icon: HandHelping },
]

const statusLabels: Record<MemberStatus, string> = {
  together: '和團體一起',
  arrived: '已到集合點',
  late: '會晚一點',
  exploring: '自由活動中',
}

const itemStatusLabels: Record<ItineraryItem['status'], string> = {
  done: '已完成',
  now: '進行中',
  next: '下一站',
  later: '稍後',
}

const facilityOptions = ['有座位', '有廁所', '有電梯', '無障礙廁所', '平坦路線', '可隨時休息']

function formatUpdatedAt(value: string) {
  try {
    return new Intl.DateTimeFormat('zh-TW', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(value))
  } catch {
    return '時間未確認'
  }
}

function emergencyRegion(destination: string) {
  if (/台北|台灣|臺灣/.test(destination)) return '台灣'
  if (/東京|京都|日本/.test(destination)) return '日本'
  return null
}

export interface RemoteWorkspaceProps {
  trip: TripData
  role: Role
  userId: string
  userName: string
  readOnly: boolean
  syncState: 'saved' | 'saving' | 'offline' | 'conflict' | 'error'
  onTripChange: (trip: TripData) => Promise<TripData>
  onStatusChange: (status: MemberStatus) => Promise<TripData>
  onInvite?: () => Promise<void>
  onExit: () => Promise<void>
  onLogout: () => Promise<void>
}

function App({ remote }: { remote?: RemoteWorkspaceProps }) {
  const [appState, setAppState] = useState(() => {
    const stored = loadState()
    if (!remote) return stored
    return {
      ...stored,
      trip: remote.trip,
      preferences: {
        ...stored.preferences,
        role: remote.role,
        selectedDate: normalizeSelectedDate(remote.trip, stored.preferences.selectedDate),
      },
    }
  })
  const [isOnline, setIsOnline] = useState(() => navigator.onLine)
  const [toast, setToast] = useState('')
  const [storageWarning, setStorageWarning] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [nearbyType, setNearbyType] = useState<PlaceType>('restroom')
  const [editingItem, setEditingItem] = useState<ItineraryItem | 'new' | null>(null)
  const [editingMeeting, setEditingMeeting] = useState<ItineraryItem | null>(null)
  const [editingTrip, setEditingTrip] = useState(false)
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null)

  const { trip, preferences } = appState
  const role = remote?.role ?? preferences.role
  const activeTab = preferences.activeTab
  const selectedDate = preferences.selectedDate
  const selectedDay = useMemo(() => getSelectedDay(trip, selectedDate), [trip, selectedDate])
  const nextItem = useMemo(() => getActiveItem(selectedDay.items), [selectedDay.items])
  const previousItem = useMemo(
    () => nextItem ? getPreviousCompletedItem(selectedDay.items, nextItem.id) : undefined,
    [nextItem, selectedDay.items],
  )
  const meetingItems = useMemo(() => selectedDay.items.filter((item) => item.meeting), [selectedDay.items])
  const suggestedItemTime = useMemo(() => {
    const lastItem = selectedDay.items.at(-1)
    return lastItem ? addMinutes(lastItem.time, lastItem.durationMinutes) : '09:00'
  }, [selectedDay.items])
  const relevantMeetingItem = useMemo(() => {
    if (nextItem?.meeting) return nextItem
    const activeIndex = nextItem ? selectedDay.items.findIndex((item) => item.id === nextItem.id) : 0
    return selectedDay.items.slice(Math.max(0, activeIndex)).find((item) => item.meeting) ?? meetingItems[0]
  }, [meetingItems, nextItem, selectedDay.items])

  useEffect(() => {
    if (remote) return
    const stored = saveState(appState)
    setStorageWarning(!stored)
  }, [appState, remote])

  useEffect(() => {
    if (!remote) return
    setAppState((current) => ({
      ...current,
      trip: remote.trip,
      preferences: {
        ...current.preferences,
        role: remote.role,
        selectedDate: normalizeSelectedDate(remote.trip, current.preferences.selectedDate),
      },
    }))
  }, [remote?.role, remote?.trip])

  useEffect(() => {
    const online = () => setIsOnline(true)
    const offline = () => setIsOnline(false)
    window.addEventListener('online', online)
    window.addEventListener('offline', offline)
    return () => {
      window.removeEventListener('online', online)
      window.removeEventListener('offline', offline)
    }
  }, [])

  function notify(message: string) {
    setToast(message)
    window.setTimeout(() => setToast(''), 3200)
  }

  async function updateTrip(updater: (current: TripData) => TripData) {
    if (isSaving) {
      notify('上一個變更仍在保存，請稍候。')
      return false
    }
    const nextTrip = updater(appState.trip)
    if (!remote) {
      setAppState((current) => ({ ...current, trip: nextTrip }))
      return true
    }
    setIsSaving(true)
    try {
      const savedTrip = await remote.onTripChange(nextTrip)
      setAppState((current) => ({ ...current, trip: savedTrip }))
      return true
    } catch (error) {
      notify(error instanceof Error ? error.message : '變更沒有保存，請重新載入後再試。')
      return false
    } finally {
      setIsSaving(false)
    }
  }

  function setTab(tab: TabId) {
    setAppState((current) => ({
      ...current,
      preferences: { ...current.preferences, activeTab: tab },
    }))
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function setRole(nextRole: Role) {
    setAppState((current) => ({
      ...current,
      preferences: { ...current.preferences, role: nextRole },
    }))
    notify(nextRole === 'planner' ? '已切換為規劃者介面' : '已切換為旅伴介面')
  }

  async function saveItem(item: ItineraryItem) {
    const saved = await updateTrip((current) => {
      const itemsForDay = getSelectedDay(current, selectedDate).items
      const exists = itemsForDay.some((entry) => entry.id === item.id)
      const items = exists
        ? itemsForDay.map((entry) => (entry.id === item.id ? item : entry))
        : [...itemsForDay, item]
       return replaceDayItems({
         ...current,
         updatedAt: new Date().toISOString(),
       }, selectedDate, normalizeItineraryProgress(items))
    })
    if (saved) {
      setEditingItem(null)
      notify(remote ? '行程已同步，旅伴重新整理後會看到。' : '行程已儲存在這個裝置')
    }
  }

  async function deleteItem(id: string) {
    const saved = await updateTrip((current) => replaceDayItems(
      { ...current, updatedAt: new Date().toISOString() },
      selectedDate,
      getSelectedDay(current, selectedDate).items.filter((item) => item.id !== id),
    ))
    if (saved) {
      setConfirmAction(null)
      notify(remote ? '行程已從共享旅程刪除。' : '行程已刪除')
    }
  }

  async function saveMeeting(itemId: string, meeting: MeetingPoint) {
    const saved = await updateTrip((current) => replaceDayItems(
      { ...current, updatedAt: new Date().toISOString() },
      selectedDate,
      getSelectedDay(current, selectedDate).items.map((item) => item.id === itemId ? { ...item, meeting } : item),
    ))
    if (saved) {
      setEditingMeeting(null)
      notify(remote ? '集合資訊已同步給旅伴。' : '集合資訊已儲存在這個行程中')
    }
  }

  async function advanceItem(itemId: string) {
    const saved = await updateTrip((current) => replaceDayItems(
      { ...current, updatedAt: new Date().toISOString() },
      selectedDate,
      advanceItineraryItems(getSelectedDay(current, selectedDate).items, itemId),
    ))
    if (saved) notify('已完成這站，下一個行程已顯示')
  }

  async function rewindItem(itemId: string) {
    const saved = await updateTrip((current) => replaceDayItems(
      { ...current, updatedAt: new Date().toISOString() },
      selectedDate,
      rewindItineraryItems(getSelectedDay(current, selectedDate).items, itemId),
    ))
    if (saved) notify('已回到上一個行程')
  }

  async function updateMyStatus(status: MemberStatus) {
    if (remote) {
      if (isSaving) return notify('上一個變更仍在保存，請稍候。')
      setIsSaving(true)
      try {
        const savedTrip = await remote.onStatusChange(status)
        setAppState((current) => ({ ...current, trip: savedTrip }))
        notify(status === 'arrived' ? '「我到了」已同步給同行旅伴。' : '「我會晚一點」已同步給同行旅伴。')
      } catch (error) {
        notify(error instanceof Error ? error.message : '狀態沒有送出，請再試一次。')
      } finally {
        setIsSaving(false)
      }
      return
    }
    await updateTrip((current) => ({
      ...current,
      members: current.members.map((member) => (member.id === 'me' ? { ...member, status } : member)),
      updatedAt: new Date().toISOString(),
    }))
    notify(status === 'arrived' ? '「我到了」已儲存在這個裝置' : '「我會晚一點」已儲存在這個裝置')
  }

  function selectDate(date: string) {
    setAppState((current) => ({
      ...current,
      preferences: { ...current.preferences, selectedDate: date },
    }))
  }

  async function saveTripSettings(settings: Pick<TripData, 'name' | 'destination' | 'startDate' | 'endDate'>) {
    const saved = await updateTrip((currentTrip) => {
      const tripWithSettings: TripData = {
        ...currentTrip,
        ...settings,
        days: resizeTripDays(currentTrip, settings.startDate, settings.endDate),
        updatedAt: new Date().toISOString(),
      }
      return tripWithSettings
    })
    if (saved) {
      setAppState((current) => ({
        ...current,
        preferences: { ...current.preferences, selectedDate: normalizeSelectedDate(current.trip, current.preferences.selectedDate) },
      }))
      setEditingTrip(false)
      notify(remote ? '旅程設定已同步。' : '旅程名稱與日期已更新')
    }
  }

  function speakNextStep() {
    if (!nextItem) {
      notify('這一天還沒有可以朗讀的行程')
      return
    }
    if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') {
      notify('這個裝置目前不支援語音朗讀')
      return
    }
    window.speechSynthesis.cancel()
    const message = new SpeechSynthesisUtterance(
      `下一站，${nextItem.title}。${nextItem.time}，在${nextItem.location}。${nextItem.transport}。`,
    )
    message.lang = 'zh-TW'
    window.speechSynthesis.speak(message)
    notify('正在朗讀下一站資訊')
  }

  function showNearby(type: PlaceType) {
    setNearbyType(type)
    setTab('nearby')
  }

  function handleReset() {
    setAppState(resetState())
    setConfirmAction(null)
    setNearbyType('restroom')
    notify('示範資料已恢復')
  }

  return (
    <div className={preferences.largeText ? 'app app--large-text' : 'app'}>
      <a className="skip-link" href="#main-content">跳到主要內容</a>
      <header className="app-header">
        <div className="header-inner">
          <button className="brand" type="button" onClick={() => setTab('today')} aria-label="回到旅程首頁">
            <span className="brand-mark" aria-hidden="true">同</span>
            <span>
              <strong>同行</strong>
              <small>一起旅行，安心跟上</small>
            </span>
          </button>

          <div className="header-tools" aria-label="顯示設定">
            {!remote && <div className="role-switch" aria-label="切換示範角色">
              <button
                type="button"
                className={role === 'companion' ? 'is-active' : ''}
                aria-label="切換為旅伴介面"
                aria-pressed={role === 'companion'}
                onClick={() => setRole('companion')}
              >
                <UserRound aria-hidden="true" />旅伴
              </button>
              <button
                type="button"
                className={role === 'planner' ? 'is-active' : ''}
                aria-label="切換為規劃者介面"
                aria-pressed={role === 'planner'}
                onClick={() => setRole('planner')}
              >
                <CalendarDays aria-hidden="true" />規劃者
              </button>
            </div>}
            <button
              className="text-size-button"
              type="button"
              aria-label={preferences.largeText ? '標準字體' : '放大字體'}
              aria-pressed={preferences.largeText}
              onClick={() =>
                setAppState((current) => ({
                  ...current,
                  preferences: { ...current.preferences, largeText: !current.preferences.largeText },
                }))
              }
            >
              <Accessibility aria-hidden="true" />
              <span className="text-size-label">{preferences.largeText ? '標準字體' : '放大字體'}</span>
              <span className="text-size-label-short" aria-hidden="true">{preferences.largeText ? '標準' : '大字'}</span>
            </button>
          </div>
        </div>
      </header>

      {remote && <div className="remote-bar">
        <div className="remote-account"><strong>{remote.userName}</strong><span>{role === 'planner' ? '規劃者' : '旅伴'}</span></div>
        <RemoteSyncState state={remote.syncState} />
        <div className="remote-actions">
          {remote.onInvite && <button className="button button--secondary button--compact" type="button" onClick={() => void remote.onInvite?.()} disabled={isSaving}><Share2 aria-hidden="true" />邀請旅伴</button>}
          <button className="button button--quiet button--compact" type="button" onClick={() => void remote.onExit()}>所有旅程</button>
          <button className="button button--quiet button--compact" type="button" onClick={() => void remote.onLogout()}><LogOut aria-hidden="true" />登出</button>
        </div>
      </div>}

      {!isOnline && (
        <div className="offline-banner" role="status">
          <WifiOff aria-hidden="true" />
          <span><strong>目前離線。</strong>你仍可查看已儲存的行程、集合點與聯絡資訊。</span>
        </div>
      )}
      {!remote && storageWarning && (
        <div className="warning-banner" role="alert">
          <CircleAlert aria-hidden="true" />
          這個瀏覽器無法保存變更；關閉頁面前請不要重新整理。
        </div>
      )}

      <div className="app-layout">
        <aside className="desktop-sidebar" aria-label="主要導覽">
          <TripSummary trip={trip} role={role} selectedDate={selectedDate} />
          <NavigationTabs activeTab={activeTab} onChange={setTab} />
          <p className="sync-note">最後更新：{formatUpdatedAt(trip.updatedAt)}</p>
        </aside>

        <main id="main-content" className="main-content" tabIndex={-1}>
          {activeTab === 'today' && (
            <TodayPage
              trip={trip}
              role={remote?.readOnly ? 'companion' : role}
              selectedDate={selectedDate}
              items={selectedDay.items}
              nextItem={nextItem}
              previousItem={previousItem}
              meetingItem={relevantMeetingItem}
              canManageProgress={!remote || role === 'planner' && !remote.readOnly}
              nearbyAvailable={!remote}
              onDismissAlert={() => updateTrip((current) => ({ ...current, alertDismissed: true }))}
              onSpeak={speakNextStep}
              onShowNearby={showNearby}
              onShowMeeting={() => setTab('group')}
              onShowHelp={() => setTab('help')}
              onShowTrip={() => setTab('trip')}
              onAdvance={advanceItem}
              onRewind={rewindItem}
            />
          )}
          {activeTab === 'trip' && (
            <TripPage
              trip={trip}
              role={remote?.readOnly ? 'companion' : role}
              selectedDate={selectedDate}
              items={selectedDay.items}
              onSelectDate={selectDate}
              onEditTrip={() => setEditingTrip(true)}
              onAdd={() => setEditingItem('new')}
              onEdit={setEditingItem}
              onDelete={(item) =>
                setConfirmAction({
                  title: `刪除「${item.title}」？`,
                  description: remote ? '刪除後，所有同行旅伴都不會再看到這個行程。' : '刪除後，這個裝置的旅伴介面不會再看到這個行程。',
                  confirmLabel: '確定刪除',
                  destructive: true,
                  onConfirm: () => deleteItem(item.id),
                })
              }
              onEditMeeting={setEditingMeeting}
            />
          )}
          {activeTab === 'nearby' && (remote
            ? <UnavailableNearbyPage />
            : <NearbyPage type={nearbyType} onTypeChange={setNearbyType} isOnline={isOnline} />)}
          {activeTab === 'group' && (
            <GroupPage
              trip={trip}
              role={remote?.readOnly ? 'companion' : role}
              currentMemberId={remote?.userId ?? 'me'}
              isShared={Boolean(remote)}
              canUpdateStatus={!remote?.readOnly}
              items={meetingItems}
              selectedDate={selectedDate}
              onEditMeeting={setEditingMeeting}
              onUpdateStatus={updateMyStatus}
            />
          )}
          {activeTab === 'help' && (
            <HelpPage
              trip={trip}
              onNotify={notify}
              emergencyRegion={emergencyRegion(trip.destination)}
              onEmergency={emergencyRegion(trip.destination) ? () =>
                setConfirmAction({
                  title: `要撥打${emergencyRegion(trip.destination)}緊急電話 119 嗎？`,
                  description: '119 用於火災、救護車或真正緊急的情況。',
                  confirmLabel: '撥打 119',
                  destructive: true,
                  href: 'tel:119',
                })
              : undefined}
              onReset={remote ? undefined : () =>
                setConfirmAction({
                  title: '恢復示範資料？',
                  description: '你新增或修改的行程、集合點與旅伴狀態都會被清除。',
                  confirmLabel: '恢復示範資料',
                  destructive: true,
                  onConfirm: handleReset,
                })
              }
            />
          )}
        </main>
      </div>

      <nav className="mobile-nav" aria-label="主要導覽">
        <NavigationTabs activeTab={activeTab} onChange={setTab} mobile />
      </nav>

      {editingItem && (
        <ItineraryModal
          item={editingItem === 'new' ? undefined : editingItem}
          dateLabel={formatDateLabel(selectedDate)}
          suggestedTime={suggestedItemTime}
          onClose={() => setEditingItem(null)}
          onSave={saveItem}
        />
      )}
      {editingMeeting && (
        <MeetingModal
          item={editingMeeting}
          isShared={Boolean(remote)}
          onClose={() => setEditingMeeting(null)}
          onSave={(meeting) => saveMeeting(editingMeeting.id, meeting)}
        />
      )}
      {editingTrip && (
        <TripSettingsModal trip={trip} onClose={() => setEditingTrip(false)} onSave={saveTripSettings} />
      )}
      {confirmAction && <ConfirmModal action={confirmAction} onClose={() => setConfirmAction(null)} />}

      {toast && <div className="toast" role="status" aria-live="polite"><CheckCircle2 aria-hidden="true" />{toast}</div>}
    </div>
  )
}

interface ConfirmAction {
  title: string
  description: string
  confirmLabel: string
  destructive?: boolean
  onConfirm?: () => void | Promise<void>
  href?: string
}

function RemoteSyncState({ state }: { state: RemoteWorkspaceProps['syncState'] }) {
  const labels = {
    saved: '已同步到伺服器',
    saving: '正在同步變更',
    offline: '離線，只能查看已保存內容',
    conflict: '旅程有新版本，已載入最新內容',
    error: '變更未保存，請重試',
  }
  return <span className={`remote-sync remote-sync--${state}`} role="status">
    {state === 'offline' ? <WifiOff aria-hidden="true" /> : state === 'saving' ? <RotateCcw className="spin" aria-hidden="true" /> : state === 'saved' ? <CheckCircle2 aria-hidden="true" /> : <CircleAlert aria-hidden="true" />}
    {labels[state]}
  </span>
}

function TripSummary({ trip, role, selectedDate }: { trip: TripData; role: Role; selectedDate: string }) {
  return (
    <section className="trip-summary" aria-label="目前旅程">
      <p className="eyebrow">目前旅程</p>
      <h2>{trip.name}</h2>
      <p>{trip.destination}</p>
      <div className="trip-summary-meta">
        <span>{formatDateLabel(selectedDate)}</span>
        <span>{getDayLabel(trip, selectedDate)}</span>
      </div>
      <span className="role-badge">{role === 'planner' ? '規劃者介面' : '旅伴介面'}</span>
    </section>
  )
}

function NavigationTabs({
  activeTab,
  onChange,
  mobile = false,
}: {
  activeTab: TabId
  onChange: (tab: TabId) => void
  mobile?: boolean
}) {
  return (
    <div className={mobile ? 'nav-list nav-list--mobile' : 'nav-list'}>
      {tabItems.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          className={activeTab === id ? 'nav-button is-active' : 'nav-button'}
          aria-current={activeTab === id ? 'page' : undefined}
          onClick={() => onChange(id)}
        >
          <Icon aria-hidden="true" />
          <span>{label}</span>
        </button>
      ))}
    </div>
  )
}

function PageHeader({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) {
  return (
    <div className="page-header">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </div>
  )
}

function TodayPage({
  trip,
  role,
  selectedDate,
  items,
  nextItem,
  previousItem,
  meetingItem,
  canManageProgress,
  nearbyAvailable,
  onDismissAlert,
  onSpeak,
  onShowNearby,
  onShowMeeting,
  onShowHelp,
  onShowTrip,
  onAdvance,
  onRewind,
}: {
  trip: TripData
  role: Role
  selectedDate: string
  items: ItineraryItem[]
  nextItem?: ItineraryItem
  previousItem?: ItineraryItem
  meetingItem?: ItineraryItem
  canManageProgress: boolean
  nearbyAvailable: boolean
  onDismissAlert: () => void
  onSpeak: () => void
  onShowNearby: (type: PlaceType) => void
  onShowMeeting: () => void
  onShowHelp: () => void
  onShowTrip: () => void
  onAdvance: (itemId: string) => void
  onRewind: (itemId: string) => void
}) {
  const dayLabel = getDayLabel(trip, selectedDate)
  return (
    <div className="page-stack">
      <PageHeader
        eyebrow={`${formatDateLabel(selectedDate)}・${dayLabel}`}
        title={role === 'planner' ? `${dayLabel.split('，')[0]}的行程已整理` : '下一站在這裡'}
        description={role === 'planner' ? '先確認全團下一步，再安心享受這一天的旅程。' : '不必看完整行程，先完成眼前這件事就好。'}
      />

      {meetingItem?.meeting && selectedDate === '2026-07-18' && !trip.alertDismissed && (
        <section className="change-alert" aria-labelledby="change-title">
          <BellRing aria-hidden="true" />
          <div>
            <p className="alert-kicker">行程有更新</p>
            <h2 id="change-title">「{meetingItem.title}」有集合安排</h2>
            <p>{meetingItem.meeting.name}，{meetingItem.meeting.time} 集合。{meetingItem.meeting.note}</p>
            <button className="text-button" type="button" onClick={onShowMeeting}>查看新集合點<ChevronRight aria-hidden="true" /></button>
          </div>
          <button className="icon-button" type="button" onClick={onDismissAlert} aria-label="關閉行程更新提醒"><X aria-hidden="true" /></button>
        </section>
      )}

      {nextItem ? <section className="next-card" aria-labelledby="next-heading">
        <div className="next-card-topline">
          <span className="status-chip status-chip--next">下一站</span>
          <span className="critical-time"><Clock3 aria-hidden="true" />{nextItem.time}</span>
        </div>
        <div className="next-card-content">
          <div>
            <p className="eyebrow">現在出發，時間很充裕</p>
            <h2 id="next-heading">{nextItem.title}</h2>
            <p className="location-line"><MapPin aria-hidden="true" />{nextItem.location}</p>
            <p className="transport-line"><Footprints aria-hidden="true" />{nextItem.transport}・{formatDuration(nextItem.durationMinutes)}</p>
            <p className="next-note">{nextItem.note}</p>
          </div>
          <div className="route-illustration" aria-hidden="true">
            <span className="route-dot route-dot--start" />
            <span className="route-line" />
            <Navigation />
            <span className="route-dot route-dot--end" />
          </div>
        </div>
        <div className="next-actions">
          <a className="button button--primary" href={mapUrl(nextItem.address, nextItem.mapUrl)} target="_blank" rel="noreferrer">
            <Navigation aria-hidden="true" />開始前往下一站
          </a>
          <button className="button button--secondary" type="button" onClick={onSpeak}>
            <Volume2 aria-hidden="true" />朗讀給我聽
          </button>
        </div>
        {canManageProgress && <div className="progress-actions" aria-label="行程進度">
          <button
            className="button button--progress"
            type="button"
            onClick={() => onAdvance(nextItem.id)}
            aria-label={`完成${nextItem.title}，顯示下一個行程`}
          >
            <CheckCircle2 aria-hidden="true" />完成這站，顯示下一個行程
          </button>
          {previousItem && (
            <button
              className="button button--quiet button--compact"
              type="button"
              onClick={() => onRewind(nextItem.id)}
              aria-label={`回到上一個行程：${previousItem.title}`}
            >
              <Undo2 aria-hidden="true" />誤按了？回到「{previousItem.title}」
            </button>
          )}
        </div>}
      </section> : (
        <EmptyState
          icon={CalendarDays}
          title={items.length > 0 ? '這一天的行程都完成了' : `${dayLabel.split('，')[0]}還沒有行程`}
          description={items.length > 0 ? '辛苦了，今天已沒有下一個行程。可以到完整行程再次確認。' : role === 'planner' ? '前往行程頁新增安排；新增後，首頁與旅伴介面會使用同一份內容。' : '規劃者還沒有安排這一天，請稍後再查看。'}
          action={<button className="button button--primary" type="button" onClick={onShowTrip}>{items.length > 0 ? '查看已完成行程' : role === 'planner' ? '前往新增行程' : '查看行程'}</button>}
        />
      )}

      <section aria-labelledby="quick-heading">
        <div className="section-heading">
          <div><p className="eyebrow">臨時需要</p><h2 id="quick-heading">現在想做什麼？</h2></div>
          <p>不用先找功能，直接選需求。</p>
        </div>
        <div className="quick-grid">
          <button className="quick-action quick-action--blue" type="button" onClick={() => onShowNearby('restroom')}>
            <span className="quick-icon"><Accessibility aria-hidden="true" /></span>
            <span><strong>找廁所</strong><small>{nearbyAvailable ? '最近 5 分鐘' : '資料接入中'}</small></span>
            <ChevronRight aria-hidden="true" />
          </button>
          <button className="quick-action quick-action--orange" type="button" onClick={() => onShowNearby('food')}>
            <span className="quick-icon"><Soup aria-hidden="true" /></span>
            <span><strong>附近吃飯</strong><small>{nearbyAvailable ? '有座位的選擇' : '資料接入中'}</small></span>
            <ChevronRight aria-hidden="true" />
          </button>
          {meetingItem?.meeting && <button className="quick-action quick-action--green" type="button" onClick={onShowMeeting}>
            <span className="quick-icon"><Users aria-hidden="true" /></span>
            <span><strong>回集合點</strong><small>{meetingItem.meeting.time}・{meetingItem.title}</small></span>
            <ChevronRight aria-hidden="true" />
          </button>}
          <button className="quick-action quick-action--purple" type="button" onClick={onShowHelp}>
            <span className="quick-icon"><HandHelping aria-hidden="true" /></span>
            <span><strong>需要協助</strong><small>聯絡旅伴或飯店</small></span>
            <ChevronRight aria-hidden="true" />
          </button>
        </div>
      </section>

      <section className="timeline-section" aria-labelledby="timeline-heading">
        <div className="section-heading section-heading--row">
          <div><p className="eyebrow">{dayLabel.split('，')[0]}</p><h2 id="timeline-heading">接下來的安排</h2></div>
          <button className="text-button" type="button" onClick={onShowTrip}>查看全部<ChevronRight aria-hidden="true" /></button>
        </div>
        <div className="compact-timeline">
          {items.filter((item) => item.status !== 'done').slice(0, 3).map((item) => (
            <div className="compact-item" key={item.id}>
              <time>{item.time}</time>
              <span className={`timeline-dot timeline-dot--${item.status}`} aria-hidden="true" />
              <div><strong>{item.title}</strong><span>{item.location}・{item.transport}</span></div>
              <span className={`status-chip status-chip--${item.status}`}>{itemStatusLabels[item.status]}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

function TripPage({
  trip,
  role,
  selectedDate,
  items,
  onSelectDate,
  onEditTrip,
  onAdd,
  onEdit,
  onDelete,
  onEditMeeting,
}: {
  trip: TripData
  role: Role
  selectedDate: string
  items: ItineraryItem[]
  onSelectDate: (date: string) => void
  onEditTrip: () => void
  onAdd: () => void
  onEdit: (item: ItineraryItem) => void
  onDelete: (item: ItineraryItem) => void
  onEditMeeting: (item: ItineraryItem) => void
}) {
  const dates = getDateRange(trip.startDate, trip.endDate)
  const dayLabel = getDayLabel(trip, selectedDate)
  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="完整行程"
        title={`${dayLabel.split('，')[0]}的安排`}
        description={role === 'planner' ? '先選日期，再新增或調整該日行程；首頁會使用同一份行程資料。' : '先選日期，只查看該日需要知道的時間、地點與移動方式。'}
        action={role === 'planner' ? <div className="page-actions"><button className="button button--secondary button--compact" type="button" onClick={onEditTrip}><Settings2 aria-hidden="true" />旅程設定</button><button className="button button--primary button--compact" type="button" onClick={onAdd}><Plus aria-hidden="true" />新增行程</button></div> : undefined}
      />

      <div className="day-selector" aria-label="目前日期">
        <div className="day-list" aria-label="選擇旅程日期">
          {dates.map((date, index) => (
            <button
              key={date}
              type="button"
              className={date === selectedDate ? 'day-button is-active' : 'day-button'}
              aria-current={date === selectedDate ? 'date' : undefined}
              aria-label={`查看第 ${index + 1} 天，${formatDateLabel(date)}`}
              onClick={() => onSelectDate(date)}
            >
              <small>{formatShortWeekday(date)}</small>
              <strong>{formatDayNumber(date)}</strong>
              <span>第 {index + 1} 天</span>
            </button>
          ))}
        </div>
        <div className="day-context"><CalendarDays aria-hidden="true" /><span><strong>{formatDateLabel(selectedDate)}</strong><small>{dayLabel}</small></span></div>
      </div>

      <div className="itinerary-list">
        {items.length === 0 ? (
          <EmptyState icon={CalendarDays} title={`${dayLabel.split('，')[0]}還沒有行程`} description={role === 'planner' ? '新增第一個行程後，首頁與旅伴介面也會使用這筆資料。' : '請聯絡規劃者確認這一天的安排。'} action={role === 'planner' ? <button className="button button--primary" type="button" onClick={onAdd}><Plus aria-hidden="true" />新增第一個行程</button> : undefined} />
        ) : items.map((item) => (
          <article className={`itinerary-card itinerary-card--${item.status}`} key={item.id}>
            <div className="itinerary-time">
              <time>{item.time}</time>
              <span className={`status-chip status-chip--${item.status}`}>{itemStatusLabels[item.status]}</span>
            </div>
            <div className="itinerary-body">
              <h2>{item.title}</h2>
              <p className="location-line"><MapPin aria-hidden="true" />{item.location}</p>
              <p className="transport-line"><Footprints aria-hidden="true" />{item.transport}・預留 {formatDuration(item.durationMinutes)}</p>
              {item.note && <p className="item-note">{item.note}</p>}
              {item.accessibility.length > 0 && <div className="tag-list" aria-label="已確認的實用設施">
                {item.accessibility.map((tag) => <span key={tag}><Check aria-hidden="true" />已確認：{tag}</span>)}
              </div>}
              {item.meeting && <div className="item-meeting-summary">
                <Users aria-hidden="true" />
                <span><strong>{item.meeting.time} 集合</strong><small>{item.meeting.name}</small></span>
              </div>}
              <div className="card-actions">
                <a className="button button--secondary button--compact" href={mapUrl(item.address, item.mapUrl)} target="_blank" rel="noreferrer"><Navigation aria-hidden="true" />查看路線</a>
                {role === 'planner' && <>
                  <button className="button button--quiet button--compact" type="button" onClick={() => onEdit(item)}><Edit3 aria-hidden="true" />編輯</button>
                  <button className="button button--quiet button--compact" type="button" onClick={() => onEditMeeting(item)} aria-label={`${item.meeting ? '修改' : '新增'} ${item.title} 的集合點`}><Users aria-hidden="true" />{item.meeting ? '修改集合點' : '新增集合點'}</button>
                  <button className="icon-button icon-button--danger" type="button" onClick={() => onDelete(item)} aria-label={`刪除 ${item.title}`}><Trash2 aria-hidden="true" /></button>
                </>}
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  )
}

function NearbyPage({ type, onTypeChange, isOnline }: { type: PlaceType; onTypeChange: (type: PlaceType) => void; isOnline: boolean }) {
  const filtered = nearbyPlaces.filter((place) => place.type === type)
  const typeLabels: Record<PlaceType, { label: string; icon: LucideIcon; description: string }> = {
    restroom: { label: '廁所', icon: Accessibility, description: '優先顯示距離近、可取得無障礙資訊的地點。' },
    food: { label: '吃飯', icon: Soup, description: '優先顯示步行可達、有座位的選擇。' },
    rest: { label: '休息', icon: Coffee, description: '找一個可以坐下來、放慢腳步的地方。' },
  }
  return (
    <div className="page-stack">
      <PageHeader eyebrow="附近需求" title="現在需要什麼？" description="先選需求，我們只顯示少量、容易比較的結果。" />
      <div className="category-tabs" role="group" aria-label="附近地點類型">
        {(Object.keys(typeLabels) as PlaceType[]).map((key) => {
          const Icon = typeLabels[key].icon
          return <button key={key} type="button" className={type === key ? 'category-button is-active' : 'category-button'} aria-pressed={type === key} onClick={() => onTypeChange(key)}><Icon aria-hidden="true" />{typeLabels[key].label}</button>
        })}
      </div>

      <div className="data-disclaimer" role="note">
        <CircleAlert aria-hidden="true" />
        <span><strong>第一版使用示範資料。</strong>{isOnline ? '營業與設施資訊可能變動，出發前請再次確認。' : '目前離線，顯示最後儲存的結果。'}</span>
      </div>

      <section aria-labelledby="nearby-results-heading">
        <div className="section-heading">
          <div><p className="eyebrow">{filtered.length} 個建議</p><h2 id="nearby-results-heading">{typeLabels[type].label}的附近選擇</h2></div>
          <p>{typeLabels[type].description}</p>
        </div>
        {filtered.length > 0 ? (
          <div className="place-list">
            {filtered.map((place, index) => <PlaceCard key={place.id} place={place} recommended={index === 0} />)}
          </div>
        ) : (
          <EmptyState icon={MapPin} title="附近沒有儲存的結果" description="恢復網路後再試一次，或聯絡旅伴協助。" />
        )}
      </section>
    </div>
  )
}

function UnavailableNearbyPage() {
  return <div className="page-stack">
    <PageHeader eyebrow="附近需求" title="附近廁所資料尚未開放" description="目前版本不會用示範地點冒充即時結果。台北、京都與東京的資料來源會在下一個資料切片逐一接入並標示更新時間。" />
    <EmptyState icon={MapPin} title="目前沒有可驗證的附近結果" description="要找地點時，請先使用行程卡片的「查看路線」開啟 Google Maps；本頁接上正式資料後才會顯示搜尋結果。" />
  </div>
}

function PlaceCard({ place, recommended }: { place: NearbyPlace; recommended: boolean }) {
  return (
    <article className="place-card">
      <div className="place-rank" aria-hidden="true">{recommended ? <CheckCircle2 /> : <MapPin />}</div>
      <div className="place-content">
        <div className="place-title-row">
          <div>{recommended && <span className="recommend-badge">最方便</span>}<h3>{place.name}</h3></div>
          <span className="walk-time"><Footprints aria-hidden="true" />{place.walkMinutes} 分鐘</span>
        </div>
        <p className="place-distance">{place.distance}・{place.address}</p>
        <dl className="place-details">
          <div><dt>開放資訊</dt><dd>{place.openStatus}</dd></div>
          <div><dt>無障礙</dt><dd>{place.accessibility}</dd></div>
        </dl>
        <p className="place-note">{place.note}</p>
        <p className="source-note">{place.sourceUpdatedAt}</p>
        <a className="button button--primary button--compact" href={mapUrl(place.address)} target="_blank" rel="noreferrer"><Navigation aria-hidden="true" />前往這裡</a>
      </div>
    </article>
  )
}

function GroupPage({
  trip,
  role,
  currentMemberId,
  isShared,
  canUpdateStatus,
  items,
  selectedDate,
  onEditMeeting,
  onUpdateStatus,
}: {
  trip: TripData
  role: Role
  currentMemberId: string
  isShared: boolean
  canUpdateStatus: boolean
  items: ItineraryItem[]
  selectedDate: string
  onEditMeeting: (item: ItineraryItem) => void
  onUpdateStatus: (status: MemberStatus) => void
}) {
  const me = trip.members.find((member) => member.id === currentMemberId)
  return (
    <div className="page-stack">
      <PageHeader eyebrow={`${formatDateLabel(selectedDate)}・旅伴與集合`} title="今天的集合時間與地點" description="每個集合點都會標示所屬行程；沒有集合安排時會直接說明。" />

      {items.length === 0 ? (
        <EmptyState icon={Users} title="這一天還沒有集合安排" description={role === 'planner' ? '到行程頁，為需要分開活動的那一站新增集合點。' : '目前不需要前往集合點；如有變更請聯絡規劃者。'} />
      ) : <div className="meeting-list">
        {items.map((item, index) => {
          const meeting = item.meeting!
          const headingId = `meeting-heading-${index}`
          return <section className="meeting-card" aria-labelledby={headingId} key={item.id}>
            <div className="meeting-time"><small>{item.title}</small><strong>{meeting.time}</strong></div>
            <div className="meeting-content">
              <p className="eyebrow">此行程的集合安排</p>
              <h2 id={headingId}>{item.title}的集合點</h2>
              <h3>{meeting.name}</h3>
              <p className="location-line"><MapPin aria-hidden="true" />{meeting.address}</p>
              <p>{meeting.note}</p>
              <div className="meeting-actions">
                <a className="button button--primary" href={mapUrl(meeting.address, meeting.mapUrl)} target="_blank" rel="noreferrer"><Navigation aria-hidden="true" />前往集合點</a>
                {role === 'planner' && <button className="button button--secondary" type="button" onClick={() => onEditMeeting(item)}><Edit3 aria-hidden="true" />修改集合點</button>}
              </div>
            </div>
          </section>
        })}
      </div>}

      <section className="status-update-card" aria-labelledby="my-status-heading">
        <div><p className="eyebrow">我的狀態</p><h2 id="my-status-heading">{me ? statusLabels[me.status] : '尚未更新'}</h2><p>用一個按鈕讓旅伴知道，不必另外打字。</p></div>
        {canUpdateStatus ? <div className="status-actions">
          <button className="button button--secondary" type="button" onClick={() => onUpdateStatus('arrived')}><CheckCircle2 aria-hidden="true" />我到了</button>
          <button className="button button--quiet" type="button" onClick={() => onUpdateStatus('late')}><Clock3 aria-hidden="true" />我會晚一點</button>
        </div> : <p className="read-only-note"><WifiOff aria-hidden="true" />連線恢復後才能更新狀態。</p>}
      </section>

      <section aria-labelledby="members-heading">
        <div className="section-heading"><div><p className="eyebrow">共 {trip.members.length} 人</p><h2 id="members-heading">旅伴狀態</h2></div><p>{isShared ? '狀態會保存到伺服器；其他旅伴重新整理或回到 App 時會看到。' : '目前是單機示範狀態，不會傳送到其他旅伴的裝置。'}</p></div>
        <div className="member-list">
          {trip.members.map((member) => (
            <article className="member-row" key={member.id}>
              <div className="member-avatar" aria-hidden="true">{member.name.slice(0, 1)}</div>
              <div className="member-info"><h3>{member.name}</h3><span>{member.role === 'planner' ? '規劃者' : '旅伴'}</span></div>
              <span className={`member-status member-status--${member.status}`}><span aria-hidden="true" />{statusLabels[member.status]}</span>
              {member.phone && <a className="icon-button" href={`tel:${member.phone}`} aria-label={`撥電話給 ${member.name}`}><Phone aria-hidden="true" /></a>}
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}

function HelpPage({ trip, emergencyRegion: region, onNotify, onEmergency, onReset }: { trip: TripData; emergencyRegion: string | null; onNotify: (message: string) => void; onEmergency?: () => void; onReset?: () => void }) {
  const [location, setLocation] = useState('尚未取得位置')
  const [locating, setLocating] = useState(false)

  function findLocation() {
    if (!navigator.geolocation) {
      onNotify('這個裝置無法取得位置')
      return
    }
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setLocation(`${coords.latitude.toFixed(5)}, ${coords.longitude.toFixed(5)}`)
        setLocating(false)
        onNotify('已取得目前位置')
      },
      () => {
        setLocation('無法取得位置，請確認定位權限')
        setLocating(false)
      },
      { enableHighAccuracy: false, timeout: 8000 },
    )
  }

  return (
    <div className="page-stack">
      <PageHeader eyebrow="協助中心" title="需要幫忙時，從這裡開始" description="聯絡旅伴、查看住宿地址，或在真正緊急時撥打求助電話。" />

      <div className="help-grid">
        <section className="help-card help-card--contact" aria-labelledby="contact-heading">
          <div className="help-icon"><UserRound aria-hidden="true" /></div>
          <p className="eyebrow">主要聯絡人</p>
          <h2 id="contact-heading">{trip.emergencyContact.name || '尚未設定主要聯絡人'}</h2>
          <p>{trip.emergencyContact.relation || '規劃者可在後續的旅程資料設定中補上。'}</p>
          {trip.emergencyContact.phone && <a className="button button--primary" href={`tel:${trip.emergencyContact.phone}`}><Phone aria-hidden="true" />撥給 {trip.emergencyContact.name}</a>}
        </section>
        <section className="help-card" aria-labelledby="hotel-heading">
          <div className="help-icon"><Hotel aria-hidden="true" /></div>
          <p className="eyebrow">今晚住宿</p>
          <h2 id="hotel-heading">{trip.hotel.name || '尚未設定住宿資料'}</h2>
          <p>{trip.hotel.address || '規劃者可在後續的旅程資料設定中補上。'}</p>
          {(trip.hotel.address || trip.hotel.phone) && <div className="stacked-actions">
            {trip.hotel.address && <a className="button button--secondary" href={mapUrl(trip.hotel.address)} target="_blank" rel="noreferrer"><Navigation aria-hidden="true" />回飯店</a>}
            {trip.hotel.phone && <a className="button button--quiet" href={`tel:${trip.hotel.phone}`}><Phone aria-hidden="true" />聯絡飯店</a>}
          </div>}
        </section>
      </div>

      <section className="location-card" aria-labelledby="location-heading">
        <div className="location-icon"><LocateFixed aria-hidden="true" /></div>
        <div><p className="eyebrow">我的位置</p><h2 id="location-heading">{location}</h2><p>需要說明位置時，可把這組座標念給旅伴或服務人員。</p></div>
        <button className="button button--secondary" type="button" onClick={findLocation} disabled={locating}><LocateFixed aria-hidden="true" />{locating ? '正在定位…' : '顯示目前位置'}</button>
      </section>

      <section className="emergency-card" aria-labelledby="emergency-heading">
        <ShieldAlert aria-hidden="true" />
        <div><p className="eyebrow">真正緊急時</p><h2 id="emergency-heading">{region ? `${region}緊急電話 119` : '此目的地的緊急電話尚未確認'}</h2><p>{region ? '適用於火災、救護車或需要立即救援的情況。警察請撥 110。' : '請向當地服務人員求助，勿直接使用其他國家的緊急號碼。'}</p></div>
        {onEmergency && <button className="button button--danger" type="button" onClick={onEmergency}><Phone aria-hidden="true" />撥打 119</button>}
      </section>

      {onReset && <section className="prototype-tools" aria-labelledby="prototype-heading">
        <div><p className="eyebrow">第一版工具</p><h2 id="prototype-heading">恢復示範內容</h2><p>測試完成後，可以清除所有本機修改並回到初始狀態。</p></div>
        <button className="button button--quiet" type="button" onClick={onReset}><RotateCcw aria-hidden="true" />恢復示範資料</button>
      </section>}
    </div>
  )
}

function EmptyState({ icon: Icon, title, description, action }: { icon: LucideIcon; title: string; description: string; action?: ReactNode }) {
  return <div className="empty-state"><Icon aria-hidden="true" /><h2>{title}</h2><p>{description}</p>{action}</div>
}

function ModalShell({ title, description, onClose, children }: { title: string; description: string; onClose: () => void; children: ReactNode }) {
  const modalRef = useRef<HTMLElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      if (event.key !== 'Tab' || !modalRef.current) return
      const focusable = Array.from(
        modalRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      )
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    document.body.classList.add('modal-open')
    window.addEventListener('keydown', handleKey)
    return () => {
      document.body.classList.remove('modal-open')
      window.removeEventListener('keydown', handleKey)
      previousFocusRef.current?.focus()
    }
  }, [onClose])

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section ref={modalRef} className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" aria-describedby="modal-description">
        <div className="modal-header">
          <div><p className="eyebrow">編輯內容</p><h2 id="modal-title">{title}</h2><p id="modal-description">{description}</p></div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="關閉對話框"><X aria-hidden="true" /></button>
        </div>
        {children}
      </section>
    </div>
  )
}

function ItineraryModal({ item, dateLabel, suggestedTime, onClose, onSave }: { item?: ItineraryItem; dateLabel: string; suggestedTime: string; onClose: () => void; onSave: (item: ItineraryItem) => void }) {
  const titleRef = useRef<HTMLInputElement>(null)
  const [form, setForm] = useState<ItineraryItem>(item ?? {
    id: `item-${Date.now()}`,
    time: suggestedTime,
    title: '',
    location: '',
    address: '',
    mapUrl: '',
    transport: '步行 10 分鐘',
    durationMinutes: 60,
    note: '',
    accessibility: [],
    status: 'later',
  })
  const [error, setError] = useState('')
  const [mapImportMessage, setMapImportMessage] = useState('')
  const selectableFacilities = [...facilityOptions, ...form.accessibility.filter((option) => !facilityOptions.includes(option))]

  useEffect(() => titleRef.current?.focus(), [])

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!isQuarterHour(form.time)) {
      setError('開始時間請使用 15 分鐘為單位，例如 09:00、09:15、09:30 或 09:45。')
      return
    }
    if (!form.title.trim() || !form.location.trim() || !form.address.trim()) {
      setError('請填寫行程名稱、地點與完整地址。')
      return
    }
    onSave({ ...form, title: form.title.trim(), location: form.location.trim(), address: form.address.trim(), mapUrl: form.mapUrl?.trim() || undefined })
  }

  function importMapAddress() {
    try {
      const imported = parseGoogleMapsLink(form.mapUrl ?? '')
      setForm((current) => ({
        ...current,
        mapUrl: imported.url,
        address: imported.address || current.address,
        location: current.location || imported.address,
      }))
      setError('')
      setMapImportMessage(imported.address
        ? `已從連結帶入地址：${imported.address}`
        : '已保存 Google Maps 短連結。短連結本身沒有可讀地址，請再填寫完整地址，離線時才看得到。')
    } catch (caught) {
      setMapImportMessage('')
      setError(caught instanceof Error ? caught.message : '請貼上有效的 Google Maps 連結。')
    }
  }

  function toggleFacility(option: string) {
    setForm((current) => ({
      ...current,
      accessibility: current.accessibility.includes(option)
        ? current.accessibility.filter((tag) => tag !== option)
        : [...current.accessibility, option],
    }))
  }

  return (
    <ModalShell title={item ? '編輯行程' : '新增行程'} description={`${dateLabel}。填寫旅伴真正需要知道的時間、地點與移動方式。`} onClose={onClose}>
      <form className="form-stack" onSubmit={submit} noValidate>
        {error && <div className="form-error" role="alert"><CircleAlert aria-hidden="true" />{error}</div>}
        <div className="field-row">
          <label><span>開始時間（每 15 分鐘）</span><input aria-label="開始時間" type="time" step="900" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} required /></label>
          <label className="field-grow"><span>行程名稱</span><input ref={titleRef} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="例如：淺草寺散步" required /></label>
        </div>
        <div className="map-import-panel">
          <label><span>Google Maps 連結</span><input type="url" value={form.mapUrl ?? ''} onChange={(e) => setForm({ ...form, mapUrl: e.target.value })} placeholder="貼上 Google Maps 分享連結" /></label>
          <button className="button button--secondary button--compact" type="button" onClick={importMapAddress}><Link2 aria-hidden="true" />從連結匯入地址</button>
          {mapImportMessage && <p className="form-success" aria-live="polite"><CheckCircle2 aria-hidden="true" />{mapImportMessage}</p>}
        </div>
        <label><span>顯示地點</span><input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="例如：雷門入口" required /></label>
        <label><span>完整地址（離線也會顯示）</span><input aria-label="完整地址" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="可從上方連結匯入，也可直接輸入" required /></label>
        <div className="field-row">
          <label className="field-grow"><span>移動方式</span><input value={form.transport} onChange={(e) => setForm({ ...form, transport: e.target.value })} /></label>
          <label><span>預留時間</span><select value={form.durationMinutes} onChange={(e) => setForm({ ...form, durationMinutes: Number(e.target.value) })}>{durationOptions.map((minutes) => <option value={minutes} key={minutes}>{formatDuration(minutes)}</option>)}</select></label>
        </div>
        <fieldset className="facility-fieldset">
          <legend>實用設施（可複選）</legend>
          <p>只勾選已確認的資訊，旅伴才不會把示意內容當成事實。</p>
          <div className="facility-options">
            {selectableFacilities.map((option) => <label className="facility-option" key={option}>
              <input type="checkbox" checked={form.accessibility.includes(option)} onChange={() => toggleFacility(option)} />
              <span><Check aria-hidden="true" />{option}</span>
            </label>)}
          </div>
        </fieldset>
        <label><span>給旅伴的提醒</span><textarea rows={3} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="只寫真正重要的提醒" /></label>
        <div className="modal-actions"><button className="button button--quiet" type="button" onClick={onClose}>取消</button><button className="button button--primary" type="submit"><Save aria-hidden="true" />儲存行程</button></div>
      </form>
    </ModalShell>
  )
}

function TripSettingsModal({
  trip,
  onClose,
  onSave,
}: {
  trip: TripData
  onClose: () => void
  onSave: (settings: Pick<TripData, 'name' | 'destination' | 'startDate' | 'endDate'>) => void
}) {
  const firstRef = useRef<HTMLInputElement>(null)
  const [form, setForm] = useState({
    name: trip.name,
    destination: trip.destination,
    startDate: trip.startDate,
    endDate: trip.endDate,
  })
  const [error, setError] = useState('')
  useEffect(() => firstRef.current?.focus(), [])

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!form.name.trim() || !form.destination.trim() || !form.startDate || !form.endDate) {
      setError('請填寫旅程名稱、目的地、開始日期與結束日期。')
      return
    }
    const dates = getDateRange(form.startDate, form.endDate)
    if (dates.length === 0) {
      setError('結束日期不可早於開始日期。')
      return
    }
    if (dates.length > 30) {
      setError('第一版每趟旅程最多 30 天，請縮短日期範圍。')
      return
    }
    const removedDays = datesRemovedByRange(trip, form.startDate, form.endDate)
    if (removedDays.length > 0) {
      const labels = removedDays.map((day) => formatDateLabel(day.date)).join('、')
      setError(`新的日期範圍會移除已有行程的日期：${labels}。請先調整這些日期的行程。`)
      return
    }
    onSave({
      name: form.name.trim(),
      destination: form.destination.trim(),
      startDate: form.startDate,
      endDate: form.endDate,
    })
  }

  return (
    <ModalShell title="旅程設定" description="設定旅程名稱與日期。日期範圍會決定可以切換的天數。" onClose={onClose}>
      <form className="form-stack" onSubmit={submit} noValidate>
        {error && <div className="form-error" role="alert"><CircleAlert aria-hidden="true" />{error}</div>}
        <label><span>旅程名稱</span><input ref={firstRef} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required /></label>
        <label><span>目的地</span><input value={form.destination} onChange={(event) => setForm({ ...form, destination: event.target.value })} required /></label>
        <div className="field-row">
          <label><span>開始日期</span><input type="date" value={form.startDate} onInput={(event) => setForm({ ...form, startDate: event.currentTarget.value })} required /></label>
          <label><span>結束日期</span><input type="date" value={form.endDate} onInput={(event) => setForm({ ...form, endDate: event.currentTarget.value })} required /></label>
        </div>
        <p className="form-help">縮短日期範圍前，必須先清空被移除日期中的行程，避免誤刪資料。</p>
        <div className="modal-actions"><button className="button button--quiet" type="button" onClick={onClose}>取消</button><button className="button button--primary" type="submit"><Save aria-hidden="true" />儲存旅程設定</button></div>
      </form>
    </ModalShell>
  )
}

function MeetingModal({ item, isShared, onClose, onSave }: { item: ItineraryItem; isShared: boolean; onClose: () => void; onSave: (meeting: MeetingPoint) => void }) {
  const firstRef = useRef<HTMLInputElement>(null)
  const [form, setForm] = useState<MeetingPoint>(item.meeting ?? {
    name: item.location,
    time: addMinutes(item.time, item.durationMinutes),
    address: item.address,
    mapUrl: item.mapUrl,
    note: '',
  })
  const [error, setError] = useState('')
  const [mapImportMessage, setMapImportMessage] = useState('')
  useEffect(() => firstRef.current?.focus(), [])
  function submit(event: FormEvent) {
    event.preventDefault()
    if (!isQuarterHour(form.time)) {
      setError('集合時間請使用 15 分鐘為單位，例如 16:00、16:15、16:30 或 16:45。')
      return
    }
    if (!form.name.trim() || !form.address.trim()) {
      setError('請填寫集合地點與完整地址。')
      return
    }
    onSave({ ...form, name: form.name.trim(), address: form.address.trim(), mapUrl: form.mapUrl?.trim() || undefined })
  }
  function importMapAddress() {
    try {
      const imported = parseGoogleMapsLink(form.mapUrl ?? '')
      setForm((current) => ({ ...current, mapUrl: imported.url, address: imported.address || current.address }))
      setError('')
      setMapImportMessage(imported.address
        ? `已從連結帶入地址：${imported.address}`
        : '已保存 Google Maps 短連結。請再填寫完整地址，離線時才看得到。')
    } catch (caught) {
      setMapImportMessage('')
      setError(caught instanceof Error ? caught.message : '請貼上有效的 Google Maps 連結。')
    }
  }
  return (
    <ModalShell title={item.meeting ? '修改集合點' : '新增集合點'} description={`這個集合點只屬於「${item.title}」，不會套用到整天其他行程。`} onClose={onClose}>
      <form className="form-stack" onSubmit={submit} noValidate>
        {error && <div className="form-error" role="alert"><CircleAlert aria-hidden="true" />{error}</div>}
        <div className="field-row"><label><span>集合時間（每 15 分鐘）</span><input aria-label="集合時間" type="time" step="900" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} /></label><label className="field-grow"><span>集合地點</span><input ref={firstRef} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label></div>
        <div className="map-import-panel">
          <label><span>集合點 Google Maps 連結</span><input type="url" value={form.mapUrl ?? ''} onChange={(e) => setForm({ ...form, mapUrl: e.target.value })} placeholder="貼上 Google Maps 分享連結" /></label>
          <button className="button button--secondary button--compact" type="button" onClick={importMapAddress}><Link2 aria-hidden="true" />從連結匯入地址</button>
          {mapImportMessage && <p className="form-success" aria-live="polite"><CheckCircle2 aria-hidden="true" />{mapImportMessage}</p>}
        </div>
        <label><span>完整地址（離線也會顯示）</span><input aria-label="完整地址" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></label>
        <label><span>辨認方式</span><textarea rows={3} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="例如：一樓服務台旁的長椅" /></label>
        <div className="change-impact"><BellRing aria-hidden="true" /><span><strong>儲存後會顯示在「{item.title}」與旅伴介面。</strong>{isShared ? '連線中的旅伴重新整理或回到 App 時會看到；目前不會發送推播。' : '目前不會同步到其他裝置或發送推播。'}</span></div>
        <div className="modal-actions"><button className="button button--quiet" type="button" onClick={onClose}>取消</button><button className="button button--primary" type="submit"><Save aria-hidden="true" />{item.meeting ? '更新集合點' : '建立集合點'}</button></div>
      </form>
    </ModalShell>
  )
}

function ConfirmModal({ action, onClose }: { action: ConfirmAction; onClose: () => void }) {
  const actionRef = useRef<HTMLButtonElement | HTMLAnchorElement>(null)
  useEffect(() => actionRef.current?.focus(), [])
  return (
    <ModalShell title={action.title} description={action.description} onClose={onClose}>
      <div className="confirm-body">
        <div className={action.destructive ? 'confirm-icon confirm-icon--danger' : 'confirm-icon'}><CircleAlert aria-hidden="true" /></div>
        <div className="modal-actions">
          <button className="button button--quiet" type="button" onClick={onClose}>取消</button>
          {action.href ? (
            <a ref={actionRef as React.RefObject<HTMLAnchorElement>} className={action.destructive ? 'button button--danger' : 'button button--primary'} href={action.href} onClick={onClose}>{action.confirmLabel}</a>
          ) : (
            <button ref={actionRef as React.RefObject<HTMLButtonElement>} className={action.destructive ? 'button button--danger' : 'button button--primary'} type="button" onClick={action.onConfirm}>{action.confirmLabel}</button>
          )}
        </div>
      </div>
    </ModalShell>
  )
}

export default App
