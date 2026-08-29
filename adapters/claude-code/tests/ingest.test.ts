import { appendFile, cp, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it } from 'vitest'
import { openDb } from '@hountybunter/core'
import { ingestAll } from '../src/ingest.js'

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')
const NOW = '2026-08-27T12:00:00.000Z'

let db: ReturnType<typeof openDb>
let env: NodeJS.ProcessEnv

async function stage(fixture: string, sessionId: string) {
  const dir = join(env.HOUNTYBUNTER_TRANSCRIPTS!, '-Users-x-proj')
  await mkdir(dir, { recursive: true })
  await cp(join(FIXTURES, fixture), join(dir, `${sessionId}.jsonl`))
}

beforeEach(async () => {
  const home = await mkdtemp(join(tmpdir(), 'hb-'))
  env = {
    HOUNTYBUNTER_HOME: home,
    HOUNTYBUNTER_TRANSCRIPTS: join(home, 'transcripts'),
  } as NodeJS.ProcessEnv
  db = openDb(env)
})

describe('ingestAll', () => {
  it('creates a session and its activities', async () => {
    await stage('session-basic.jsonl', 'aaaa-1111')
    const report = await ingestAll(db, env, NOW)

    expect(report.sessions).toBe(1)
    expect(report.activities).toBe(4)
    expect(report.skippedLines).toBe(0)

    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get('aaaa-1111') as Record<string, unknown>
    expect(session.branch).toBe('main')
    expect(session.effort).toBe('high')
    expect(session.title).toBe('Fix the parser')
    expect(session.started_at).toBe('2026-08-27T10:00:00.000Z')
    expect(session.ended_at).toBe('2026-08-27T10:00:12.000Z')
  })

  it('records tool names and skill attribution', async () => {
    await stage('session-basic.jsonl', 'aaaa-1111')
    await ingestAll(db, env, NOW)

    expect(db.prepare('SELECT tool_name FROM activities WHERE tool_name IS NOT NULL ORDER BY seq').all())
      .toEqual([{ tool_name: 'Bash' }, { tool_name: 'Write' }])
    expect(db.prepare('SELECT attr_skill FROM activities WHERE attr_skill IS NOT NULL').get())
      .toEqual({ attr_skill: 'superpowers:brainstorming' })
  })

  it('derives the project from cwd', async () => {
    await stage('session-basic.jsonl', 'aaaa-1111')
    await ingestAll(db, env, NOW)
    const row = db.prepare('SELECT project FROM sessions WHERE id = ?').get('aaaa-1111') as { project: string }
    expect(row.project).toMatch(/^proj-[0-9a-f]{6}$/)
  })

  it('survives malformed lines and keeps unknown record types', async () => {
    await stage('session-damaged.jsonl', 'bbbb-2222')
    const report = await ingestAll(db, env, NOW)

    expect(report.skippedLines).toBe(2)
    expect(report.unknownKinds['brand-new-record-type']).toBe(1)

    const kinds = db
      .prepare('SELECT kind FROM activities WHERE session_id = ? ORDER BY seq')
      .all('bbbb-2222')
      .map((r) => (r as { kind: string }).kind)
    expect(kinds).toContain('brand-new-record-type')

    const payload = db
      .prepare("SELECT payload_json FROM activities WHERE kind = 'brand-new-record-type'")
      .get() as { payload_json: string }
    expect(JSON.parse(payload.payload_json).payload).toEqual({ a: 1 })
  })

  it('is idempotent — a second run adds nothing', async () => {
    await stage('session-basic.jsonl', 'aaaa-1111')
    await ingestAll(db, env, NOW)
    const report = await ingestAll(db, env, NOW)

    expect(report.activities).toBe(0)
    expect(db.prepare('SELECT COUNT(*) c FROM activities').get()).toEqual({ c: 4 })
  })

  it('handles an empty transcript root', async () => {
    expect(await ingestAll(db, env, NOW))
      .toEqual({ sessions: 0, activities: 0, skippedLines: 0, unknownKinds: {} })
  })

  it('never advances the cursor unless the rows it derived from are committed', async () => {
    const dir = join(env.HOUNTYBUNTER_TRANSCRIPTS!, '-Users-x-proj')
    await mkdir(dir, { recursive: true })
    const filePath = join(dir, 'cccc-3333.jsonl')
    const lines = [
      '{"type":"user","cwd":"/Users/x/proj","timestamp":"2026-08-27T13:00:00.000Z"}',
      '{"type":"force-fail-marker","cwd":"/Users/x/proj","timestamp":"2026-08-27T13:00:01.000Z"}',
    ]
    await writeFile(filePath, `${lines.join('\n')}\n`)

    // Force a real, non-mocked failure mid-transaction: a genuine SQLite
    // trigger that aborts the insert as soon as this specific record type
    // reaches the activities table.
    db.exec(`
      CREATE TRIGGER force_fail
      BEFORE INSERT ON activities
      WHEN NEW.kind = 'force-fail-marker'
      BEGIN
        SELECT RAISE(ABORT, 'forced failure for test');
      END;
    `)

    await expect(ingestAll(db, env, NOW)).rejects.toThrow(/forced failure for test/)

    // Nothing committed: no session, no activities, and the cursor never advanced.
    expect(db.prepare('SELECT COUNT(*) c FROM sessions').get()).toEqual({ c: 0 })
    expect(db.prepare('SELECT COUNT(*) c FROM activities').get()).toEqual({ c: 0 })
    expect(db.prepare('SELECT byte_offset FROM ingest_cursors WHERE file_path = ?').get(filePath))
      .toBeUndefined()

    db.exec('DROP TRIGGER force_fail')

    // With the failure gone, a re-run recovers both lines — nothing was lost.
    const report = await ingestAll(db, env, NOW)
    expect(report.sessions).toBe(1)
    expect(report.activities).toBe(2)
    expect(db.prepare('SELECT COUNT(*) c FROM activities').get()).toEqual({ c: 2 })
  })

  it('does not let a later cwd-less append overwrite a stored project', async () => {
    await stage('session-basic.jsonl', 'aaaa-1111')
    await ingestAll(db, env, NOW)

    const before = db.prepare('SELECT project FROM sessions WHERE id = ?').get('aaaa-1111') as {
      project: string
    }

    const filePath = join(env.HOUNTYBUNTER_TRANSCRIPTS!, '-Users-x-proj', 'aaaa-1111.jsonl')
    await appendFile(filePath, '{"type":"mode","timestamp":"2026-08-27T10:00:20.000Z"}\n')

    await ingestAll(db, env, NOW)

    const after = db.prepare('SELECT project FROM sessions WHERE id = ?').get('aaaa-1111') as {
      project: string
    }
    expect(after.project).toBe(before.project)
  })
})
