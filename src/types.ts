export type Role = 'planner' | 'companion'
export type TabId = 'today' | 'trip' | 'nearby' | 'group' | 'help'
export type PlaceType = 'restroom' | 'food' | 'rest'
export type MemberStatus = 'together' | 'arrived' | 'late' | 'exploring'

export interface ItineraryItem {
  id: string
  time: string
  title: string
  location: string
  address: string
  mapUrl?: string
  transport: string
  durationMinutes: number
  note: string
  accessibility: string[]
  status: 'done' | 'now' | 'next' | 'later'
  meeting?: MeetingPoint
}

export interface TripDay {
  date: string
  items: ItineraryItem[]
}

export interface MeetingPoint {
  name: string
  time: string
  address: string
  mapUrl?: string
  note: string
}

export interface Member {
  id: string
  name: string
  role: Role
  status: MemberStatus
  phone: string
}

export interface TripData {
  id: string
  name: string
  destination: string
  startDate: string
  endDate: string
  hotel: {
    name: string
    address: string
    phone: string
  }
  emergencyContact: {
    name: string
    relation: string
    phone: string
  }
  members: Member[]
  days: TripDay[]
  alertDismissed: boolean
  updatedAt: string
}

export interface NearbyPlace {
  id: string
  type: PlaceType
  name: string
  distance: string
  walkMinutes: number
  address: string
  openStatus: string
  accessibility: string
  note: string
  sourceUpdatedAt: string
}

export interface AppPreferences {
  role: Role
  largeText: boolean
  activeTab: TabId
  selectedDate: string
}

export interface PersistedAppState {
  schemaVersion: 3
  trip: TripData
  preferences: AppPreferences
}
