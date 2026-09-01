import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { openDb, SCHEMA_VERSION, SchemaVersionError } from '../src/db/open.js'

let env: NodeJS.ProcessEnv

beforeEach(async () => {
  const home = await mkdtemp(join(tmpdir(), 'hb-'))
  env = { HOUNTYBUNTER_HOME: home } as NodeJS.ProcessEnv
})

function tableNames(db: ReturnType<typeof openDb>): string[] {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view') ORDER BY name")
    .all()
    .map((r) => (r as { name: string }).name)
}

describe('openDb', () => {
  it('creates the phase 1-3 tables', () => {
    const db = openDb(env)
    const names = tableNames(db)
    for (const t of ['projects', 'notes', 'note_evidence', 'notes_fts', 'sessions', 'activities', 'ingest_cursors']) {
      expect(names).toContain(t)
    }
    db.close()
  })

  it('does not create tables that belong to later phases', () => {
    const db = openDb(env)
    expect(tableNames(db)).not.toContain('bounties')
    db.close()
  })

  it('enables WAL so the CLI and a reader can coexist', () => {
    const db = openDb(env)
    expect(String(db.pragma('journal_mode', { simple: true })).toLowerCase()).toBe('wal')
    db.close()
  })

  it('records the schema version', () => {
    const db = openDb(env)
    expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION)
    db.close()
  })

  it('is idempotent — opening twice does not throw', () => {
    openDb(env).close()
    const db = openDb(env)
    expect(tableNames(db)).toContain('notes')
    db.close()
  })

  it('supports FTS5', () => {
    const db = openDb(env)
    db.prepare('INSERT INTO notes_fts (note_id, title, question, chosen, rejected, body) VALUES (?,?,?,?,?,?)')
      .run('n1', 'Offline reads', 'How do reps work offline?', 'TanStack Query', '', 'body')
    expect(db.prepare('SELECT note_id FROM notes_fts WHERE notes_fts MATCH ?').all('offline'))
      .toHaveLength(1)
    db.close()
  })

  it('refuses to open a database written by a different schema version', () => {
    const db = openDb(env)
    db.pragma('user_version = 99')
    db.close()

    expect(() => openDb(env)).toThrow(/schema version 99/)
  })
})
