import type Database from 'better-sqlite3'
import { createHash } from 'node:crypto'
import { basename } from 'node:path'
import { serializeNote } from '../note/serialize.js'
import { projectSlug } from '../paths.js'
import type { Note } from '../types.js'

/**
 * Record that work happens in `path`, so the store can name a directory and
 * not only its slug. Called from everywhere a real path is already in hand:
 * transcript ingest, and a hook while the session is still running.
 *
 * `lastSeenAt` is optional because a hook payload carries no timestamp. When
 * absent the stored value is kept, so a hook can never blank out what a
 * transcript established and a rebuild converges on the transcript's answer.
 */
export function rememberProject(
  db: Database.Database,
  path: string,
  lastSeenAt: string | null = null,
): void {
  db.prepare(
    `INSERT INTO projects (path, slug, name, last_seen_at)
     VALUES (@path, @slug, @name, @last_seen_at)
     ON CONFLICT(path) DO UPDATE SET
       last_seen_at = MAX(COALESCE(excluded.last_seen_at, ''), COALESCE(projects.last_seen_at, ''))`,
  ).run({
    path,
    slug: projectSlug(path),
    name: basename(path) || path,
    last_seen_at: lastSeenAt,
  })
}

/** Content hash of the note as it would be written to disk. */
export function noteHash(note: Note): string {
  return createHash('sha256').update(serializeNote(note)).digest('hex')
}

export function indexNote(db: Database.Database, note: Note): void {
  db.transaction(() => {
    // Where this note's project lives, if the note says so and the claim
    // checks out. The slug is one-way but verifiable: hashing the path has to
    // reproduce the project the note claims, or the path describes some other
    // directory and opening it would open the wrong repository. A note file is
    // hand-editable, so this is checked here and not only where it is written.
    if (note.project_path && projectSlug(note.project_path) === note.project) {
      rememberProject(db, note.project_path)
    }

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
      // The primary key already declares (note_id, kind, ref) rows identical, so a
      // note that cites the same file twice means one row, not an error. Without
      // OR IGNORE the duplicate aborts the transaction and takes the whole rebuild
      // with it.
      'INSERT OR IGNORE INTO note_evidence (note_id, kind, ref) VALUES (?, ?, ?)',
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

/**
 * Forget every observed session, so they can be read from the archive again.
 *
 * Cursors go with them. Keeping a cursor while dropping the rows it produced
 * would skip those lines forever; dropping a cursor while keeping the rows
 * would re-read them under fresh seq numbers, which UNIQUE(session_id, seq)
 * cannot catch. The two only make sense together.
 */
export function clearSessionIndex(db: Database.Database): void {
  db.transaction(() => {
    db.prepare('DELETE FROM activities').run()
    db.prepare('DELETE FROM sessions').run()
    db.prepare('DELETE FROM ingest_cursors').run()
    // Derived from the same transcripts: a project left behind would name a
    // directory no surviving session ran in.
    db.prepare('DELETE FROM projects').run()
  })()
}

export function clearNoteIndex(db: Database.Database): void {
  db.transaction(() => {
    db.prepare('DELETE FROM notes_fts').run()
    db.prepare('DELETE FROM note_evidence').run()
    db.prepare('DELETE FROM notes').run()
  })()
}
