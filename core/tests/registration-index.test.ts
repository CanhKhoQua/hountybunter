import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { openDb } from '../src/db/open.js'
import { clearRegistrationIndex, indexRegistration } from '../src/db/write.js'
import { parseRegistration } from '../src/project/parse.js'
import { writeRegistration } from '../src/project/store.js'
import { rebuildFromDisk } from '../src/rebuild.js'

let env: NodeJS.ProcessEnv

beforeEach(async () => {
  const home = await mkdtemp(join(tmpdir(), 'hb-regidx-'))
  env = { HOUNTYBUNTER_HOME: home } as NodeJS.ProcessEnv
})

const sample = parseRegistration(
  '---\nslug: proj-abc\nname: proj\npaths:\n  - /w/proj\n  - /w/wt\nplan: docs/p.md\nregistered_at: 2026-09-08\n---\n',
  '/store/projects/proj-abc.md',
)

describe('registration index', () => {
  it('writes one project row and one row per path', () => {
    const db = openDb(env)
    indexRegistration(db, sample)
    expect(db.prepare('SELECT slug, plan, primary_path FROM registered_projects').all()).toEqual([
      { slug: 'proj-abc', plan: 'docs/p.md', primary_path: '/w/proj' },
    ])
    expect(db.prepare('SELECT path FROM registered_paths ORDER BY path').all()).toEqual([
      { path: '/w/proj' },
      { path: '/w/wt' },
    ])
    db.close()
  })

  it('drops a path removed from the record instead of leaving it to match forever', () => {
    const db = openDb(env)
    indexRegistration(db, sample)
    const shorter = { ...sample, paths: ['/w/proj'] }
    clearRegistrationIndex(db)
    indexRegistration(db, shorter)
    expect(db.prepare('SELECT path FROM registered_paths').all()).toEqual([{ path: '/w/proj' }])
    db.close()
  })

  it('rebuild restores the registration from the file after the index is deleted', async () => {
    await writeRegistration(sample, env)
    const report = await rebuildFromDisk(env)
    expect(report.projectsRegistered).toBe(1)

    const db = openDb(env)
    expect(db.prepare('SELECT COUNT(*) c FROM registered_projects').get()).toEqual({ c: 1 })
    db.close()
  })
})
