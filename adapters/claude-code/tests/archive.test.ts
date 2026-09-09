import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { openDb, transcriptsDir } from '@hountybunter/core'
import { syncArchive } from '../src/archive.js'
import { findTranscripts } from '../src/locate.js'
import { ingestAll } from '../src/ingest.js'

let env: NodeJS.ProcessEnv
let home: string
let live: string

const LINE = (n: number) =>
  JSON.stringify({ type: 'user', timestamp: `2026-08-0${n}T10:00:00.000Z`, cwd: '/w/proj' })

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'hb-'))
  live = await mkdtemp(join(tmpdir(), 'hb-live-'))
  env = { HOUNTYBUNTER_HOME: home, HOUNTYBUNTER_TRANSCRIPTS: live } as NodeJS.ProcessEnv
})

async function writeLive(project: string, session: string, lines: string[]) {
  await mkdir(join(live, project), { recursive: true })
  await writeFile(join(live, project, `${session}.jsonl`), lines.map((l) => `${l}\n`).join(''))
}

describe('syncArchive', () => {
  it('copies a transcript into the store', async () => {
    await writeLive('-w-proj', 'sess-1', [LINE(1), LINE(2)])
    const report = await syncArchive(env)
    expect(report.bytesCopied).toBeGreaterThan(0)
    const archived = await readFile(join(transcriptsDir(env), '-w-proj', 'sess-1.jsonl'), 'utf8')
    expect(archived.trim().split('\n')).toHaveLength(2)
  })

  it('appends only what is new on a second run', async () => {
    await writeLive('-w-proj', 'sess-1', [LINE(1)])
    await syncArchive(env)
    await writeLive('-w-proj', 'sess-1', [LINE(1), LINE(2)])
    const second = await syncArchive(env)
    const archived = await readFile(join(transcriptsDir(env), '-w-proj', 'sess-1.jsonl'), 'utf8')
    expect(archived.trim().split('\n')).toHaveLength(2)
    expect(second.bytesCopied).toBeLessThan(Buffer.byteLength(`${LINE(1)}\n${LINE(2)}\n`))
  })

  it('reaches a subagent transcript nested below the project directory', async () => {
    // Task-tool runs are written to <project>/<sessionId>/subagents/*.jsonl.
    // Ingest does not understand them yet, but they are deleted on the same
    // 30-day clock, and the archive's job is to be there first.
    const nested = join(live, '-w-proj', 'sess-1', 'subagents')
    await mkdir(nested, { recursive: true })
    await writeFile(join(nested, 'agent-abc.jsonl'), `${LINE(1)}\n`)
    await syncArchive(env)
    const archived = await readFile(
      join(transcriptsDir(env), '-w-proj', 'sess-1', 'subagents', 'agent-abc.jsonl'),
      'utf8',
    )
    expect(archived).toContain('2026-08-01')
  })

  it('keeps a transcript the agent has since deleted', async () => {
    // This is the whole point. Claude Code's cleanupPeriodDays removes
    // transcripts after 30 days by default, so the live directory is a rolling
    // window, not a history.
    await writeLive('-w-proj', 'sess-1', [LINE(1)])
    await syncArchive(env)
    await rm(join(live, '-w-proj'), { recursive: true })
    await syncArchive(env)
    expect(await readFile(join(transcriptsDir(env), '-w-proj', 'sess-1.jsonl'), 'utf8')).toContain(
      '2026-08-01',
    )
  })
})

describe('ingest reads the archive, not the agent directory', () => {
  it('finds a session whose live transcript is gone', async () => {
    await writeLive('-w-proj', 'sess-1', [LINE(1)])
    await syncArchive(env)
    await rm(join(live, '-w-proj'), { recursive: true })
    const found = await findTranscripts(env)
    expect(found.map((f) => f.sessionId)).toEqual(['sess-1'])
  })

  it('does not duplicate activities when the archive is ingested twice', async () => {
    await writeLive('-w-proj', 'sess-1', [LINE(1), LINE(2)])
    await syncArchive(env)
    const db = openDb(env)
    try {
      await ingestAll(db, env)
      await syncArchive(env)
      await ingestAll(db, env)
      const { c } = db.prepare('SELECT COUNT(*) c FROM activities').get() as { c: number }
      expect(c).toBe(2)
    } finally {
      db.close()
    }
  })

  it('adopts a cursor recorded against the live path so nothing re-ingests', async () => {
    // Before the archive existed, cursors were keyed by the path under
    // ~/.claude/projects. Re-reading those bytes from the archive would append
    // the same records again at fresh seq numbers, which the UNIQUE constraint
    // cannot catch.
    await writeLive('-w-proj', 'sess-1', [LINE(1), LINE(2)])
    const db = openDb(env)
    try {
      const livePath = join(live, '-w-proj', 'sess-1.jsonl')
      db.prepare(
        `INSERT INTO ingest_cursors (file_path, byte_offset, last_seen_at)
         VALUES (?, ?, '2026-08-30T00:00:00.000Z')`,
      ).run(livePath, Buffer.byteLength(`${LINE(1)}\n${LINE(2)}\n`))
      await syncArchive(env, db)
      await ingestAll(db, env)
      const { c } = db.prepare('SELECT COUNT(*) c FROM activities').get() as { c: number }
      expect(c).toBe(0)
    } finally {
      db.close()
    }
  })
})

describe('the index does not keep a second copy of the transcript', () => {
  it('has no payload_json column on activities', async () => {
    // The archive holds every record verbatim. A copy in the index was 98% of
    // that table, read by nothing, slower to search than grep over the files,
    // and a second place for whatever the agent read to live.
    const db = openDb(env)
    try {
      const columns = (db.prepare('PRAGMA table_info(activities)').all() as { name: string }[]).map(
        (c) => c.name,
      )
      expect(columns).not.toContain('payload_json')
    } finally {
      db.close()
    }
  })

  it('still keeps a row for a record type it does not recognise', async () => {
    // Kept, counted, and recoverable in full from the archive — which is what
    // "never dropped" has to mean once the payload lives in the file.
    await writeLive('-w-proj', 'sess-1', [
      JSON.stringify({ type: 'brand-new-record-type', cwd: '/w/proj', payload: { a: 1 } }),
    ])
    await syncArchive(env)
    const db = openDb(env)
    try {
      const report = await ingestAll(db, env)
      expect(report.unknownKinds['brand-new-record-type']).toBe(1)
      const kinds = (db.prepare('SELECT kind FROM activities').all() as { kind: string }[]).map(
        (r) => r.kind,
      )
      expect(kinds).toContain('brand-new-record-type')
    } finally {
      db.close()
    }
    const archived = await readFile(join(transcriptsDir(env), '-w-proj', 'sess-1.jsonl'), 'utf8')
    expect(JSON.parse(archived.trim()).payload).toEqual({ a: 1 })
  })
})
