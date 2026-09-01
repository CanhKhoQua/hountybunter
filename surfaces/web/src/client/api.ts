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
export const api = {
  sessions: () => get<{ sessions: SessionRow[] }>('/api/sessions'),
  session: (id: string) =>
    get<{ session: SessionRow; activities: ActivityRow[] }>(`/api/sessions/${encodeURIComponent(id)}`),
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
