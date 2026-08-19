import { beforeEach, describe, expect, it } from 'vitest'
import { defaultState } from './data'
import { loadState, resetState, saveState, STORAGE_KEY } from './storage'

describe('local storage state', () => {
  beforeEach(() => window.localStorage.clear())

  it('loads a fresh independent default when nothing is saved', () => {
    const first = loadState()
    first.trip.name = 'changed'
    const second = loadState()

    expect(second.trip.name).toBe(defaultState.trip.name)
    expect(second).not.toBe(defaultState)
  })

  it('saves and restores valid app data', () => {
    const state = loadState()
    state.preferences.role = 'planner'
    state.trip.days[1].items[3].meeting!.time = '17:15'

    expect(saveState(state)).toBe(true)
    expect(loadState().preferences.role).toBe('planner')
    expect(loadState().trip.days[1].items[3].meeting?.time).toBe('17:15')
  })

  it('recovers safely from corrupted or incomplete data', () => {
    window.localStorage.setItem(STORAGE_KEY, '{not-json')
    expect(loadState().trip.name).toBe(defaultState.trip.name)

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ trip: {} }))
    expect(loadState().trip.days.find((day) => day.date === '2026-07-18')?.items.length).toBeGreaterThan(0)
  })

  it('migrates the previous single-day data without losing itinerary changes', () => {
    const legacy = {
      preferences: { role: 'planner', largeText: true, activeTab: 'trip' },
      trip: {
        ...defaultState.trip,
        dateLabel: '7 月 18 日，星期六',
        dayLabel: '第 2 天，共 5 天',
        items: [{ ...defaultState.trip.days[1].items[0], title: '舊版保留行程' }],
      },
    }
    const { days: _days, startDate: _startDate, endDate: _endDate, ...legacyTrip } = legacy.trip
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...legacy, trip: legacyTrip }))

    const migrated = loadState()

    expect(migrated.schemaVersion).toBe(3)
    expect(migrated.preferences.selectedDate).toBe('2026-07-18')
    expect(migrated.trip.days.find((day) => day.date === '2026-07-18')?.items[0].title).toBe('舊版保留行程')
  })

  it('migrates the trip-level meeting point and text duration into an itinerary', () => {
    const legacyState = {
      ...defaultState,
      schemaVersion: 2,
      trip: {
        ...defaultState.trip,
        meeting: {
          name: '舊版集合點',
          time: '16:30',
          address: '舊版地址',
          note: '舊版說明',
        },
        days: defaultState.trip.days.map((day) => ({
          ...day,
          items: day.items.map((item) => ({
            ...item,
            duration: `${item.durationMinutes} 分鐘`,
            durationMinutes: undefined,
            meeting: undefined,
          })),
        })),
      },
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(legacyState))

    const migrated = loadState()
    const freeTime = migrated.trip.days[1].items.find((item) => item.id === 'item-free')

    expect(migrated.schemaVersion).toBe(3)
    expect(freeTime?.meeting?.name).toBe('舊版集合點')
    expect(freeTime?.durationMinutes).toBe(120)
    expect('meeting' in migrated.trip).toBe(false)
  })

  it('resets local changes', () => {
    const state = loadState()
    state.trip.name = 'custom trip'
    saveState(state)

    expect(resetState().trip.name).toBe(defaultState.trip.name)
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull()
  })
})
