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

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const detail = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(detail?.error ?? `${path} answered ${res.status}`)
  }
  return (res.status === 204 ? undefined : await res.json()) as T
}

export const api = {
  sessions: () => get<{ sessions: SessionRow[] }>('/api/sessions'),
  session: (id: string) =>
    get<{ session: SessionRow; activities: ActivityRow[] }>(`/api/sessions/${encodeURIComponent(id)}`),
  notes: (query?: string) =>
    get<{ notes: NoteHit[] }>(query ? `/api/notes?q=${encodeURIComponent(query)}` : '/api/notes'),
  note: (id: string) => get<{ note: Note }>(`/api/notes/${encodeURIComponent(id)}`),
  regions: () => get<{ regions: RegionRow[] }>('/api/regions'),
  hunt: (id: string) => get<{ hunt: HuntRow }>(`/api/hunts/${encodeURIComponent(id)}`),
  startHunt: (cwd: string) => post<{ hunt: HuntRow }>('/api/hunts', { cwd: cwd.trim() }),
  sendInput: (id: string, data: string) =>
    post<void>(`/api/hunts/${encodeURIComponent(id)}/input`, { data }),
  resizeHunt: (id: string, cols: number, rows: number) =>
    post<void>(`/api/hunts/${encodeURIComponent(id)}/resize`, { cols, rows }),
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
