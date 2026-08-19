import type { TripRecord } from './api'

const DATABASE_NAME = 'together-travel-cache'
const STORE_NAME = 'trips'
const LAST_TRIP_KEY = 'together-travel:last-trip'

function openDatabase(): Promise<IDBDatabase | null> {
  if (!('indexedDB' in window)) return Promise.resolve(null)
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DATABASE_NAME, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: 'trip.id' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function cacheTrip(record: TripRecord) {
  const db = await openDatabase()
  if (!db) return false
  return new Promise<boolean>((resolve) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite')
    transaction.objectStore(STORE_NAME).put(record)
    transaction.oncomplete = () => {
      db.close()
      resolve(true)
    }
    transaction.onerror = () => {
      db.close()
      resolve(false)
    }
  })
}

export async function getCachedTrip(tripId: string) {
  const db = await openDatabase()
  if (!db) return null
  return new Promise<TripRecord | null>((resolve) => {
    const transaction = db.transaction(STORE_NAME, 'readonly')
    const request = transaction.objectStore(STORE_NAME).get(tripId)
    request.onsuccess = () => resolve(request.result as TripRecord | undefined ?? null)
    request.onerror = () => resolve(null)
    transaction.oncomplete = () => db.close()
  })
}

export function rememberLastTrip(tripId: string) {
  try {
    window.localStorage.setItem(LAST_TRIP_KEY, tripId)
  } catch {
    // The trip remains usable online when browser preferences cannot be written.
  }
}

export function getLastTripId() {
  try {
    return window.localStorage.getItem(LAST_TRIP_KEY)
  } catch {
    return null
  }
}

export function forgetLastTrip() {
  try {
    window.localStorage.removeItem(LAST_TRIP_KEY)
  } catch {
    // Nothing else is required when browser preferences are unavailable.
  }
}
