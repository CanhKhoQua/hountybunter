import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { projectPathFor, staleNoteIds } from '../src/db/query.js'
import { openDb } from '../src/db/open.js'
import { indexNote, recordVerification } from '../src/db/write.js'
import { parseNote } from '../src/note/parse.js'
import type { NoteVerdict, RefResult } from '../src/verify/note.js'
import type { EvidenceState } from '../src/verify/evidence.js'

let db: ReturnType<typeof openDb>

const note = (id: string, ref: string) =>
  parseNote(
    `---\nid: ${id}\ntitle: ${id}\nproject: proj-a\nquestion: q?\nchosen: c\n` +
      `evidence:\n  - {kind: file, ref: ${ref}}\n---\n\nb\n`,
    `/store/${id}.md`,
  )

const at = '2026-09-02T10:00:00.000Z'
const verdict = (noteId: string, ref: string, state: EvidenceState): NoteVerdict => {
  const refs: RefResult[] = [{ kind: 'file', ref, state }]
  return {
    noteId,
    stale: state === 'changed' || state === 'missing',
    reasons: [],
    refs,
  }
}

beforeEach(async () => {
  const home = await mkdtemp(join(tmpdir(), 'hb-dbv-'))
  db = openDb({ HOUNTYBUNTER_HOME: home } as NodeJS.ProcessEnv)
})

describe('recordVerification', () => {
  it('stores a state and a time against each reference', () => {
    indexNote(db, note('n1', 'a.ts'))
    recordVerification(db, verdict('n1', 'a.ts', 'changed'), at)

    const row = db
      .prepare('SELECT state, last_verified_at FROM note_evidence WHERE note_id = ?')
      .get('n1')
    expect(row).toEqual({ state: 'changed', last_verified_at: at })
  })

  it('starts every reference at unknown, before anything has looked', () => {
    // Indexing a note is not checking it. A default that read as a pass would
    // report a store nobody has looked at as a clean one.
    indexNote(db, note('n1', 'a.ts'))
    expect(db.prepare('SELECT state FROM note_evidence').get()).toEqual({ state: 'unknown' })
  })

  it('forgets an old verdict when the note is re-indexed', () => {
    // A state left behind would outlive the reading that produced it.
    indexNote(db, note('n1', 'a.ts'))
    recordVerification(db, verdict('n1', 'a.ts', 'changed'), at)
    indexNote(db, note('n1', 'a.ts'))

    expect(db.prepare('SELECT state FROM note_evidence').get()).toEqual({ state: 'unknown' })
  })
})

describe('staleNoteIds', () => {
  it('names the notes with a reference that changed or went missing', () => {
    indexNote(db, note('n1', 'a.ts'))
    indexNote(db, note('n2', 'b.ts'))
    indexNote(db, note('n3', 'c.ts'))
    recordVerification(db, verdict('n1', 'a.ts', 'changed'), at)
    recordVerification(db, verdict('n2', 'b.ts', 'missing'), at)
    recordVerification(db, verdict('n3', 'c.ts', 'verified'), at)

    expect(staleNoteIds(db)).toEqual(new Set(['n1', 'n2']))
  })

  it('leaves out a note whose references merely could not be checked', () => {
    indexNote(db, note('n1', 'a.ts'))
    recordVerification(db, verdict('n1', 'a.ts', 'unknown'), at)

    expect(staleNoteIds(db)).toEqual(new Set())
  })
})

describe('projectPathFor', () => {
  it('prefers the note\'s own project_path over a projects row', () => {
    const n = parseNote(
      `---\nid: n1\ntitle: n1\nproject: proj-a\nproject_path: /work/proj-a\nquestion: q?\nchosen: c\n---\n\nb\n`,
      '/store/n1.md',
    )
    db.prepare('INSERT INTO projects (path, slug, name) VALUES (?, ?, ?)').run(
      '/other/proj-a',
      'proj-a',
      'proj-a',
    )

    expect(projectPathFor(db, n)).toBe('/work/proj-a')
  })

  it('falls back to the projects row matching the note\'s slug', () => {
    const n = note('n1', 'a.ts')
    db.prepare('INSERT INTO projects (path, slug, name) VALUES (?, ?, ?)').run(
      '/work/proj-a',
      'proj-a',
      'proj-a',
    )

    expect(projectPathFor(db, n)).toBe('/work/proj-a')
  })

  it('returns null when neither the note nor a projects row answers', () => {
    const n = note('n1', 'a.ts')
    expect(projectPathFor(db, n)).toBe(null)
  })
})
