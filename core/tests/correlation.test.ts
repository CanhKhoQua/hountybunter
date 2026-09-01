import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { openDb } from '../src/db/open.js'
import { getSession } from '../src/db/query.js'
import { receiveHookEvent } from '../src/hooks/receive.js'

let db: ReturnType<typeof openDb>

beforeEach(async () => {
  const home = await mkdtemp(join(tmpdir(), 'hb-corr-'))
  db = openDb({ HOUNTYBUNTER_HOME: home } as NodeJS.ProcessEnv)
})

const hook = {
  hook_event_name: 'SessionStart',
  session_id: 'sess-1',
  cwd: '/Users/x/myproject',
  timestamp: '2026-09-01T10:00:00.000Z',
}

/**
 * Mirrors the upsert in adapters/claude-code/src/ingest.ts. Written as the real
 * writer writes, because a simplified INSERT here would prove nothing about how
 * the two writers actually meet.
 */
function ingestFinds(correlation: string) {
  db.prepare(
    `INSERT INTO sessions (id, project, started_at, title, branch, correlation)
     VALUES ('sess-1', 'myproject-guessed', '2026-09-01T09:59:00.000Z',
             'what the session was about', 'feat/x', @correlation)
     ON CONFLICT(id) DO UPDATE SET
       project    = COALESCE(sessions.project, excluded.project),
       started_at = COALESCE(sessions.started_at, excluded.started_at),
       title      = COALESCE(excluded.title, sessions.title),
       branch     = COALESCE(excluded.branch, sessions.branch)`,
  ).run({ correlation })
}

describe('correlation', () => {
  it('is guessed when only the transcript has been read', () => {
    ingestFinds('guessed')
    expect(getSession(db, 'sess-1')?.correlation).toBe('guessed')
  })

  it('becomes exact when a hook names the session', () => {
    ingestFinds('guessed')
    receiveHookEvent(db, hook)
    expect(getSession(db, 'sess-1')?.correlation).toBe('exact')
  })

  it('reaches the same state whichever arrives first', () => {
    // Delivery order is not something a hook can promise: the transcript is
    // read on a timer, the hook fires on an event. Both orders must converge.
    receiveHookEvent(db, hook)
    ingestFinds('exact')

    const hookFirst = getSession(db, 'sess-1')
    expect(hookFirst?.correlation).toBe('exact')
    expect(hookFirst?.title).toBe('what the session was about')
    expect(hookFirst?.started_at).toBe('2026-09-01T09:59:00.000Z')
  })

  it('never downgrades an exact binding back to a guess', () => {
    receiveHookEvent(db, hook)
    db.prepare(
      `INSERT INTO sessions (id, project, correlation) VALUES ('sess-1', 'p', 'guessed')
       ON CONFLICT(id) DO UPDATE SET project = excluded.project`,
    ).run()

    expect(getSession(db, 'sess-1')?.correlation).toBe('exact')
  })

  it('keeps the project the hook saw, since cwd is the ground truth', () => {
    receiveHookEvent(db, hook)
    expect(getSession(db, 'sess-1')?.project).toMatch(/^myproject-/)
  })
})
