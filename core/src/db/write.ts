import type Database from 'better-sqlite3'
import { createHash } from 'node:crypto'
import { serializeNote } from '../note/serialize.js'
import type { Note } from '../types.js'

/** Content hash of the note as it would be written to disk. */
export function noteHash(note: Note): string {
  return createHash('sha256').update(serializeNote(note)).digest('hex')
}

export function indexNote(db: Database.Database, note: Note): void {
  db.transaction(() => {
    db.prepare(
      `INSERT INTO notes (id, project, path, title, kind, status, decided_on,
                          confidence, review_after, hash)
       VALUES (@id, @project, @path, @title, @kind, @status, @decided_on,
               @confidence, @review_after, @hash)
       ON CONFLICT(id) DO UPDATE SET
         project = excluded.project, path = excluded.path, title = excluded.title,
         kind = excluded.kind, status = excluded.status,
         decided_on = excluded.decided_on, confidence = excluded.confidence,
         review_after = excluded.review_after, hash = excluded.hash`,
    ).run({
      id: note.id,
      project: note.project,
      path: note.sourcePath,
      title: note.title,
      kind: note.kind,
      status: note.status,
      decided_on: note.decided_on,
      confidence: note.confidence,
      review_after: note.review_after,
      hash: noteHash(note),
    })

    db.prepare('DELETE FROM note_evidence WHERE note_id = ?').run(note.id)
    const insertEvidence = db.prepare(
      'INSERT INTO note_evidence (note_id, kind, ref) VALUES (?, ?, ?)',
    )
    for (const e of note.evidence) insertEvidence.run(note.id, e.kind, e.ref)

    // FTS5 has no upsert; delete then insert keeps re-indexing idempotent.
    db.prepare('DELETE FROM notes_fts WHERE note_id = ?').run(note.id)
    db.prepare(
      `INSERT INTO notes_fts (note_id, title, question, chosen, rejected, body)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      note.id,
      note.title,
      note.question,
      note.chosen,
      note.rejected.map((r) => `${r.option} ${r.why_not}`).join('\n'),
      note.body,
    )
  })()
}

export function clearNoteIndex(db: Database.Database): void {
  db.transaction(() => {
    db.prepare('DELETE FROM notes_fts').run()
    db.prepare('DELETE FROM note_evidence').run()
    db.prepare('DELETE FROM notes').run()
  })()
}
