import { defaultState } from './data'
import { normalizeItineraryProgress, normalizeSelectedDate } from './trip'
import type { AppPreferences, ItineraryItem, MeetingPoint, PersistedAppState, TripData, TripDay } from './types'

export const STORAGE_KEY = 'together-travel:v1'

interface RawItem extends Partial<Omit<ItineraryItem, 'durationMinutes'>> {
  duration?: string
  durationMinutes?: number
}

interface RawDay {
  date?: string
  items?: RawItem[]
}

interface RawTrip extends Partial<Omit<TripData, 'days'>> {
  days?: RawDay[]
  items?: RawItem[]
  meeting?: MeetingPoint
  dateLabel?: string
  dayLabel?: string
}

interface RawState {
  schemaVersion?: number
  preferences?: Partial<AppPreferences>
  trip?: RawTrip
}

export function cloneDefaultState(): PersistedAppState {
  return JSON.parse(JSON.stringify(defaultState)) as PersistedAppState
}

function durationFromLegacy(value?: string) {
  if (!value) return 60
  const hours = Number(value.match(/(\d+(?:\.\d+)?)\s*小時/)?.[1] ?? 0)
  const minutes = Number(value.match(/(\d+)\s*分鐘/)?.[1] ?? 0)
  const total = Math.round((hours * 60 + minutes) / 15) * 15
  return total > 0 ? total : 60
}

function normalizeRawItem(item: RawItem): ItineraryItem {
  const durationMinutes = typeof item.durationMinutes === 'number' && item.durationMinutes > 0
    ? Math.max(15, Math.round(item.durationMinutes / 15) * 15)
    : durationFromLegacy(item.duration)
  return {
    id: item.id ?? `item-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    time: item.time ?? '09:00',
    title: item.title ?? '未命名行程',
    location: item.location ?? '',
    address: item.address ?? '',
    mapUrl: item.mapUrl,
    transport: item.transport ?? '',
    durationMinutes,
    note: item.note ?? '',
    accessibility: Array.isArray(item.accessibility) ? item.accessibility.filter((tag): tag is string => typeof tag === 'string') : [],
    status: ['done', 'now', 'next', 'later'].includes(item.status ?? '') ? item.status! : 'later',
    meeting: item.meeting,
  }
}

function attachLegacyMeeting(days: TripDay[], meeting: MeetingPoint | undefined, selectedDate: string) {
  if (!meeting || days.some((day) => day.items.some((item) => item.meeting))) return days
  const selectedItems = days.find((day) => day.date === selectedDate)?.items ?? []
  const allItems = days.flatMap((day) => day.items)
  const target = selectedItems.find((item) => /自由|逛|分開/.test(item.title))
    ?? allItems.find((item) => /自由|逛|分開/.test(item.title))
    ?? selectedItems.find((item) => item.status === 'now' || item.status === 'next')
    ?? selectedItems.at(-1)
    ?? allItems.at(-1)
  if (!target) return days
  return days.map((day) => ({
    ...day,
    items: day.items.map((item) => item.id === target.id ? { ...item, meeting } : item),
  }))
}

function hasStateShape(value: unknown): value is RawState {
  if (!value || typeof value !== 'object') return false
  const state = value as RawState
  return typeof state.trip?.name === 'string'
    && typeof state.trip.startDate === 'string'
    && typeof state.trip.endDate === 'string'
    && Array.isArray(state.trip.days)
    && state.trip.days.every((day) => typeof day?.date === 'string' && Array.isArray(day.items))
    && (state.preferences?.role === 'planner' || state.preferences?.role === 'companion')
}

function normalizeState(state: PersistedAppState): PersistedAppState {
  return {
    ...state,
    trip: {
      ...state.trip,
      days: state.trip.days.map((day) => ({ ...day, items: normalizeItineraryProgress(day.items) })),
    },
    preferences: {
      ...state.preferences,
      selectedDate: normalizeSelectedDate(state.trip, state.preferences.selectedDate),
    },
  }
}

function migrateMultiDayState(raw: RawState): PersistedAppState | null {
  if (!hasStateShape(raw)) return null
  const fresh = cloneDefaultState()
  const { days: rawDays = [], meeting, items: _items, dateLabel: _dateLabel, dayLabel: _dayLabel, ...tripFields } = raw.trip!
  const selectedDate = raw.preferences?.selectedDate ?? fresh.preferences.selectedDate
  const days: TripDay[] = rawDays.map((day) => ({
    date: day.date!,
    items: (day.items ?? []).map(normalizeRawItem),
  }))
  const trip: TripData = {
    ...fresh.trip,
    ...tripFields,
    days: attachLegacyMeeting(days, meeting, selectedDate),
  }
  return normalizeState({
    schemaVersion: 3,
    preferences: { ...fresh.preferences, ...raw.preferences, selectedDate },
    trip,
  })
}

function migrateSingleDayState(raw: RawState): PersistedAppState | null {
  if (!Array.isArray(raw.trip?.items) || !raw.preferences?.role) return null
  const fresh = cloneDefaultState()
  const { items, meeting, dateLabel: _dateLabel, dayLabel: _dayLabel, days: _days, startDate: _startDate, endDate: _endDate, ...tripFields } = raw.trip
  const selectedDate = fresh.preferences.selectedDate
  const days = fresh.trip.days.map((day) => (
    day.date === selectedDate ? { ...day, items: items.map(normalizeRawItem) } : day
  ))
  return {
    schemaVersion: 3,
    preferences: { ...fresh.preferences, ...raw.preferences, selectedDate },
    trip: {
      ...fresh.trip,
      ...tripFields,
      days: attachLegacyMeeting(days, meeting, selectedDate),
    },
  }
}

export function loadState(): PersistedAppState {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY)
    if (!saved) return cloneDefaultState()
    const parsed = JSON.parse(saved) as RawState
    const migrated = migrateMultiDayState(parsed) ?? migrateSingleDayState(parsed)
    if (migrated) {
      if (parsed.schemaVersion !== 3) saveState(migrated)
      return migrated
    }
    return cloneDefaultState()
  } catch {
    return cloneDefaultState()
  }
}

export function saveState(state: PersistedAppState): boolean {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    return true
  } catch {
    return false
  }
}

export function resetState(): PersistedAppState {
  const fresh = cloneDefaultState()
  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // The app can continue with in-memory defaults when storage is unavailable.
  }
  return fresh
}
