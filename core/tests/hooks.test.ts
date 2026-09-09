import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { openDb } from '../src/db/open.js'
import { getSession, listSessions } from '../src/db/query.js'
import { portFile, spoolFile } from '../src/paths.js'
import { receiveHookEvent } from '../src/hooks/receive.js'

let env: NodeJS.ProcessEnv
let home: string
let db: ReturnType<typeof openDb>

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'hb-hooks-'))
  env = { HOUNTYBUNTER_HOME: home } as NodeJS.ProcessEnv
  db = openDb(env)
})

const event = {
  hook_event_name: 'SessionStart',
  session_id: 'sess-1',
  cwd: '/Users/x/myproject',
  timestamp: '2026-09-01T10:00:00.000Z',
}

describe('paths', () => {
  it('puts the port and spool files in the store', () => {
    expect(portFile(env)).toBe(join(home, 'port'))
    expect(spoolFile(env)).toBe(join(home, 'spool.jsonl'))
  })
})

describe('receiveHookEvent', () => {
  it('records the event', () => {
    const result = receiveHookEvent(db, event)
    expect(result.ok).toBe(true)

    const rows = db.prepare('SELECT * FROM hook_events').all() as { session_id: string }[]
    expect(rows).toHaveLength(1)
    expect(rows[0]?.session_id).toBe('sess-1')
  })

  it('stores the same event twice as one row', () => {
    receiveHookEvent(db, event)
    receiveHookEvent(db, event)
    expect(db.prepare('SELECT COUNT(*) n FROM hook_events').get()).toEqual({ n: 1 })
  })

  it('creates the session it names, bound exactly', () => {
    receiveHookEvent(db, event)
    const session = getSession(db, 'sess-1')
    expect(session?.correlation).toBe('exact')
    expect(session?.project).toMatch(/^myproject-/)
  })

  it('upgrades a guessed session to exact without disturbing what ingest found', () => {
    db.prepare(
      `INSERT INTO sessions (id, project, started_at, title, correlation, harness)
       VALUES ('sess-1', 'myproject-abc123', '2026-09-01T09:59:00.000Z', 'from the transcript', 'guessed', 'claude-code')`,
    ).run()

    receiveHookEvent(db, event)

    const session = getSession(db, 'sess-1')
    expect(session?.correlation).toBe('exact')
    // The hook knows the id; the transcript knows the content. Neither wins twice.
    expect(session?.title).toBe('from the transcript')
    expect(session?.started_at).toBe('2026-09-01T09:59:00.000Z')
  })

  it('remembers the directory the hook came from', () => {
    // A hook is the only thing that reports a directory while the session is
    // still running, and the slug it derives cannot be turned back into a
    // path. Without this, a project the store knows only through hooks can be
    // named but never opened.
    receiveHookEvent(db, event)

    const row = db.prepare('SELECT * FROM projects').get() as Record<string, unknown>
    expect(row.path).toBe('/Users/x/myproject')
    expect(row.name).toBe('myproject')
    // Deliberately absent: a real hook payload carries no timestamp, and a
    // column filled in from one would read differently after a rebuild.
    expect(row.last_seen_at).toBe(null)
  })

  it('leaves the timestamp a transcript established alone', () => {
    db.prepare(
      `INSERT INTO projects (path, slug, name, last_seen_at)
       VALUES ('/Users/x/myproject', 'x', 'myproject', '2026-09-01T10:00:00.000Z')`,
    ).run()

    receiveHookEvent(db, event)

    const row = db.prepare('SELECT last_seen_at FROM projects').get() as { last_seen_at: string }
    expect(row.last_seen_at).toBe('2026-09-01T10:00:00.000Z')
  })

  it('keeps an unknown event kind, with its payload, instead of dropping it', () => {
    const result = receiveHookEvent(db, { ...event, hook_event_name: 'SomethingNewInTheFuture' })
    expect(result.ok).toBe(true)
    expect(result.unknownKind).toBe(true)

    const row = db.prepare('SELECT payload_json FROM hook_events').get() as { payload_json: string }
    expect(JSON.parse(row.payload_json).hook_event_name).toBe('SomethingNewInTheFuture')
  })

  it('refuses an event with no session id, saying why', () => {
    const result = receiveHookEvent(db, { hook_event_name: 'SessionStart' })
    expect(result.ok).toBe(false)
    expect(String(result.error)).toMatch(/session_id/)
    expect(db.prepare('SELECT COUNT(*) n FROM hook_events').get()).toEqual({ n: 0 })
  })

  it('does not invent a session for an event it rejected', () => {
    receiveHookEvent(db, { hook_event_name: 'Stop' })
    expect(listSessions(db)).toEqual([])
  })
})
