import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { projectPathFor, staleNoteIds } from '../src/db/query.js'
import { openDb } from '../src/db/open.js'
import { indexNote, recordVerification } from '../src/db/write.js'
import { parseNote } from '../src/note/parse.js'
import { verifyNote } from '../src/verify/note.js'
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

    expect(staleNoteIds(db, '2026-09-02')).toEqual(new Set(['n1', 'n2']))
  })

  it('leaves out a note whose references merely could not be checked', () => {
    indexNote(db, note('n1', 'a.ts'))
    recordVerification(db, verdict('n1', 'a.ts', 'unknown'), at)

    expect(staleNoteIds(db, '2026-09-02')).toEqual(new Set())
  })

  it('names a note whose review date has passed, even with every reference unknown', () => {
    const withReviewAfter = parseNote(
      `---\nid: n1\ntitle: n1\nproject: proj-a\nquestion: q?\nchosen: c\n` +
        `review_after: 2026-09-01\nevidence:\n  - {kind: file, ref: a.ts}\n---\n\nb\n`,
      '/store/n1.md',
    )
    indexNote(db, withReviewAfter)
    recordVerification(db, verdict('n1', 'a.ts', 'unknown'), at)

    expect(staleNoteIds(db, '2026-09-02')).toEqual(new Set(['n1']))
  })

  it('leaves out a note whose review date is today, not yet due', () => {
    const withReviewAfter = parseNote(
      `---\nid: n1\ntitle: n1\nproject: proj-a\nquestion: q?\nchosen: c\n` +
        `review_after: 2026-09-02\nevidence:\n  - {kind: file, ref: a.ts}\n---\n\nb\n`,
      '/store/n1.md',
    )
    indexNote(db, withReviewAfter)
    recordVerification(db, verdict('n1', 'a.ts', 'unknown'), at)

    expect(staleNoteIds(db, '2026-09-02')).toEqual(new Set())
  })
})

describe('projectPathFor', () => {
  it('prefers the note\'s own project_path over a projects row', async () => {
    // The paths must exist: projectPathFor now stats whatever it would return,
    // and a fixture path that was never real would make this pass for the
    // wrong reason (or fail once the null-on-missing behavior is added).
    const noteDir = await mkdtemp(join(tmpdir(), 'hb-projectpath-'))
    const otherDir = await mkdtemp(join(tmpdir(), 'hb-projectpath-'))
    const n = parseNote(
      `---\nid: n1\ntitle: n1\nproject: proj-a\nproject_path: ${noteDir}\nquestion: q?\nchosen: c\n---\n\nb\n`,
      '/store/n1.md',
    )
    db.prepare('INSERT INTO projects (path, slug, name) VALUES (?, ?, ?)').run(
      otherDir,
      'proj-a',
      'proj-a',
    )

    expect(projectPathFor(db, n)).toBe(noteDir)
  })

  it('falls back to the projects row matching the note\'s slug', async () => {
    const projDir = await mkdtemp(join(tmpdir(), 'hb-projectpath-'))
    const n = note('n1', 'a.ts')
    db.prepare('INSERT INTO projects (path, slug, name) VALUES (?, ?, ?)').run(
      projDir,
      'proj-a',
      'proj-a',
    )

    expect(projectPathFor(db, n)).toBe(projDir)
  })

  it('returns null when neither the note nor a projects row answers', () => {
    const n = note('n1', 'a.ts')
    expect(projectPathFor(db, n)).toBe(null)
  })

  it('returns null when note.project_path names a worktree that has been removed, even though a valid projects row exists for the slug', async () => {
    // This is the case that separates the fix from the rejected alternative
    // of falling back to the projects row: that row names a *different*
    // working tree (the one currently checked out at the shared project
    // path), not the one the note's author was looking at. Falling back to
    // it would let a file that merely differs between branches read as
    // `changed` instead of the honest `unknown` — a worse, more plausible
    // false report than the "stale" this fix removes.
    const base = await mkdtemp(join(tmpdir(), 'hb-projectpath-'))
    const gone = join(base, 'worktree-removed')
    const projDir = await mkdtemp(join(tmpdir(), 'hb-projectpath-'))
    const n = parseNote(
      `---\nid: n1\ntitle: n1\nproject: proj-a\nproject_path: ${gone}\nquestion: q?\nchosen: c\n---\n\nb\n`,
      '/store/n1.md',
    )
    db.prepare('INSERT INTO projects (path, slug, name) VALUES (?, ?, ?)').run(
      projDir,
      'proj-a',
      'proj-a',
    )

    expect(projectPathFor(db, n)).toBe(null)
  })

  it('returns null when neither the note\'s project_path nor the projects row exists on disk', async () => {
    const base = await mkdtemp(join(tmpdir(), 'hb-projectpath-'))
    const gone = join(base, 'never-created')
    const n = note('n1', 'a.ts')
    db.prepare('INSERT INTO projects (path, slug, name) VALUES (?, ?, ?)').run(
      gone,
      'proj-a',
      'proj-a',
    )

    expect(projectPathFor(db, n)).toBe(null)
  })
})

describe('a removed project directory does not make its notes look stale', () => {
  it('reports the file ref as unknown, not missing, and the note is excluded from staleNoteIds', async () => {
    // This is the actual bug: a note promoted from inside a git worktree
    // records that worktree's directory as project_path, and `git worktree
    // remove` is ordinary. The directory going away is not news about the
    // evidence it held, so the pipeline hb brief relies on — verifyNote fed
    // by projectPathFor, then recordVerification, then staleNoteIds — must
    // not call this note stale.
    const base = await mkdtemp(join(tmpdir(), 'hb-projectpath-'))
    const gone = join(base, 'worktree-removed')
    const n = parseNote(
      `---\nid: n1\ntitle: n1\nproject: proj-a\nproject_path: ${gone}\nquestion: q?\nchosen: c\n` +
        `evidence:\n  - {kind: file, ref: a.ts}\n---\n\nb\n`,
      '/store/n1.md',
    )
    indexNote(db, n)

    const result = await verifyNote(n, {
      projectPath: projectPathFor(db, n),
      sessionExists: () => false,
      today: '2026-09-02',
    })
    recordVerification(db, result, at)

    expect(result.refs[0].state).toBe('unknown')
    expect(staleNoteIds(db, '2026-09-02')).toEqual(new Set())
  })
})
