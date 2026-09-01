import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { App } from '../../src/client/App.js'

// Auto-cleanup only registers when vitest globals are on, and they are not.
afterEach(cleanup)

beforeEach(() => {
  // The shell must render before any request resolves; views own their loading.
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
})

function menu() {
  return screen.getByRole('navigation', { name: /camp/i })
}

describe('App shell', () => {
  it('lists every camp destination', () => {
    render(<App />)
    const items = within(menu()).getAllByRole('button')
    expect(items.map((b) => b.textContent)).toEqual(
      expect.arrayContaining(['The hunt', "Hunter's notes", 'Sessions', 'Regions']),
    )
  })

  it('opens on the hunt, and marks it as current', () => {
    render(<App />)
    expect(within(menu()).getByRole('button', { name: 'The hunt' }).getAttribute('aria-current'))
      .toBe('true')
  })

  it('switches the panel when another destination is chosen', async () => {
    const { user } = renderWithUser()
    await user.click(within(menu()).getByRole('button', { name: 'Sessions' }))

    expect(screen.getByRole('heading', { name: /sessions/i })).toBeTruthy()
    expect(within(menu()).getByRole('button', { name: 'Sessions' }).getAttribute('aria-current'))
      .toBe('true')
    expect(within(menu()).getByRole('button', { name: 'The hunt' }).getAttribute('aria-current'))
      .toBe('false')
  })

  it('collapses the menu and says how to bring it back', async () => {
    const { user } = renderWithUser()
    const tab = screen.getByRole('button', { name: /collapse menu/i })

    await user.click(tab)
    expect(screen.getByRole('button', { name: /expand menu/i })).toBeTruthy()
    // Collapsed, not unmounted: the tab is the only way back, so it must stay.
    expect(menu()).toBeTruthy()

    await user.click(screen.getByRole('button', { name: /expand menu/i }))
    expect(screen.getByRole('button', { name: /collapse menu/i })).toBeTruthy()
  })
})

function renderWithUser() {
  const user = {
    async click(el: HTMLElement) {
      const { act, fireEvent } = await import('@testing-library/react')
      await act(async () => { fireEvent.click(el) })
    },
  }
  render(<App />)
  return { user }
}
