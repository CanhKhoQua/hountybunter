import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
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

/** What the desktop chooser answered, or null for a cancelled dialog. */
let chosen: string | null = '/home/Developer/hountybunter'

/** What `GET /api/hunts` reports: hunts the server still holds. */
let running: unknown[] = []

function answer(url: string) {
  if (url === '/api/hunts') return { hunts: running }
  if (url === '/api/regions') return { regions: REGIONS }
  if (url.startsWith('/api/hunts/')) return { hunt: HUNT }
  return {}
}

beforeEach(() => {
  // Reset, or one test cancelling the dialog decides what every later test
  // sees — a pass that depends on file order proves nothing.
  chosen = '/home/Developer/hountybunter'
  running = []
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
    if (init?.method === 'POST' && url === '/api/browse') {
      return { ok: true, status: 200, json: async () => ({ path: chosen }) }
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


describe('Hunt', () => {
  it('attaches to a hunt that is still running when it opens', async () => {
    // Switching to another view unmounts this one, and the terminal goes with
    // it. The agent does not: the server holds the process and replays its
    // last output to a new subscriber. Coming back showed the start form,
    // which reads as a session that died when it is still there.
    running = [HUNT]
    render(<Hunt timeZone="UTC" />)

    await waitFor(() => expect(FakeEventSource.last).not.toBe(null))
    expect(FakeEventSource.last!.url).toBe('/api/hunts/hunt-1/stream')
    expect(screen.queryByLabelText(/directory/i)).toBe(null)
  })

  it('does not attach to a hunt that has exited', async () => {
    // Death is a state the registry keeps on purpose, so a finished hunt is
    // still listed. Re-attaching to one would show a terminal nothing writes
    // to and hide the way to start another.
    running = [{ ...HUNT, exitCode: 0 }]
    render(<Hunt timeZone="UTC" />)

    expect(await screen.findByLabelText(/directory/i)).toBeTruthy()
    expect(FakeEventSource.last).toBe(null)
  })

  it('attaches to the newest of several live hunts', async () => {
    running = [
      { ...HUNT, id: 'older', startedAt: '2026-09-01T09:00:00.000Z' },
      { ...HUNT, id: 'newest', startedAt: '2026-09-01T11:00:00.000Z' },
      { ...HUNT, id: 'middle', startedAt: '2026-09-01T10:00:00.000Z' },
    ]
    render(<Hunt timeZone="UTC" />)

    await waitFor(() => expect(FakeEventSource.last).not.toBe(null))
    expect(FakeEventSource.last!.url).toBe('/api/hunts/newest/stream')
  })

  it('fills the field from the desktop chooser', async () => {
    // Browse is one button and one dialog. A page cannot learn the absolute
    // path of a directory a person picks, so the server opens the chooser.
    const user = userEvent.setup()
    render(<Hunt timeZone="UTC" />)
    await user.click(screen.getByRole('button', { name: /browse/i }))

    await waitFor(() =>
      expect((screen.getByLabelText(/directory/i) as HTMLInputElement).value).toBe(
        '/home/Developer/hountybunter',
      ),
    )
  })

  it('leaves the field alone when the dialog is cancelled', async () => {
    // Closing a chooser is how a person says "not this". Clearing what they
    // had typed would punish them for looking.
    chosen = null
    const user = userEvent.setup()
    render(<Hunt timeZone="UTC" />)
    await user.type(await screen.findByLabelText(/directory/i), '/w/typed')
    await user.click(screen.getByRole('button', { name: /browse/i }))

    expect((screen.getByLabelText(/directory/i) as HTMLInputElement).value).toBe('/w/typed')
  })

  it('lists where you work, so the common case needs no dialog at all', async () => {
    render(<Hunt timeZone="UTC" />)
    await waitFor(() => expect(screen.getByText('alpha')).toBeTruthy())
    expect(screen.getByText('beta')).toBeTruthy()
    // A note can name a project never ingested; offering it would offer to
    // start a session in a directory nobody has established.
    expect(screen.queryByText(/ghost/i)).toBe(null)
  })

  it('shows only the places worked in most recently, and offers the rest', async () => {
    // Not paged: this is a picker inside a form, and it is the *recent* list —
    // page three of "recent" answers nobody's question. It caps and expands.
    const many = Array.from({ length: 14 }, (_, i) => ({
      project: `p${i}`,
      sessions: 1,
      notes: 0,
      path: `/w/p${i}`,
      name: `place-${i}`,
      lastSeenAt: `2026-08-${String(i + 1).padStart(2, '0')}T10:00:00.000Z`,
    }))
    fetchMock.mockImplementation(async (url: string) => ({
      ok: true,
      status: 200,
      json: async () => (url === '/api/regions' ? { regions: many } : { hunts: [] }),
    }))
    const user = userEvent.setup()
    render(<Hunt timeZone="UTC" />)

    // Newest first, so the most recent survives the cap and the oldest does not.
    expect(await screen.findByText('place-13')).toBeTruthy()
    expect(screen.queryByText('place-0')).toBe(null)

    await user.click(screen.getByRole('button', { name: /show all/i }))
    expect(screen.getByText('place-0')).toBeTruthy()
  })

  it('starts exactly the path in the field, and a listed row fills it', async () => {
    // The field is the only source of truth for where a hunt starts. A row
    // that started one directly would make two controls answer one question.
    const user = userEvent.setup()
    render(<Hunt timeZone="UTC" />)
    await user.click(await waitFor(() => screen.getByText('alpha')))

    expect((screen.getByLabelText(/directory/i) as HTMLInputElement).value).toBe('/w/alpha')

    await user.click(screen.getByRole('button', { name: /^start hunt/i }))
    const call = fetchMock.mock.calls.find(([u, i]) => u === '/api/hunts' && i?.method === 'POST')!
    expect(JSON.parse(call[1]!.body!)).toEqual({ cwd: '/w/alpha' })
  })

  it('names the directory it is about to start in', async () => {
    // "Start hunt" alone does not say where, and the path beside it is long
    // enough to be read past.
    const user = userEvent.setup()
    render(<Hunt timeZone="UTC" />)
    await user.click(await waitFor(() => screen.getByText('alpha')))
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

  it('can stop the hunt it is attached to', async () => {
    // Starting an agent you cannot stop leaves killing the server as the only
    // way out. The registry already knows how; the page just never asked.
    const user = await startHunt()
    await user.click(screen.getByRole('button', { name: /stop hunt/i }))

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([, i]) => i?.method === 'DELETE')
      expect(call?.[0]).toBe('/api/hunts/hunt-1')
    })
  })

  it('offers the way back once the hunt has ended', async () => {
    // A dead terminal that cannot be dismissed is a dead end: the only way to
    // start another was to reload the page.
    const user = await startHunt()
    FakeEventSource.last!.emit({ exit: 0 })

    await user.click(await screen.findByRole('button', { name: /start another/i }))
    expect(await screen.findByLabelText(/directory/i)).toBeTruthy()
  })

  it('stops offering to stop a hunt that has already ended', async () => {
    await startHunt()
    FakeEventSource.last!.emit({ exit: 0 })

    await waitFor(() => expect(screen.queryByRole('button', { name: /stop hunt/i })).toBe(null))
  })
})
