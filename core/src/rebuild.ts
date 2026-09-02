import type Database from 'better-sqlite3'
import { clearNoteIndex, indexNote } from './db/write.js'
import { openDb } from './db/open.js'
import { NoteParseError } from './note/parse.js'
import { readAllNotes } from './note/store.js'

export interface RebuildReport {
  notesIndexed: number
  errors: NoteParseError[]
}

/**
 * Rebuild the note index from the markdown on disk. Clearing first is what
 * makes a deleted file disappear from the index; without it the index would
 * only ever grow.
 */
export async function rebuildFromDisk(
  env: NodeJS.ProcessEnv = process.env,
): Promise<RebuildReport> {
  const { notes, errors } = await readAllNotes(env)
  const db = openDb(env)
  try {
    clearNoteIndex(db)
    let indexed = 0
    for (const note of notes) {
      try {
        indexNote(db, note)
        indexed += 1
      } catch (error) {
        // One note that cannot be indexed must not cost every other note, for
        // the same reason one unreadable file must not cost the whole store.
        errors.push(new NoteParseError(`could not index: ${String(error)}`, note.sourcePath))
      }
    }
    return { notesIndexed: indexed, errors }
  } finally {
    db.close()
  }
}

/**
 * A canonical projection of durable state, for asserting that two rebuilds
 * agree. Autoincrement rowids and wall-clock columns are excluded: they differ
 * between runs without the state differing.
 *
 * Closes the database it is given.
 */
export function snapshotState(db: Database.Database): string {
  const q = (sql: string) => db.prepare(sql).all()
  const state = {
    notes: q(
      `SELECT id, project, path, title, kind, status, decided_on, confidence,
              review_after, hash
       FROM notes ORDER BY id`,
    ),
    note_evidence: q(
      'SELECT note_id, kind, ref, ok FROM note_evidence ORDER BY note_id, kind, ref',
    ),
    notes_fts: q(
      'SELECT note_id, title, question, chosen, rejected, body FROM notes_fts ORDER BY note_id',
    ),
    projects: q('SELECT path, slug, name, last_seen_at FROM projects ORDER BY path'),
    sessions: q(
      `SELECT id, project, started_at, ended_at, branch, model, effort, title, correlation
       FROM sessions ORDER BY id`,
    ),
    activities: q(
      `SELECT session_id, seq, ts, kind, tool_name, attr_skill, attr_plugin
       FROM activities ORDER BY session_id, seq`,
    ),
  }
  db.close()
  return JSON.stringify(state, null, 2)
}
