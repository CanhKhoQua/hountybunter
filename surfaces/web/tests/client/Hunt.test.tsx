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
    return { listing: TREE[asked] }
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
  render(<Hunt />)
  await user.type(await screen.findByLabelText(/directory/i), '/w/proj')
  await user.click(screen.getByRole('button', { name: /start a hunt/i }))
  await waitFor(() => expect(FakeEventSource.last).not.toBe(null))
  return user
}

describe('Hunt', () => {
  it('browses the filesystem, so a directory never worked in is reachable', async () => {
    // The recents list can only ever offer places already visited. The tool's
    // own repository had 0 sessions in it and was therefore unreachable.
    const user = userEvent.setup()
    render(<Hunt />)
    await user.click(await screen.findByRole('button', { name: /^Open Developer/ }))
    expect(await screen.findByRole('button', { name: /^Open hountybunter/ })).toBeTruthy()
  })

  it('offers to go back up, and does not at the root', async () => {
    const user = userEvent.setup()
    render(<Hunt />)
    // '/home' has no parent, so there is nothing to go up to yet.
    await screen.findByRole('button', { name: /^Open Developer/ })
    expect(screen.queryByRole('button', { name: /up one level/i })).toBe(null)

    await user.click(screen.getByRole('button', { name: /^Open Developer/ }))
    await user.click(await screen.findByRole('button', { name: /up one level/i }))
    expect(await screen.findByRole('button', { name: /^Open Developer/ })).toBeTruthy()
  })

  it('starts a hunt in the directory being browsed', async () => {
    const user = userEvent.setup()
    render(<Hunt />)
    await user.click(await screen.findByRole('button', { name: /^Open Developer/ }))
    await user.click(await screen.findByRole('button', { name: /hunt here/i }))

    const [, init] = fetchMock.mock.calls.find(([, i]) => i?.method === 'POST')!
    expect(JSON.parse(init!.body!)).toEqual({ cwd: '/home/Developer' })
  })

  it('offers the directories already worked in, most recent first', async () => {
    // The store watched every one of these sessions happen. Making the user
    // retype a path it already recorded is the tool failing to use what it has.
    render(<Hunt />)
    const offered = await screen.findAllByRole('button', { name: /^Hunt in / })
    expect(offered.map((b) => b.textContent)).toEqual([
      expect.stringContaining('/w/alpha'),
      expect.stringContaining('/w/beta'),
    ])
  })

  it('does not offer a region no transcript ever placed', async () => {
    // A note can name a project that was never ingested. Offering it would be
    // offering to start a session in a directory nobody has established.
    render(<Hunt />)
    await screen.findAllByRole('button', { name: /^Hunt in / })
    expect(screen.queryByRole('button', { name: /ghost/i })).toBe(null)
  })

  it('starts a hunt in a directory that was picked, not typed', async () => {
    const user = userEvent.setup()
    render(<Hunt />)
    await user.click(await screen.findByRole('button', { name: /^Hunt in alpha/ }))
    const [, init] = fetchMock.mock.calls.find(([, i]) => i?.method === 'POST')!
    expect(JSON.parse(init!.body!)).toEqual({ cwd: '/w/alpha' })
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
