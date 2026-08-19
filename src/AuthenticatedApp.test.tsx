import axe from 'axe-core'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AuthenticatedApp from './AuthenticatedApp'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('real account entry', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    window.history.replaceState({}, '', '/')
    window.localStorage.clear()
  })

  it('shows a usable login form when there is no active server session', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ code: 'AUTH_REQUIRED', message: '請先登入。' }, 401)))
    const { container } = render(<AuthenticatedApp />)

    expect(await screen.findByRole('heading', { name: '登入後查看旅程' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '登入並查看旅程' })).toBeInTheDocument()
    const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } })
    expect(results.violations).toEqual([])
  })

  it('validates account fields locally, then opens the real trip list after registration', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ code: 'AUTH_REQUIRED', message: '請先登入。' }, 401))
      .mockResolvedValueOnce(jsonResponse({
        user: { id: 'user-1', name: '規劃者測試帳號', email: 'planner@example.com' },
        trips: [],
      }, 201))
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    render(<AuthenticatedApp />)

    await user.click(await screen.findByRole('button', { name: '第一次使用' }))
    await user.click(screen.getByRole('button', { name: '建立帳號' }))
    expect(screen.getByRole('alert')).toHaveTextContent('請填寫同行旅伴看得到的姓名')
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await user.type(screen.getByLabelText('你的姓名'), '規劃者測試帳號')
    await user.type(screen.getByLabelText('電子郵件'), 'planner@example.com')
    await user.type(screen.getByLabelText('密碼（至少 10 個字元）'), 'safe-password-123')
    await user.click(screen.getByRole('button', { name: '建立帳號' }))

    expect(await screen.findByRole('heading', { name: '選擇要查看的旅程' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '目前還沒有旅程' })).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
