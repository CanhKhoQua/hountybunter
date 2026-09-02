import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Pager } from '../../src/client/ui/Pager.js'

afterEach(cleanup)

function pager(props: Partial<Parameters<typeof Pager>[0]> = {}) {
  const onOffset = vi.fn()
  render(<Pager offset={0} limit={50} total={185} onOffset={onOffset} {...props} />)
  return { onOffset }
}

describe('Pager', () => {
  it('renders nothing at all when the list already fits', () => {
    // Applied to every list, including the short ones. A control that says
    // "1–6 of 6" is furniture, so it stays away until there is a second page.
    pager({ total: 6, limit: 50 })
    expect(screen.queryByRole('navigation')).toBe(null)
  })

  it('says which slice of what is on screen', () => {
    // The total is the whole point: it is what distinguishes a short list from
    // a truncated one, which is what the old silent caps got wrong.
    pager({ offset: 50, limit: 50, total: 185 })
    expect(screen.getByText('51–100 of 185')).toBeTruthy()
  })

  it('does not claim rows past the end of the list', () => {
    pager({ offset: 150, limit: 50, total: 185 })
    expect(screen.getByText('151–185 of 185')).toBeTruthy()
  })

  it('moves one page forward and one page back', () => {
    const { onOffset } = pager({ offset: 50, limit: 50, total: 185 })

    fireEvent.click(screen.getByRole('button', { name: /next/i }))
    expect(onOffset).toHaveBeenCalledWith(100)

    fireEvent.click(screen.getByRole('button', { name: /previous/i }))
    expect(onOffset).toHaveBeenCalledWith(0)
  })

  it('offers no way off either end of the list', () => {
    pager({ offset: 0, limit: 50, total: 185 })
    expect(screen.getByRole('button', { name: /previous/i }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: /next/i }).hasAttribute('disabled')).toBe(false)

    cleanup()

    pager({ offset: 150, limit: 50, total: 185 })
    expect(screen.getByRole('button', { name: /next/i }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: /previous/i }).hasAttribute('disabled')).toBe(false)
  })

  it('never asks for a negative offset', () => {
    // A page size that does not divide the offset would otherwise walk off the
    // front of the list.
    const { onOffset } = pager({ offset: 20, limit: 50, total: 185 })
    fireEvent.click(screen.getByRole('button', { name: /previous/i }))

    expect(onOffset).toHaveBeenCalledWith(0)
  })
})
