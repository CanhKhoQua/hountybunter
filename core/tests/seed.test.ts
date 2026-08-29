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
    // Each word appears only inside a rejected option's why_not.
    expect(searchNotes(db, 'idempotency')).not.toEqual([])
    expect(searchNotes(db, 'grep')).not.toEqual([])
    db.close()
  })
})
