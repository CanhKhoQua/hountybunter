import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Sessions } from '../../src/client/views/Sessions.js'

afterEach(cleanup)

const LIST = {
  sessions: [
    {
      id: 'aaaa1111', project: 'proj-a', started_at: '2026-08-30T19:02:18.965Z',
      title: 'Prospects endpoint security review', branch: 'feat/prospect-customers',
      activities: 51, correlation: 'exact',
    },
    {
      id: 'bbbb2222', project: 'proj-a', started_at: '2026-08-30T01:04:57.604Z',
      title: null, branch: 'feat/prospect-customers', activities: 12, correlation: 'guessed',
    },
    {
      id: 'cccc3333', project: 'proj-a', started_at: null,
      title: 'no clock on this one', branch: null, activities: 3, correlation: 'exact',
    },
  ],
  total: 3,
}

const DETAIL = {
  total: 3,
  session: { ...LIST.sessions[0] },
  activities: [
    { id: 9, seq: 1, ts: '2026-08-30T19:02:20.000Z', kind: 'user', tool_name: null },
    { id: 7, seq: 2, ts: '2026-08-30T19:02:31.000Z', kind: 'assistant', tool_name: 'Read' },
    { id: 8, seq: 3, ts: null, kind: 'assistant', tool_name: 'Edit' },
  ],
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn((url: string) =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve(url.includes('/api/sessions/') ? DETAIL : LIST),
    }),
  ))
})

async function renderList() {
  await act(async () => { render(<Sessions timeZone="Asia/Ho_Chi_Minh" />) })
}

describe('Sessions list', () => {
  it('says the index is empty rather than showing a blank screen', async () => {
    // Nothing ingested and something broken look identical when the answer to
    // both is an empty page. The one that is fixable has to say so.
    vi.stubGlobal('fetch', vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ sessions: [] }) }),
    ))
    await renderList()

    expect(screen.getByText(/hb ingest/)).toBeTruthy()
  })

  it('asks the server for one page, not the whole index', async () => {
    await renderList()
    const url = String((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]![0])

    expect(url).toMatch(/limit=\d+/)
    expect(url).toMatch(/offset=0/)
  })

  it('fetches the next page when asked for it, rather than slicing what it has', async () => {
    // The page has to come from the server: the list it is a window onto is
    // longer than anything the client was sent.
    const fetchMock = vi.fn((url: string) =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ sessions: LIST.sessions, total: 185 }),
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    await renderList()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /next/i }))
    })

    const asked = fetchMock.mock.calls.map(([url]) => String(url))
    expect(asked.some((url) => /offset=50/.test(url))).toBe(true)
  })

  it('says how much of the index is on screen once it does not all fit', async () => {
    vi.stubGlobal('fetch', vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ sessions: LIST.sessions, total: 185 }),
      }),
    ))
    await renderList()

    expect(screen.getByText(/of 185/)).toBeTruthy()
  })

  it('keeps the guessed badge on the same line as the row it labels', async () => {
    // The row grid has a fixed number of columns; a badge given its own cell
    // fell past the last one and doubled the height of exactly those rows.
    await renderList()
    const badge = screen.getByText(/guessed/i)

    expect(badge.parentElement!.textContent).toMatch(/12 activities/)
  })

  it('shows the title, branch and activity count of each session', async () => {
    await renderList()
    expect(screen.getByText('Prospects endpoint security review')).toBeTruthy()
    expect(screen.getAllByText('feat/prospect-customers').length).toBeGreaterThan(0)
    expect(screen.getByText(/51/)).toBeTruthy()
  })

  it('dates each session in the configured zone', async () => {
    await renderList()
    // 19:02Z on the 30th is already 02:02 on the 31st in Ho Chi Minh City.
    expect(screen.getByText('2026-08-31')).toBeTruthy()
  })

  it('names an untitled session instead of printing undefined', async () => {
    await renderList()
    expect(screen.queryByText(/undefined|null/)).toBeNull()
    expect(screen.getByText(/untitled/i)).toBeTruthy()
  })

  it('says when a session has no start time rather than inventing one', async () => {
    await renderList()
    expect(screen.getByText(/undated/i)).toBeTruthy()
  })

  it('shows a guessed correlation as guessed, and says nothing when it is exact', async () => {
    await renderList()
    expect(screen.getByText(/guessed/i)).toBeTruthy()
    expect(screen.queryByText(/exact/i)).toBeNull()
  })
})

describe('Session detail', () => {
  it('opens a session and lists its activities in transcript order', async () => {
    await renderList()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Prospects endpoint security review/ }))
    })

    const rows = screen.getAllByRole('listitem')
    // Ordered by seq, not by the id the rows happen to carry.
    expect(rows[0]?.textContent).toMatch(/user/)
    expect(rows[1]?.textContent).toMatch(/Read/)
    expect(rows[2]?.textContent).toMatch(/Edit/)
  })

  it('can go back to the list', async () => {
    await renderList()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Prospects endpoint security review/ }))
    })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /back/i })) })
    expect(screen.getByText(/untitled/i)).toBeTruthy()
  })

  it('does not show a long transcript its first page in silence', async () => {
    // The bug this paging exists for: a session of thousands of activities was
    // served 500 rows with nothing said, right under a row reporting the total.
    vi.stubGlobal('fetch', vi.fn((url: string) =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve(
            String(url).includes('/api/sessions/')
              ? { ...DETAIL, total: 8308 }
              : { sessions: LIST.sessions, total: 3 },
          ),
      }),
    ))
    await renderList()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Prospects endpoint security review/ }))
    })

    expect(screen.getByText(/of 8308/)).toBeTruthy()
  })
})
