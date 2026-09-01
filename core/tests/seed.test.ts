import { cp, mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { openDb } from '../src/db/open.js'
import { searchNotes } from '../src/db/query.js'
import { rebuildFromDisk } from '../src/rebuild.js'

const SEED = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'seed')

describe('seed notes', () => {
  it('all five parse, index, and are searchable by their rejected reasoning', async () => {
    const home = await mkdtemp(join(tmpdir(), 'hb-'))
    const env = { HOUNTYBUNTER_HOME: home } as NodeJS.ProcessEnv
    const dest = join(home, 'notes', 'tnm-dms-000000')
    await mkdir(dest, { recursive: true })
    await cp(SEED, dest, { recursive: true })

    const report = await rebuildFromDisk(env)
    expect(report.errors).toEqual([])
    expect(report.notesIndexed).toBe(5)

    const db = openDb(env)

    // These two searches go through the public API and prove the user-facing path
    // works. They do NOT prove where the match came from: notes_fts indexes title,
    // question, chosen, rejected and body together, and both words also appear
    // outside their why_not.
    expect(searchNotes(db, 'idempotency')).not.toEqual([])
    expect(searchNotes(db, 'grep')).not.toEqual([])

    // This is the assertion that actually guards the rejected reasoning: a
    // column-scoped match, which can only succeed if the rejected column itself
    // carries the text. Without it, gutting every rejected block leaves the two
    // searches above still passing.
    const inRejected = (term: string) =>
      db
        .prepare('SELECT note_id FROM notes_fts WHERE notes_fts MATCH ?')
        .all(`rejected : ${term}`)
        .map((r) => (r as { note_id: string }).note_id)

    expect(inRejected('idempotency')).toContain('2026-08-12-offline-reads')
    expect(inRejected('grep')).toContain('2026-08-20-graph-tool-rejected')

    db.close()
  })
})
