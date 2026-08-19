import type { ItineraryItem, TripData, TripDay } from './types'

const DAY_MS = 24 * 60 * 60 * 1000

function parseDate(value: string) {
  return new Date(`${value}T12:00:00`)
}

export function isValidDate(value: string) {
  const date = parseDate(value)
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(date.getTime())
}

export function getDateRange(startDate: string, endDate: string): string[] {
  if (!isValidDate(startDate) || !isValidDate(endDate)) return []
  const start = parseDate(startDate)
  const end = parseDate(endDate)
  if (start > end) return []
  const dates: string[] = []
  for (let cursor = start.getTime(); cursor <= end.getTime(); cursor += DAY_MS) {
    const date = new Date(cursor)
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    dates.push(`${year}-${month}-${day}`)
  }
  return dates
}

export function formatDateLabel(date: string) {
  if (!isValidDate(date)) return '日期未設定'
  return new Intl.DateTimeFormat('zh-TW', {
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }).format(parseDate(date))
}

export function formatShortWeekday(date: string) {
  if (!isValidDate(date)) return ''
  return new Intl.DateTimeFormat('zh-TW', { weekday: 'short' }).format(parseDate(date))
}

export function formatDayNumber(date: string) {
  if (!isValidDate(date)) return ''
  return String(parseDate(date).getDate())
}

export function getDayIndex(trip: TripData, date: string) {
  return getDateRange(trip.startDate, trip.endDate).indexOf(date)
}

export function getDayLabel(trip: TripData, date: string) {
  const dates = getDateRange(trip.startDate, trip.endDate)
  const index = dates.indexOf(date)
  return index >= 0 ? `第 ${index + 1} 天，共 ${dates.length} 天` : `共 ${dates.length} 天`
}

export function getSelectedDay(trip: TripData, selectedDate: string): TripDay {
  return trip.days.find((day) => day.date === selectedDate) ?? { date: selectedDate, items: [] }
}

export function replaceDayItems(trip: TripData, date: string, items: ItineraryItem[]): TripData {
  const days = trip.days.some((day) => day.date === date)
    ? trip.days.map((day) => (day.date === date ? { ...day, items } : day))
    : [...trip.days, { date, items }].sort((a, b) => a.date.localeCompare(b.date))
  return { ...trip, days }
}

export function datesRemovedByRange(trip: TripData, startDate: string, endDate: string) {
  const nextDates = new Set(getDateRange(startDate, endDate))
  return trip.days.filter((day) => !nextDates.has(day.date) && day.items.length > 0)
}

export function resizeTripDays(trip: TripData, startDate: string, endDate: string): TripDay[] {
  const currentDays = new Map(trip.days.map((day) => [day.date, day]))
  return getDateRange(startDate, endDate).map((date) => currentDays.get(date) ?? { date, items: [] })
}

export function normalizeSelectedDate(trip: TripData, selectedDate?: string) {
  const dates = getDateRange(trip.startDate, trip.endDate)
  if (selectedDate && dates.includes(selectedDate)) return selectedDate
  return dates[0] ?? ''
}

export function isQuarterHour(value: string) {
  const match = value.match(/^(\d{2}):(\d{2})$/)
  if (!match) return false
  const hours = Number(match[1])
  const minutes = Number(match[2])
  return hours >= 0 && hours < 24 && minutes >= 0 && minutes < 60 && minutes % 15 === 0
}

export function addMinutes(value: string, minutesToAdd: number) {
  const match = value.match(/^(\d{2}):(\d{2})$/)
  if (!match) return '09:00'
  const total = (Number(match[1]) * 60 + Number(match[2]) + minutesToAdd) % (24 * 60)
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

export function formatDuration(minutes: number) {
  if (minutes < 60) return `${minutes} 分鐘`
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  return remainder === 0 ? `${hours} 小時` : `${hours} 小時 ${remainder} 分鐘`
}

export const durationOptions = Array.from({ length: 32 }, (_, index) => (index + 1) * 15)

export function getActiveItem(items: ItineraryItem[]) {
  return items.find((item) => item.status === 'now' || item.status === 'next')
    ?? items.find((item) => item.status !== 'done')
}

export function advanceItineraryItems(items: ItineraryItem[], itemId: string) {
  const index = items.findIndex((item) => item.id === itemId)
  if (index < 0) return items
  const nextIndex = items.findIndex((item, itemIndex) => itemIndex > index && item.status !== 'done')
  return items.map((item, itemIndex) => {
    if (itemIndex === index) return { ...item, status: 'done' as const }
    if (itemIndex === nextIndex) return { ...item, status: 'next' as const }
    if (itemIndex > index && item.status !== 'done') return { ...item, status: 'later' as const }
    return item
  })
}

export function getPreviousCompletedItem(items: ItineraryItem[], activeId: string) {
  const index = items.findIndex((item) => item.id === activeId)
  if (index <= 0) return undefined
  return [...items.slice(0, index)].reverse().find((item) => item.status === 'done')
}

export function rewindItineraryItems(items: ItineraryItem[], activeId: string) {
  const currentIndex = items.findIndex((item) => item.id === activeId)
  const previous = getPreviousCompletedItem(items, activeId)
  if (!previous) return items
  const previousIndex = items.findIndex((item) => item.id === previous.id)
  return items.map((item, index) => {
    if (index === previousIndex) return { ...item, status: 'next' as const }
    if (index >= currentIndex && item.status !== 'done') return { ...item, status: 'later' as const }
    return item
  })
}

export function normalizeItineraryProgress(items: ItineraryItem[]) {
  const sorted = [...items].sort((a, b) => a.time.localeCompare(b.time))
  const active = sorted.find((item) => item.status === 'now' || item.status === 'next')
    ?? sorted.find((item) => item.status !== 'done')
  if (!active) return sorted
  const activeIndex = sorted.findIndex((item) => item.id === active.id)
  return sorted.map((item, index) => {
    if (index < activeIndex) return { ...item, status: 'done' as const }
    if (index === activeIndex) return { ...item, status: active.status === 'now' ? 'now' as const : 'next' as const }
    return { ...item, status: 'later' as const }
  })
}
