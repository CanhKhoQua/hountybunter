import {
  getSession,
  listActivities,
  listNotes,
  listRegions,
  listSessions,
  openDb,
  searchNotes,
} from '@hountybunter/core'

export interface Response {
  status: number
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any
}

/**
 * Maps a method and path to a plain response. Deliberately knows nothing about
 * node:http, so every endpoint is testable without opening a socket.
 */
export async function handle(
  method: string,
  rawPath: string,
  _body: unknown,
  env: NodeJS.ProcessEnv = process.env,
): Promise<Response> {
  const [path, search] = rawPath.split('?')
  const params = new URLSearchParams(search ?? '')

  if (method !== 'GET') return { status: 404, body: { error: `no route for ${method} ${path}` } }

  // One connection per request, always closed: the index is a file, and a
  // handle left open blocks the rebuild that is meant to be able to delete it.
  const db = openDb(env)
  try {
    if (path === '/api/sessions') {
      return { status: 200, body: { sessions: listSessions(db, { limit: 200 }) } }
    }

    const detail = path.match(/^\/api\/sessions\/([^/]+)$/)
    if (detail) {
      const id = decodeURIComponent(detail[1]!)
      const session = getSession(db, id)
      if (!session) return { status: 404, body: { error: `no session ${id}` } }
      return { status: 200, body: { session, activities: listActivities(db, id) } }
    }

    if (path === '/api/notes') {
      const query = params.get('q')?.trim()
      const notes = query ? searchNotes(db, query) : listNotes(db)
      return { status: 200, body: { notes } }
    }

    if (path === '/api/regions') {
      return { status: 200, body: { regions: listRegions(db) } }
    }

    return { status: 404, body: { error: `no route for ${method} ${path}` } }
  } finally {
    db.close()
  }
}
