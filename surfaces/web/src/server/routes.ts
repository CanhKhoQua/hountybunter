import {
  getNote,
  getSession,
  indexNote,
  listActivities,
  listNotes,
  listRegions,
  listSessions,
  openDb,
  receiveHookEvent,
  recordDecision,
  searchNotes,
} from '@hountybunter/core'
import type { Evidence, RejectedOption } from '@hountybunter/core'
import { statSync } from 'node:fs'
import { bindHunt, latestHookId, type Binding } from '@hountybunter/adapter-claude-code'
import { chooseDirectory } from './choose.js'
import { HuntRegistry, type Hunt } from './hunts.js'

/** Request headers, lower-cased as Node delivers them. */
export type Headers = Record<string, string | string[] | undefined>

/**
 * Where a reconnecting client wants the stream resumed, from its
 * `Last-Event-ID`. Anything that is not a whole number is no answer at all:
 * the header is whatever the client sent, and a NaN reaching a slice would
 * silently cost that client its backlog.
 */
function resumeFrom(headers: Headers): number | undefined {
  const raw = headers['last-event-id']
  const value = Array.isArray(raw) ? raw[0] : raw
  if (value === undefined) return undefined
  const at = Number(value)
  return Number.isInteger(at) && at >= 0 ? at : undefined
}

export interface Response {
  status: number
  /** Absent for 204: a hook is told nothing, so there is nothing to send. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body?: any
  headers?: Record<string, string>
  /**
   * A response that stays open. `serve.ts` wires the writer to the socket and
   * calls the returned function when the client disconnects. Kept here rather
   * than in the http shim so a stream is testable without a socket, like every
   * other route.
   */
  stream?: (write: (chunk: string) => void, end: () => void) => () => void
}

/** Hunts outlive a request, so the registry is per-process, not per-call. */
const defaultHunts = new HuntRegistry()

/**
 * The agent binary to run. Taken from the environment, never from the request:
 * this port has no auth by design (§2, one local user), and a client-supplied
 * command would turn that into arbitrary execution for anything on the machine
 * that can post a form.
 */
function agentCommand(env: NodeJS.ProcessEnv): string {
  return env.HOUNTYBUNTER_AGENT_CMD || 'claude'
}

/** A hunt as the wire sees it: no process handle, no listeners. */
function publicHunt(hunt: Hunt, command: string, binding: Binding | null = null) {
  return {
    id: hunt.id,
    pid: hunt.pid,
    startedAt: hunt.startedAt,
    cwd: hunt.cwd,
    exitCode: hunt.exitCode,
    killedAt: hunt.killedAt,
    command,
    // Null until something supports a binding. Never a placeholder id, and
    // never `exact` for anything a hook did not name.
    binding,
  }
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
  hunts: HuntRegistry = defaultHunts,
  headers: Headers = {},
): Promise<Response> {
  const [path = '/', search] = rawPath.split('?')
  const params = new URLSearchParams(search ?? '')

  if (method === 'POST' && path === '/hook') return receiveHook(body, env)
  if (method === 'POST' && path === '/api/notes') return recordNote(body as DecisionBody, env)

  // POST, because it opens a dialog on the desktop: asking twice is not the
  // same as asking once. A cancelled dialog is a 200 with no path, not an
  // error — declining to choose is a normal answer.
  if (method === 'POST' && path === '/api/browse') {
    return { status: 200, body: { path: await chooseDirectory(env) } }
  }

  const hunted = path.match(/^\/api\/hunts(?:\/([^/]+))?(?:\/(stream|input|resize))?$/)
  if (hunted) {
    const [, id, action] = hunted
    return huntRoute(method, id, action, body, env, hunts, headers)
  }

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
        // The form is a person typing into boxes. When a path arrives that
        // records what an agent proposed, it declares itself there — this is
        // not a default to inherit.
        origin: 'authored',
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

/**
 * Take one hook event. Answers immediately and says nothing back: the hook is
 * fire-and-forget by contract (spec §7.2), and anything this returns is work
 * the agent's own session would have waited for.
 */
function receiveHook(body: unknown, env: NodeJS.ProcessEnv): Response {
  const db = openDb(env)
  try {
    const result = receiveHookEvent(db, (body ?? {}) as Record<string, unknown>)
    if (!result.ok) return { status: 400, body: { error: result.error } }
    return { status: 204 }
  } finally {
    db.close()
  }
}

interface HuntBody {
  cwd?: string
  cols?: number
  rows?: number
  data?: string
}

async function huntRoute(
  method: string,
  id: string | undefined,
  action: string | undefined,
  body: unknown,
  env: NodeJS.ProcessEnv,
  hunts: HuntRegistry,
  headers: Headers,
): Promise<Response> {
  const command = agentCommand(env)

  if (!id) {
    if (method === 'GET') {
      return { status: 200, body: { hunts: hunts.list().map((h) => publicHunt(h, command)) } }
    }
    if (method === 'POST') return startHunt(body as HuntBody, env, hunts, command)
    return { status: 404, body: { error: `no route for ${method} /api/hunts` } }
  }

  const hunt = hunts.get(id)
  if (!hunt) return { status: 404, body: { error: `no hunt ${id}` } }

  if (method === 'GET' && !action) {
    // Resolved per request, not frozen at spawn: a hook is fire-and-forget and
    // can arrive after the first paint, upgrading a guess to exact.
    const db = openDb(env)
    try {
      const binding = await bindHunt(
        db,
        { cwd: hunt.cwd, sinceHookId: hunt.sinceHookId, startedAt: hunt.startedAt },
        env,
      )
      return { status: 200, body: { hunt: publicHunt(hunt, command, binding) } }
    } finally {
      db.close()
    }
  }

  if (method === 'DELETE' && !action) {
    hunts.kill(id)
    return { status: 204 }
  }

  if (method === 'GET' && action === 'stream') {
    return {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        // Without this a proxy can hold the whole stream to buffer it, which
        // for a terminal means the screen arrives after the session ends.
        Connection: 'keep-alive',
      },
      // The registry replays its backlog to a new subscriber, so a tab opened
      // after the agent started talking still sees what it said — and tells it
      // when the agent is gone, so the connection ends instead of hanging.
      // Every frame is numbered with the position after it, and a reconnecting
      // browser sends that number back in Last-Event-ID. Without it the only
      // thing a reconnect can do is replay the buffer, printing the last
      // screen twice — and EventSource reconnects by itself, so that is not a
      // rare case.
      stream: (write, end) =>
        hunt.subscribe(
          (output, at) => write(`id: ${at}\ndata: ${JSON.stringify({ output })}\n\n`),
          () => {
            write(`data: ${JSON.stringify({ exit: hunt.exitCode })}\n\n`)
            end()
          },
          resumeFrom(headers),
        ),
    }
  }

  const payload = (body ?? {}) as HuntBody
  if (method === 'POST' && action === 'input') {
    if (typeof payload.data !== 'string') {
      return { status: 400, body: { error: 'input needs a string `data`' } }
    }
    hunt.write(payload.data)
    return { status: 204 }
  }

  if (method === 'POST' && action === 'resize') {
    const { cols, rows } = payload
    if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols! < 1 || rows! < 1) {
      return { status: 400, body: { error: 'resize needs positive whole `cols` and `rows`' } }
    }
    hunt.resize(cols!, rows!)
    return { status: 204 }
  }

  return { status: 404, body: { error: `no route for ${method} /api/hunts/${id}` } }
}

function startHunt(
  body: HuntBody,
  env: NodeJS.ProcessEnv,
  hunts: HuntRegistry,
  command: string,
): Response {
  const cwd = body?.cwd?.trim()
  if (!cwd) return { status: 400, body: { error: 'cwd is required' } }
  try {
    if (!statSync(cwd).isDirectory()) throw new Error('not a directory')
  } catch {
    return { status: 400, body: { error: `cannot start a hunt in ${cwd}: no such directory` } }
  }

  try {
    // Only the working directory comes from the request. Command, args and
    // environment are the server's, and the environment passes through
    // untouched so the agent loads exactly what it would in a terminal.
    const db = openDb(env)
    let sinceHookId: number
    try {
      sinceHookId = latestHookId(db)
    } finally {
      db.close()
    }
    const hunt = hunts.start({ command, cwd, cols: body.cols, rows: body.rows, env, sinceHookId })
    return { status: 201, body: { hunt: publicHunt(hunt, command) } }
  } catch (error) {
    // The ceiling is a normal condition a client should handle, not a crash.
    return { status: 429, body: { error: (error as Error).message } }
  }
}
