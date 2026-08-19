import { describe, expect, it } from 'vitest'
import { normalizeItineraryProgress } from './trip'
import type { ItineraryItem } from './types'

function item(id: string, time: string, status: ItineraryItem['status']): ItineraryItem {
  return {
    id,
    time,
    title: id,
    location: id,
    address: id,
    transport: '',
    durationMinutes: 60,
    note: '',
    accessibility: [],
    status,
  }
}

describe('itinerary progress', () => {
  it('keeps one coherent progress axis after inserting an earlier itinerary', () => {
    const normalized = normalizeItineraryProgress([
      item('breakfast', '08:30', 'done'),
      item('new-earlier-item', '09:00', 'later'),
      item('active', '10:30', 'next'),
      item('lunch', '12:30', 'later'),
    ])

    expect(normalized.map(({ id, status }) => [id, status])).toEqual([
      ['breakfast', 'done'],
      ['new-earlier-item', 'done'],
      ['active', 'next'],
      ['lunch', 'later'],
    ])
  })

  it('makes the first itinerary on an empty day the next actionable item', () => {
    expect(normalizeItineraryProgress([item('first', '09:00', 'later')])[0].status).toBe('next')
  })
})
