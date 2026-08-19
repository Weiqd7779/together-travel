import axe from 'axe-core'
import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'

async function expectNoA11yViolations(container: HTMLElement) {
  const results = await axe.run(container, {
    rules: {
      // jsdom does not perform layout or paint, so it cannot calculate contrast.
      'color-contrast': { enabled: false },
    },
  })
  expect(
    results.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      targets: violation.nodes.map((node) => node.target),
    })),
  ).toEqual([])
}

function desktopNav() {
  return within(screen.getByRole('complementary', { name: '主要導覽' }))
}

describe('accessibility baseline', () => {
  beforeEach(() => window.localStorage.clear())

  it('has no detectable semantic violations on the Today page', async () => {
    const { container } = render(<App />)
    await expectNoA11yViolations(container)
  })

  it('has no detectable semantic violations on all primary pages', async () => {
    const user = userEvent.setup()
    const { container } = render(<App />)

    for (const page of ['行程', '附近', '旅伴', '協助']) {
      await user.click(desktopNav().getByRole('button', { name: page }))
      await expectNoA11yViolations(container)
    }
  })

  it('keeps the itinerary dialog labelled and free of detectable violations', async () => {
    const user = userEvent.setup()
    const { container } = render(<App />)

    await user.click(screen.getByRole('button', { name: '切換為規劃者介面' }))
    await user.click(desktopNav().getByRole('button', { name: '行程' }))
    await user.click(screen.getByRole('button', { name: /新增行程/ }))

    expect(screen.getByRole('dialog')).toHaveAccessibleName('新增行程')
    await expectNoA11yViolations(container)
  })
})
