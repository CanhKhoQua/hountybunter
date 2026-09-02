import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Terminal } from '@xterm/xterm'
import { Hunt } from '../../src/client/views/Hunt.js'

/** Stands in for the browser's EventSource, which happy-dom does not provide. */
class FakeEventSource {
  static last: FakeEventSource | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  closed = false
  constructor(readonly url: string) {
    FakeEventSource.last = this
  }
  close() {
    this.closed = true
  }
  emit(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) })
  }
}

let fetchMock: ReturnType<typeof vi.fn>
let written: string[]
let onDataHandlers: ((data: string) => void)[]

const HUNT = {
  id: 'hunt-1',
  pid: 42,
  cwd: '/w/proj',
  startedAt: '2026-09-01T10:00:00.000Z',
  exitCode: null,
  killedAt: null,
  command: 'claude',
  binding: null,
}

/** As the server sends them: busiest first, and one region no transcript placed. */
const REGIONS = [
  { project: 'beta-1', sessions: 9, notes: 0, path: '/w/beta', name: 'beta', lastSeenAt: '2026-08-01T10:00:00.000Z' },
  { project: 'alpha-1', sessions: 2, notes: 0, path: '/w/alpha', name: 'alpha', lastSeenAt: '2026-09-01T10:00:00.000Z' },
  { project: 'ghost', sessions: 0, notes: 3, path: null, name: null, lastSeenAt: null },
]

/** Two levels, so descending and coming back up are both testable. */
const TREE: Record<string, unknown> = {
  '/home': {
    path: '/home',
    parent: null,
    entries: [{ name: 'Developer', path: '/home/Developer' }],
  },
  '/home/Developer': {
    path: '/home/Developer',
    parent: '/home',
    entries: [{ name: 'hountybunter', path: '/home/Developer/hountybunter' }],
  },
}

function answer(url: string) {
  if (url === '/api/hunts') return { hunts: [] }
  if (url === '/api/regions') return { regions: REGIONS }
  if (url.startsWith('/api/directories')) {
    const asked = new URL(url, 'http://x').searchParams.get('path') ?? '/home'
    // The server resolves with realpath, which drops a trailing slash. The
    // client sends one when it descends, so the fixture has to drop it too.
    return { listing: TREE[asked.replace(/(.)\/+$/, '$1')] }
  }
  if (url.startsWith('/api/hunts/')) return { hunt: HUNT }
  return {}
}

beforeEach(() => {
  written = []
  onDataHandlers = []
  FakeEventSource.last = null
  vi.stubGlobal('EventSource', FakeEventSource)
  vi.spyOn(Terminal.prototype, 'write').mockImplementation((data: string | Uint8Array) => {
    written.push(String(data))
  })
  // `onData` is a getter returning an event registrar, not a method, so the
  // spy has to replace the getter.
  vi.spyOn(Terminal.prototype, 'onData', 'get').mockReturnValue(
    ((handler: (d: string) => void) => {
      onDataHandlers.push(handler)
      return { dispose: () => undefined }
    }) as never,
  )
  fetchMock = vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
    if (init?.method === 'POST' && url === '/api/hunts') {
      return { ok: true, status: 201, json: async () => ({ hunt: HUNT }) }
    }
    return { ok: true, status: 200, json: async () => answer(url) }
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/** Start a hunt and wait until its terminal is on screen. */
async function startHunt() {
  const user = userEvent.setup()
  render(<Hunt timeZone="UTC" />)
  await user.type(await screen.findByLabelText(/directory/i), '/w/proj')
  await user.click(screen.getByRole('button', { name: /^start hunt/i }))
  await waitFor(() => expect(FakeEventSource.last).not.toBe(null))
  return user
}

/** The one list of places, so a row is never confused with the start button. */
const places = () => within(screen.getByRole('list'))

describe('Hunt', () => {
  it('puts the places you work and the places you can go in one list', async () => {
    // Two lists side by side make the user decide which one to look in before
    // they can look. Both answer "where", so both belong in one column.
    render(<Hunt timeZone="UTC" />)
    await waitFor(() => expect(places().getByText('Developer')).toBeTruthy())
    expect(places().getByText('alpha')).toBeTruthy()
    expect(places().getByText('beta')).toBeTruthy()
  })

  it('reads the tail of the path as a filter over that one list', async () => {
    // One rule for the field: up to the last slash is the directory, after it
    // is a filter. Paste, type and browse then all use the same control.
    const user = userEvent.setup()
    render(<Hunt timeZone="UTC" />)
    await user.type(await screen.findByLabelText(/directory/i), '/home/Developer/houn')

    await waitFor(() => expect(places().getByText('hountybunter')).toBeTruthy())
    expect(places().queryByText('alpha')).toBe(null)
  })

  it('reaches a directory that has never been worked in', async () => {
    // Recents can only offer places already visited. This tool's own
    // repository had zero sessions in it and was unreachable by that route.
    const user = userEvent.setup()
    render(<Hunt timeZone="UTC" />)
    await user.click(await waitFor(() => places().getByText('Developer')))
    expect(await waitFor(() => places().getByText('hountybunter'))).toBeTruthy()
  })

  it('offers the way up, and not from the root', async () => {
    const user = userEvent.setup()
    render(<Hunt timeZone="UTC" />)
    // '/home' reports no parent, so there is nowhere above it to offer.
    await waitFor(() => expect(places().getByText('Developer')).toBeTruthy())
    expect(places().queryByText(/up a level/i)).toBe(null)

    await user.click(places().getByText('Developer'))
    await user.click(await waitFor(() => places().getByText(/up a level/i)))
    expect(await waitFor(() => places().getByText('Developer'))).toBeTruthy()
  })

  it('never offers a region no transcript ever placed', async () => {
    // A note can name a project that was never ingested. Offering it would be
    // offering to start a session in a directory nobody has established.
    render(<Hunt timeZone="UTC" />)
    await waitFor(() => expect(places().getByText('Developer')).toBeTruthy())
    expect(places().queryByText(/ghost/i)).toBe(null)
  })

  it('starts exactly the path in the field, and a picked row fills it', async () => {
    // The field is the only source of truth for where a hunt starts. A row
    // that started one directly would make two controls answer one question.
    const user = userEvent.setup()
    render(<Hunt timeZone="UTC" />)
    await user.click(await waitFor(() => places().getByText('alpha')))

    const field = await screen.findByLabelText(/directory/i)
    expect((field as HTMLInputElement).value).toBe('/w/alpha')

    await user.click(screen.getByRole('button', { name: /^start hunt/i }))
    const [, init] = fetchMock.mock.calls.find(([, i]) => i?.method === 'POST')!
    expect(JSON.parse(init!.body!)).toEqual({ cwd: '/w/alpha' })
  })

  it('names the directory it is about to start in', async () => {
    // "Start hunt" alone does not say where, and the path above it is long
    // enough to be scrolled past.
    const user = userEvent.setup()
    render(<Hunt timeZone="UTC" />)
    await user.click(await waitFor(() => places().getByText('alpha')))
    expect(screen.getByRole('button', { name: /start hunt in alpha/i })).toBeTruthy()
  })

  it('starts a hunt in the directory typed and opens its stream', async () => {
    await startHunt()
    const [url, init] = fetchMock.mock.calls.find(([, i]) => i?.method === 'POST')!
    expect(url).toBe('/api/hunts')
    expect(JSON.parse(init.body).cwd).toBe('/w/proj')
    expect(FakeEventSource.last!.url).toBe('/api/hunts/hunt-1/stream')
  })

  it('writes streamed output into the terminal', async () => {
    await startHunt()
    FakeEventSource.last!.emit({ output: 'hello from the agent' })
    await waitFor(() => expect(written.join('')).toContain('hello from the agent'))
  })

  it('sends what was typed to the input endpoint', async () => {
    await startHunt()
    await waitFor(() => expect(onDataHandlers).not.toHaveLength(0))
    onDataHandlers[0]!('ls\r')
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/input'))
      expect(call).toBeTruthy()
      expect(JSON.parse(call![1].body).data).toBe('ls\r')
    })
  })

  it('says in words that a binding is a guess', async () => {
    fetchMock.mockImplementation(async (url: string, init?: { method?: string }) => {
      if (init?.method === 'POST' && url === '/api/hunts') {
        return { ok: true, status: 201, json: async () => ({ hunt: HUNT }) }
      }
      if (String(url).startsWith('/api/hunts/')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            hunt: { ...HUNT, binding: { sessionId: 'sess-9', correlation: 'guessed' } },
          }),
        }
      }
      return { ok: true, status: 200, json: async () => ({ hunts: [] }) }
    })
    await startHunt()
    expect(await screen.findByText(/guessed/i)).toBeTruthy()
    expect(await screen.findByText(/sess-9/)).toBeTruthy()
  })

  it('says a session is unbound rather than inventing one', async () => {
    await startHunt()
    // No hooks and no transcript yet. The absence is stated, not filled in.
    expect(await screen.findByText(/not bound/i)).toBeTruthy()
  })

  it('reports the exit code when the hunt ends', async () => {
    await startHunt()
    FakeEventSource.last!.emit({ exit: 7 })
    expect(await screen.findByText(/exited with 7/i)).toBeTruthy()
    await waitFor(() => expect(FakeEventSource.last!.closed).toBe(true))
  })
})
