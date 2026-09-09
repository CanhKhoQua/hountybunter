import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { openDb } from '../src/db/open.js'
import { indexNote } from '../src/db/write.js'
import { markSuperseded } from '../src/note/supersede.js'
import { recordDecision } from '../src/note/record.js'

let env: NodeJS.ProcessEnv
let db: ReturnType<typeof openDb>

beforeEach(async () => {
  const home = await mkdtemp(join(tmpdir(), 'hb-sup-'))
  env = { HOUNTYBUNTER_HOME: home } as NodeJS.ProcessEnv
  db = openDb(env)
})

async function note(title: string) {
  const written = await recordDecision(
    { project: 'proj-a', instant: '2026-09-01T10:00:00.000Z', question: 'q', chosen: 'c', title, origin: 'authored' },
    { env, timeZone: 'UTC' },
  )
  indexNote(db, written)
  return written
}

describe('markSuperseded', () => {
  it('changes the note on disk, not only the index', async () => {
    // The file is the record. A status that lived only in the index would come
    // back `standing` after a rebuild, and the note would go on claiming to be
    // current long after it was replaced.
    const old = await note('The old call')
    await markSuperseded(db, old.id, env)
    expect(await readFile(old.sourcePath, 'utf8')).toContain('status: superseded')
  })

  it('updates the index too, so `hb list` agrees with the file', async () => {
    const old = await note('The old call')
    await markSuperseded(db, old.id, env)
    expect(db.prepare('SELECT status FROM notes WHERE id = ?').get(old.id)).toEqual({
      status: 'superseded',
    })
  })

  it('refuses a note that does not exist, naming it', async () => {
    await expect(markSuperseded(db, '2026-01-01-no-such-note', env)).rejects.toThrow(
      /2026-01-01-no-such-note/,
    )
  })

  it('leaves everything else about the note alone', async () => {
    const old = await note('The old call')
    await markSuperseded(db, old.id, env)
    const text = await readFile(old.sourcePath, 'utf8')
    expect(text).toContain('title: The old call')
    expect(text).toContain('origin: authored')
  })

  it('is idempotent', async () => {
    const old = await note('The old call')
    await markSuperseded(db, old.id, env)
    const once = await readFile(old.sourcePath, 'utf8')
    await markSuperseded(db, old.id, env)
    expect(await readFile(old.sourcePath, 'utf8')).toBe(once)
  })
})
