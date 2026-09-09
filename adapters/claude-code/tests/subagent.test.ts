import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { listSessions, openDb, projectSlug } from '@hountybunter/core'
import { syncArchive } from '../src/archive.js'
import { findTranscripts } from '../src/locate.js'
import { ingestAll } from '../src/ingest.js'

let env: NodeJS.ProcessEnv
let live: string
let db: ReturnType<typeof openDb>

const PARENT = 'parent-sess'
const CWD = '/w/proj'

const line = (extra: Record<string, unknown>) =>
  JSON.stringify({ type: 'user', timestamp: '2026-08-20T10:00:00.000Z', cwd: CWD, ...extra })

beforeEach(async () => {
  const home = await mkdtemp(join(tmpdir(), 'hb-sub-'))
  live = await mkdtemp(join(tmpdir(), 'hb-live-'))
  env = { HOUNTYBUNTER_HOME: home, HOUNTYBUNTER_TRANSCRIPTS: live } as NodeJS.ProcessEnv
  db = openDb(env)

  await mkdir(join(live, '-w-proj', PARENT, 'subagents'), { recursive: true })
  await writeFile(
    join(live, '-w-proj', `${PARENT}.jsonl`),
    `${line({ sessionId: PARENT })}\n`,
  )
  // A subagent transcript names its parent in `sessionId` and itself in
  // `agentId`; the filename carries the agent id. Verified across all 80 on
  // this machine, so none of this is inferred.
  await writeFile(
    join(live, '-w-proj', PARENT, 'subagents', 'agent-abc123.jsonl'),
    `${line({ sessionId: PARENT, agentId: 'abc123', isSidechain: true })}\n` +
      `${line({ sessionId: PARENT, agentId: 'abc123', isSidechain: true })}\n`,
  )
  await syncArchive(env)
})

describe('subagent transcripts', () => {
  it('are found for ingest, not only archived', async () => {
    const ids = (await findTranscripts(env)).map((f) => f.sessionId).sort()
    expect(ids).toEqual(['agent-abc123', PARENT])
  })

  it('are attributed to the project, not to the parent session directory', async () => {
    const sub = (await findTranscripts(env)).find((f) => f.sessionId === 'agent-abc123')!
    expect(sub.projectDir).toBe('-w-proj')
  })

  it('become their own session, pointing at the parent', async () => {
    await ingestAll(db, env)
    const row = db.prepare('SELECT parent_id, project FROM sessions WHERE id = ?').get('agent-abc123')
    // Computed, not pinned: hard-coding the hash would assert my arithmetic
    // rather than that the subagent lands in the same project as its parent.
    expect(row).toEqual({ parent_id: PARENT, project: projectSlug(CWD) })
  })

  it('leave the parent without a parent of its own', async () => {
    await ingestAll(db, env)
    expect(db.prepare('SELECT parent_id FROM sessions WHERE id = ?').get(PARENT)).toEqual({
      parent_id: null,
    })
  })

  it('record their activities under their own id', async () => {
    await ingestAll(db, env)
    const { c } = db
      .prepare('SELECT COUNT(*) c FROM activities WHERE session_id = ?')
      .get('agent-abc123') as { c: number }
    expect(c).toBe(2)
  })

  it('stay out of the session list unless asked for', async () => {
    // Eighty anonymous agent runs would bury the sessions a person recognises.
    await ingestAll(db, env)
    expect(listSessions(db).map((s) => s.id)).toEqual([PARENT])
    expect(listSessions(db, { parent: PARENT }).map((s) => s.id)).toEqual(['agent-abc123'])
  })
})
