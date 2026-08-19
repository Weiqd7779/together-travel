import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'
import { STORAGE_KEY } from './storage'

function firstNavigationButton(name: string) {
  return within(screen.getByRole('complementary', { name: '主要導覽' })).getByRole('button', { name })
}

describe('Together Travel app', () => {
  beforeEach(() => window.localStorage.clear())

  it('starts in the simple companion view with an actionable next step', () => {
    render(<App />)

    expect(screen.getByRole('heading', { name: '下一站在這裡' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '淺草寺散步' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /開始前往下一站/ })).toHaveAttribute('href', expect.stringContaining('google.com/maps'))
    expect(screen.getByRole('button', { name: /找廁所/ })).toBeInTheDocument()
  })

  it('switches roles and only exposes editing to the planner', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(firstNavigationButton('行程'))
    expect(screen.queryByRole('button', { name: /新增行程/ })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '切換為規劃者介面' }))
    expect(screen.getByRole('button', { name: /新增行程/ })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /編輯/ }).length).toBeGreaterThan(0)
  })

  it('adds a new itinerary item and persists it', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<App />)

    await user.click(screen.getByRole('button', { name: '切換為規劃者介面' }))
    await user.click(firstNavigationButton('行程'))
    await user.click(screen.getByRole('button', { name: /查看第 3 天/ }))
    await user.click(screen.getByRole('button', { name: /新增行程/ }))

    const dialog = screen.getByRole('dialog')
    await user.type(within(dialog).getByLabelText('行程名稱'), '晴空塔觀景')
    await user.type(within(dialog).getByLabelText('顯示地點'), '晴空塔入口')
    await user.type(within(dialog).getByLabelText('完整地址'), '東京都墨田區押上 1-1-2')
    await user.click(within(dialog).getByRole('button', { name: /儲存行程/ }))

    expect(await screen.findByRole('heading', { name: '晴空塔觀景' })).toBeInTheDocument()
    const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}')
    expect(saved.preferences.selectedDate).toBe('2026-07-19')
    expect(saved.trip.days.find((day: { date: string }) => day.date === '2026-07-19').items.some((item: { title: string }) => item.title === '晴空塔觀景')).toBe(true)

    unmount()
    render(<App />)
    expect(screen.getByRole('heading', { name: '晴空塔觀景' })).toBeInTheDocument()
  })

  it('imports an address from a Google Maps link and saves selectable facilities', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: '切換為規劃者介面' }))
    await user.click(firstNavigationButton('行程'))
    await user.click(screen.getByRole('button', { name: /查看第 3 天/ }))
    await user.click(screen.getByRole('button', { name: /新增行程/ }))

    const dialog = screen.getByRole('dialog')
    await user.type(within(dialog).getByLabelText('行程名稱'), '上野公園散步')
    await user.type(
      within(dialog).getByLabelText('Google Maps 連結'),
      'https://www.google.com/maps/search/?api=1&query=%E4%B8%8A%E9%87%8E%E5%85%AC%E5%9C%92',
    )
    await user.click(within(dialog).getByRole('button', { name: '從連結匯入地址' }))

    expect(within(dialog).getByLabelText('完整地址')).toHaveValue('上野公園')
    await user.click(within(dialog).getByRole('checkbox', { name: '有座位' }))
    await user.selectOptions(within(dialog).getByLabelText('預留時間'), '75')
    await user.click(within(dialog).getByRole('button', { name: /儲存行程/ }))

    expect(await screen.findByText('已確認：有座位')).toBeInTheDocument()
    const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}')
    const item = saved.trip.days.find((day: { date: string }) => day.date === '2026-07-19').items[0]
    expect(item.mapUrl).toContain('google.com/maps/search')
    expect(item.address).toBe('上野公園')
    expect(item.location).toBe('上野公園')
    expect(item.durationMinutes).toBe(75)
    expect(item.accessibility).toContain('有座位')
    expect(item.status).toBe('next')
  })

  it('requires itinerary and meeting times to use 15 minute increments', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: '切換為規劃者介面' }))
    await user.click(firstNavigationButton('行程'))
    await user.click(screen.getByRole('button', { name: /新增行程/ }))

    const dialog = screen.getByRole('dialog')
    const startTime = within(dialog).getByLabelText('開始時間')
    expect(startTime).toHaveAttribute('step', '900')
    expect(startTime).toHaveValue('16:00')
    fireEvent.change(startTime, { target: { value: '09:07' } })
    await user.type(within(dialog).getByLabelText('行程名稱'), '測試行程')
    await user.type(within(dialog).getByLabelText('顯示地點'), '測試入口')
    await user.type(within(dialog).getByLabelText('完整地址'), '測試地址')
    await user.click(within(dialog).getByRole('button', { name: /儲存行程/ }))

    expect(within(dialog).getByRole('alert')).toHaveTextContent('15 分鐘')
  })

  it('switches days and keeps Today and itinerary pages on the same selected date', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(firstNavigationButton('行程'))
    await user.click(screen.getByRole('button', { name: /查看第 3 天/ }))
    expect(screen.getByRole('heading', { name: '第 3 天還沒有行程' })).toBeInTheDocument()

    await user.click(firstNavigationButton('首頁'))
    expect(screen.getByRole('heading', { name: '第 3 天還沒有行程' })).toBeInTheDocument()
  })

  it('updates the trip date range without silently deleting scheduled days', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: '切換為規劃者介面' }))
    await user.click(firstNavigationButton('行程'))
    await user.click(screen.getByRole('button', { name: '旅程設定' }))

    const dialog = screen.getByRole('dialog')
    const endDate = within(dialog).getByLabelText('結束日期')
    await user.clear(endDate)
    await user.type(endDate, '2026-07-22')
    await user.click(within(dialog).getByRole('button', { name: '儲存旅程設定' }))

    expect(screen.getByRole('button', { name: /查看第 6 天/ })).toBeInTheDocument()
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}').trip.days).toHaveLength(6)

    await user.click(screen.getByRole('button', { name: '旅程設定' }))
    const secondDialog = screen.getByRole('dialog')
    const shorterEndDate = within(secondDialog).getByLabelText('結束日期')
    await user.clear(shorterEndDate)
    await user.type(shorterEndDate, '2026-07-17')
    await user.click(within(secondDialog).getByRole('button', { name: '儲存旅程設定' }))

    expect(within(secondDialog).getByRole('alert')).toHaveTextContent('會移除已有行程的日期')
    expect(secondDialog).toBeInTheDocument()
  })

  it('keeps the form open and explains how to recover from missing fields', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: '切換為規劃者介面' }))
    await user.click(firstNavigationButton('行程'))
    await user.click(screen.getByRole('button', { name: /新增行程/ }))
    await user.click(screen.getByRole('button', { name: /儲存行程/ }))

    expect(screen.getByRole('alert')).toHaveTextContent('請填寫行程名稱、地點與完整地址')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('updates the companion status without requiring location sharing', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(firstNavigationButton('旅伴'))
    await user.click(screen.getByRole('button', { name: '我到了' }))

    expect(screen.getAllByText('已到集合點').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByRole('status')).toHaveTextContent('「我到了」已儲存在這個裝置')
  })

  it('opens nearby restroom results from the contextual shortcut', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: /找廁所/ }))

    expect(screen.getByRole('heading', { name: '廁所的附近選擇' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '淺草文化觀光中心廁所' })).toBeInTheDocument()
    expect(screen.getByText(/第一版使用示範資料/)).toBeInTheDocument()
  })

  it('stores a meeting point under one itinerary instead of the whole trip', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: '切換為規劃者介面' }))
    await user.click(firstNavigationButton('行程'))
    await user.click(screen.getByRole('button', { name: '修改 自由活動 的集合點' }))

    const dialog = screen.getByRole('dialog')
    const placeInput = within(dialog).getByLabelText('集合地點')
    await user.clear(placeInput)
    await user.type(placeInput, '雷門對面服務台')
    await user.click(within(dialog).getByRole('button', { name: /更新集合點/ }))

    await user.click(firstNavigationButton('旅伴'))
    expect(screen.getByRole('heading', { name: '自由活動的集合點' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '雷門對面服務台' })).toBeInTheDocument()
    const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}')
    expect(saved.trip.meeting).toBeUndefined()
    expect(saved.trip.days[1].items.find((item: { id: string }) => item.id === 'item-free').meeting.name).toBe('雷門對面服務台')
  })

  it('shows that a selected day has no meeting instead of reusing another itinerary meeting', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(firstNavigationButton('行程'))
    await user.click(screen.getByRole('button', { name: /查看第 3 天/ }))
    await user.click(firstNavigationButton('旅伴'))

    expect(screen.getByRole('heading', { name: '這一天還沒有集合安排' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '自由活動的集合點' })).not.toBeInTheDocument()
  })

  it('advances to the next itinerary and can return after an accidental tap', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: '完成淺草寺散步，顯示下一個行程' }))

    expect(screen.getByRole('heading', { name: '午餐：釜飯春' })).toBeInTheDocument()
    let saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}')
    expect(saved.trip.days[1].items.find((item: { id: string }) => item.id === 'item-sensoji').status).toBe('done')
    expect(saved.trip.days[1].items.find((item: { id: string }) => item.id === 'item-lunch').status).toBe('next')

    await user.click(screen.getByRole('button', { name: '回到上一個行程：淺草寺散步' }))
    expect(screen.getByRole('heading', { name: '淺草寺散步' })).toBeInTheDocument()
    saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}')
    expect(saved.trip.days[1].items.find((item: { id: string }) => item.id === 'item-sensoji').status).toBe('next')
  })

  it('requires confirmation before exposing the emergency phone link', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(firstNavigationButton('協助'))
    expect(screen.queryByRole('link', { name: '撥打 119' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '撥打 119' }))

    expect(screen.getByRole('dialog')).toHaveAccessibleName('要撥打日本緊急電話 119 嗎？')
    expect(screen.getByRole('link', { name: '撥打 119' })).toHaveAttribute('href', 'tel:119')
  })

  it('supports large text and persists the preference', async () => {
    const user = userEvent.setup()
    const { container } = render(<App />)

    await user.click(screen.getByRole('button', { name: '放大字體' }))

    expect(container.firstElementChild).toHaveClass('app--large-text')
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}').preferences.largeText).toBe(true)
    expect(screen.getByRole('button', { name: '標準字體' })).toBeInTheDocument()
  })

  it('keeps cached travel essentials visible when the browser goes offline', async () => {
    render(<App />)

    window.dispatchEvent(new Event('offline'))

    expect(await screen.findByRole('status')).toHaveTextContent('目前離線')
    expect(screen.getByRole('heading', { name: '淺草寺散步' })).toBeInTheDocument()
  })

  it('closes editing with Escape without losing the existing itinerary', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: '切換為規劃者介面' }))
    await user.click(firstNavigationButton('行程'))
    await user.click(screen.getByRole('button', { name: /新增行程/ }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '淺草寺散步' })).toBeInTheDocument()
  })

  it('deletes an itinerary only after a destructive confirmation', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: '切換為規劃者介面' }))
    await user.click(firstNavigationButton('行程'))
    await user.click(screen.getByRole('button', { name: '刪除 飯店早餐' }))
    expect(screen.getByRole('heading', { name: '刪除「飯店早餐」？' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '確定刪除' }))

    expect(screen.queryByRole('heading', { name: '飯店早餐' })).not.toBeInTheDocument()
  })
})
