export interface SessionRow {
  id: string
  project: string
  started_at: string | null
  title: string | null
  activities: number
  correlation?: string
  branch?: string | null
}

export interface ActivityRow {
  id: number
  seq: number
  ts: string | null
  kind: string
  tool_name: string | null
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path)
  if (!res.ok) throw new Error(`${path} answered ${res.status}`)
  return (await res.json()) as T
}

// The only place a URL string is written, so renaming a route breaks one file.
export interface NoteHit {
  id: string
  project: string
  title: string
  kind: string
  status: string
  snippet: string
}

export interface Note {
  id: string
  title: string
  question: string
  chosen: string
  status: string
  rejected: { option: string; why_not: string }[]
  evidence: { kind: string; ref: string }[]
}

export interface RegionRow {
  project: string
  sessions: number
  notes: number
  /** Where sessions here ran, or null when no transcript ever placed it. */
  path: string | null
  name: string | null
  lastSeenAt: string | null
}

export interface HuntRow {
  id: string
  pid: number
  cwd: string
  startedAt: string
  exitCode: number | null
  killedAt: string | null
  command: string
  binding: { sessionId: string; correlation: 'exact' | 'guessed' } | null
}

async function send<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  })
  if (!res.ok) {
    const detail = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(detail?.error ?? `${path} answered ${res.status}`)
  }
  return (res.status === 204 ? undefined : await res.json()) as T
}

const post = <T>(path: string, body: unknown) => send<T>('POST', path, body)

/** The window a list is asked for. Omitted, the server serves its own default. */
export interface Page {
  limit: number
  offset: number
}

/**
 * `?limit&offset`, or nothing at all when no page was asked for. Callers that
 * read a whole short list keep the bare path, which is also what keeps their
 * requests recognisable.
 */
function pageQuery(page?: Page): string {
  return page ? `?limit=${page.limit}&offset=${page.offset}` : ''
}

export const api = {
  sessions: (page?: Page) =>
    get<{ sessions: SessionRow[]; total: number }>(`/api/sessions${pageQuery(page)}`),
  session: (id: string, page?: Page) =>
    get<{ session: SessionRow; activities: ActivityRow[]; total: number }>(
      `/api/sessions/${encodeURIComponent(id)}${pageQuery(page)}`,
    ),
  notes: (query?: string, page?: Page) => {
    const params = new URLSearchParams()
    if (query) params.set('q', query)
    if (page) {
      params.set('limit', String(page.limit))
      params.set('offset', String(page.offset))
    }
    const search = params.toString()
    // A search is ranked by relevance, so the server does not page it and
    // sends no total. The plain list does both.
    return get<{ notes: NoteHit[]; total?: number }>(`/api/notes${search ? `?${search}` : ''}`)
  },
  note: (id: string) => get<{ note: Note }>(`/api/notes/${encodeURIComponent(id)}`),
  regions: (page?: Page) =>
    get<{ regions: RegionRow[]; total: number }>(`/api/regions${pageQuery(page)}`),
  /** Opens the desktop folder chooser. `path` is null when it was cancelled. */
  browse: () => post<{ path: string | null }>('/api/browse', {}),
  hunts: () => get<{ hunts: HuntRow[] }>('/api/hunts'),
  hunt: (id: string) => get<{ hunt: HuntRow }>(`/api/hunts/${encodeURIComponent(id)}`),
  startHunt: (cwd: string) => post<{ hunt: HuntRow }>('/api/hunts', { cwd: cwd.trim() }),
  sendInput: (id: string, data: string) =>
    post<void>(`/api/hunts/${encodeURIComponent(id)}/input`, { data }),
  resizeHunt: (id: string, cols: number, rows: number) =>
    post<void>(`/api/hunts/${encodeURIComponent(id)}/resize`, { cols, rows }),
  /** Signals the agent to stop. The registry keeps the hunt, marked killed. */
  stopHunt: (id: string) => send<void>('DELETE', `/api/hunts/${encodeURIComponent(id)}`),
}

/**
 * The calendar date an instant falls on, in an explicit zone. Mirrors
 * core/src/time.ts rather than importing it: the client must not pull the
 * server's SQLite dependency into the browser bundle.
 */
export function calendarDate(instant: string | null, timeZone: string): string | null {
  if (!instant) return null
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(instant))
}
