import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Notes } from '../../src/client/views/Notes.js'
import { Regions } from '../../src/client/views/Regions.js'

afterEach(cleanup)

const LIST = { notes: [{ id: '2026-08-31-which-basemap', project: 'proj-a', title: 'Which basemap?', kind: 'decision', status: 'standing', snippet: '' }] }
const EMPTY = { notes: [] }
const DETAIL = {
  note: {
    id: '2026-08-31-which-basemap',
    title: 'Which basemap?',
    question: 'Which basemap?',
    chosen: 'OpenFreeMap',
    rejected: [{ option: 'CARTO', why_not: 'request cap on the free tier' }],
    evidence: [{ kind: 'session', ref: '005a845f' }],
    status: 'standing',
  },
}
const REGIONS = {
  regions: [
    { project: 'tnm-dms-2803a2', sessions: 112, notes: 2 },
    { project: 'showroom-4a03be', sessions: 13, notes: 0 },
  ],
}

function stub(byUrl: (url: string) => unknown) {
  vi.stubGlobal('fetch', vi.fn((url: string) =>
    Promise.resolve({ ok: true, json: () => Promise.resolve(byUrl(url)) }),
  ))
}

describe('Notes', () => {
  beforeEach(() => {
    stub((url) => {
      if (url.includes('/api/notes/')) return DETAIL
      if (url.includes('q=kubernetes')) return EMPTY
      return LIST
    })
  })

  it('asks the server for one page of notes', async () => {
    await act(async () => { render(<Notes />) })
    const url = String((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]![0])

    expect(url).toMatch(/limit=\d+/)
    expect(url).toMatch(/offset=0/)
  })

  it('says how much of the list is on screen once it does not all fit', async () => {
    stub(() => ({ notes: LIST.notes, total: 120 }))
    await act(async () => { render(<Notes />) })

    expect(screen.getByText(/of 120/)).toBeTruthy()
  })

  it('drops back to the first page when a search is run', async () => {
    // A search is ranked by relevance and is not paged, so carrying an offset
    // into it would ask for a window that means nothing.
    stub(() => ({ notes: LIST.notes, total: 120 }))
    await act(async () => { render(<Notes />) })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /next/i })) })

    const box = screen.getByRole('searchbox')
    await act(async () => {
      fireEvent.change(box, { target: { value: 'basemap' } })
      fireEvent.submit(box.closest('form')!)
    })

    const last = String(
      (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0],
    )
    expect(last).toContain('q=basemap')
    expect(last).not.toMatch(/offset=[1-9]/)
  })

  it('opens a note showing what lost and why, not just what won', async () => {
    await act(async () => { render(<Notes />) })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Which basemap/ }))
    })

    expect(screen.getByText('OpenFreeMap')).toBeTruthy()
    expect(screen.getByText(/CARTO/)).toBeTruthy()
    expect(screen.getByText(/request cap on the free tier/)).toBeTruthy()
  })

  it('cites the session the decision came from', async () => {
    await act(async () => { render(<Notes />) })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Which basemap/ }))
    })
    expect(screen.getByText(/005a845f/)).toBeTruthy()
  })

  it('searches, and says plainly when nothing matches', async () => {
    await act(async () => { render(<Notes />) })
    const box = screen.getByRole('searchbox')

    await act(async () => {
      fireEvent.change(box, { target: { value: 'kubernetes' } })
      fireEvent.submit(box.closest('form')!)
    })

    expect(screen.getByText(/no matches/i)).toBeTruthy()
  })
})

describe('Regions', () => {
  beforeEach(() => { stub(() => REGIONS) })

  it('marks a project with no notes as unsurveyed', async () => {
    await act(async () => { render(<Regions />) })

    const surveyed = screen.getByText('tnm-dms-2803a2').closest('article')!
    const fogged = screen.getByText('showroom-4a03be').closest('article')!

    expect(fogged.textContent).toMatch(/unsurveyed/i)
    expect(surveyed.textContent).not.toMatch(/unsurveyed/i)
  })

  it('reports both counts, so an empty region is not mistaken for an idle one', async () => {
    await act(async () => { render(<Regions />) })
    const fogged = screen.getByText('showroom-4a03be').closest('article')!
    expect(fogged.textContent).toMatch(/13/)
    expect(fogged.textContent).toMatch(/0/)
  })

  it('says how much of the list is on screen once it does not all fit', async () => {
    stub(() => ({ regions: REGIONS.regions, total: 40 }))
    await act(async () => { render(<Regions />) })

    expect(screen.getByText(/of 40/)).toBeTruthy()
  })

  it('does not fade a region out of legibility to say it is unsurveyed', async () => {
    // Dimming the whole card took its own text below the contrast floor, and
    // said nothing the word printed beside it did not already say.
    await act(async () => { render(<Regions />) })
    const fogged = screen.getByText('showroom-4a03be').closest('article')!

    expect(fogged.className).not.toMatch(/opacity-/)
  })

  it('says the index is empty rather than showing a blank screen', async () => {
    // An empty index and a broken one look identical when the answer to both
    // is a blank page.
    stub(() => ({ regions: [] }))
    await act(async () => { render(<Regions />) })

    expect(screen.getByText(/hb ingest/)).toBeTruthy()
  })
})
