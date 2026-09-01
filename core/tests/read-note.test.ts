import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { openDb } from '../src/db/open.js'
import { indexNote } from '../src/db/write.js'
import { getNote } from '../src/note/read.js'
import { recordDecision } from '../src/note/record.js'

let env: NodeJS.ProcessEnv
let db: ReturnType<typeof openDb>

beforeEach(async () => {
  const home = await mkdtemp(join(tmpdir(), 'hb-'))
  env = { HOUNTYBUNTER_HOME: home } as NodeJS.ProcessEnv
  db = openDb(env)
})

async function seed() {
  const note = await recordDecision(
    {
      project: 'proj-a',
      instant: '2026-08-27T10:00:00.000Z',
      question: 'Which basemap?',
      chosen: 'OpenFreeMap',
      rejected: [{ option: 'CARTO', why_not: 'request cap on the free tier' }],
      evidence: [{ kind: 'session', ref: 's1' }],
    },
    { env, timeZone: 'UTC' },
  )
  indexNote(db, note)
  return note
}

describe('getNote', () => {
  it('returns the whole record, not the index summary', async () => {
    const written = await seed()
    const note = await getNote(db, written.id)

    expect(note?.question).toBe('Which basemap?')
    expect(note?.chosen).toBe('OpenFreeMap')
    expect(note?.rejected).toEqual([
      { option: 'CARTO', why_not: 'request cap on the free tier' },
    ])
    expect(note?.evidence).toEqual([{ kind: 'session', ref: 's1' }])
  })

  it('reads the file, so an edit made by hand is what comes back', async () => {
    const written = await seed()
    const { readFile, writeFile } = await import('node:fs/promises')
    const edited = (await readFile(written.sourcePath, 'utf8')).replace(
      'request cap on the free tier',
      'nhãn tiếng Việt sai dấu',
    )
    await writeFile(written.sourcePath, edited, 'utf8')

    const note = await getNote(db, written.id)
    expect(note?.rejected[0]?.why_not).toBe('nhãn tiếng Việt sai dấu')
  })

  it('returns undefined for an id the index does not know', async () => {
    expect(await getNote(db, 'never-existed')).toBeUndefined()
  })

  it('returns undefined when the index points at a file that is gone', async () => {
    const written = await seed()
    const { rm } = await import('node:fs/promises')
    await rm(written.sourcePath)

    // The index is derived and can outlive the file; a stale row is not a crash.
    expect(await getNote(db, written.id)).toBeUndefined()
  })
})
