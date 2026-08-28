import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { clearNoteIndex, indexNote, noteHash } from '../src/db/write.js'
import { openDb } from '../src/db/open.js'
import { parseNote } from '../src/note/parse.js'

let env: NodeJS.ProcessEnv

beforeEach(async () => {
  const home = await mkdtemp(join(tmpdir(), 'hb-'))
  env = { HOUNTYBUNTER_HOME: home } as NodeJS.ProcessEnv
})

const RAW = `---
id: 2026-08-12-offline-reads
title: Offline reads
project: proj-abc123
question: How do reps work through network gaps?
chosen: TanStack Query
rejected:
  - option: Full sync engine
    why_not: Needs idempotency keys
evidence:
  - kind: file
    ref: src/lib/persister.ts
---

Prose body about persisters.
`

describe('indexNote', () => {
  it('inserts a row, its evidence, and its search text', () => {
    const db = openDb(env)
    indexNote(db, parseNote(RAW, '/store/a.md'))
    expect(db.prepare('SELECT COUNT(*) c FROM notes').get()).toEqual({ c: 1 })
    expect(db.prepare('SELECT COUNT(*) c FROM note_evidence').get()).toEqual({ c: 1 })
    expect(db.prepare('SELECT COUNT(*) c FROM notes_fts').get()).toEqual({ c: 1 })
    db.close()
  })

  it('is idempotent — indexing twice leaves one row', () => {
    const db = openDb(env)
    const note = parseNote(RAW, '/store/a.md')
    indexNote(db, note)
    indexNote(db, note)
    expect(db.prepare('SELECT COUNT(*) c FROM notes').get()).toEqual({ c: 1 })
    expect(db.prepare('SELECT COUNT(*) c FROM note_evidence').get()).toEqual({ c: 1 })
    expect(db.prepare('SELECT COUNT(*) c FROM notes_fts').get()).toEqual({ c: 1 })
    db.close()
  })

  it('makes the rejected reasoning searchable', () => {
    const db = openDb(env)
    indexNote(db, parseNote(RAW, '/store/a.md'))
    expect(db.prepare('SELECT note_id FROM notes_fts WHERE notes_fts MATCH ?').all('idempotency'))
      .toEqual([{ note_id: '2026-08-12-offline-reads' }])
    db.close()
  })

  it('clearNoteIndex empties note tables only', () => {
    const db = openDb(env)
    indexNote(db, parseNote(RAW, '/store/a.md'))
    db.prepare("INSERT INTO sessions (id, project) VALUES ('s1','p')").run()
    clearNoteIndex(db)
    expect(db.prepare('SELECT COUNT(*) c FROM notes').get()).toEqual({ c: 0 })
    expect(db.prepare('SELECT COUNT(*) c FROM notes_fts').get()).toEqual({ c: 0 })
    expect(db.prepare('SELECT COUNT(*) c FROM sessions').get()).toEqual({ c: 1 })
    db.close()
  })
})

describe('noteHash', () => {
  it('changes when content changes and is stable otherwise', () => {
    const a = parseNote(RAW, '/store/a.md')
    const b = parseNote(RAW.replace('TanStack Query', 'SWR'), '/store/a.md')
    expect(noteHash(a)).toBe(noteHash(a))
    expect(noteHash(a)).not.toBe(noteHash(b))
  })
})
