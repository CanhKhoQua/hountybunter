import {
  getNote,
  getSession,
  indexNote,
  listActivities,
  listNotes,
  listRegions,
  listSessions,
  openDb,
  recordDecision,
  searchNotes,
} from '@hountybunter/core'
import type { Evidence, RejectedOption } from '@hountybunter/core'

export interface Response {
  status: number
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any
}

/**
 * Maps a method and path to a plain response. Deliberately knows nothing about
 * node:http, so every endpoint is testable without opening a socket.
 */
interface DecisionBody {
  sessionId?: string
  question?: string
  chosen?: string
  title?: string
  rejected?: RejectedOption[]
  evidence?: Evidence[]
}

export async function handle(
  method: string,
  rawPath: string,
  body: unknown,
  env: NodeJS.ProcessEnv = process.env,
): Promise<Response> {
  const [path = '/', search] = rawPath.split('?')
  const params = new URLSearchParams(search ?? '')

  if (method === 'POST' && path === '/api/notes') return recordNote(body as DecisionBody, env)
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

    const noteDetail = path.match(/^\/api\/notes\/(.+)$/)
    if (noteDetail) {
      const id = decodeURIComponent(noteDetail[1]!)
      const note = await getNote(db, id)
      if (!note) return { status: 404, body: { error: `no note ${id}` } }
      return { status: 200, body: { note } }
    }

    if (path === '/api/regions') {
      return { status: 200, body: { regions: listRegions(db) } }
    }

    return { status: 404, body: { error: `no route for ${method} ${path}` } }
  } finally {
    db.close()
  }
}

/**
 * Record a decision against a session that already happened. The note is built
 * by `core`, so it is byte-identical to what `hb promote` would have written,
 * and the session it came from is cited as evidence without being typed.
 */
async function recordNote(body: DecisionBody, env: NodeJS.ProcessEnv): Promise<Response> {
  const sessionId = body?.sessionId?.trim()
  if (!sessionId) return { status: 400, body: { error: 'sessionId is required' } }
  if (!body?.question?.trim()) return { status: 400, body: { error: 'question is required' } }
  if (!body?.chosen?.trim()) return { status: 400, body: { error: 'chosen is required' } }

  const db = openDb(env)
  try {
    const session = getSession(db, sessionId)
    if (!session) return { status: 404, body: { error: `no session ${sessionId}` } }

    const evidence: Evidence[] = [...(body.evidence ?? [])]
    if (!evidence.some((e) => e.kind === 'session' && e.ref === sessionId)) {
      evidence.push({ kind: 'session', ref: sessionId })
    }

    const note = await recordDecision(
      {
        project: session.project,
        // Dated from when the session ran. Recording it a week later must not
        // claim the decision was made a week later.
        instant: session.started_at ?? new Date().toISOString(),
        question: body.question,
        chosen: body.chosen,
        title: body.title,
        rejected: body.rejected ?? [],
        evidence,
      },
      { env },
    )

    indexNote(db, note)
    return { status: 201, body: { note } }
  } finally {
    db.close()
  }
}
