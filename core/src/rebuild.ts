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
 * What the snapshot reads, declared rather than spelled out as SQL.
 *
 * Declared because `--verify` can only catch a disagreement about a column it
 * reads: a column missing from here is one two rebuilds may differ on while
 * reporting identical state. A test walks the live schema against this and
 * against NOT_SNAPSHOTTED, so a new column cannot be quietly left out — which
 * is how `notes.path` and later `sessions.parent_id` came to be missing.
 */
export const SNAPSHOT: Record<string, { columns: string[]; orderBy: string }> = {
  notes: {
    columns: [
      'id', 'project', 'path', 'title', 'kind', 'status', 'decided_on',
      'confidence', 'review_after', 'hash',
    ],
    orderBy: 'id',
  },
  note_evidence: {
    columns: ['note_id', 'kind', 'ref', 'last_verified_at', 'ok'],
    orderBy: 'note_id, kind, ref',
  },
  notes_fts: {
    columns: ['note_id', 'title', 'question', 'chosen', 'rejected', 'body'],
    orderBy: 'note_id',
  },
  projects: {
    columns: ['path', 'slug', 'name', 'git_remote', 'last_seen_at'],
    orderBy: 'path',
  },
  sessions: {
    columns: [
      'id', 'project', 'started_at', 'ended_at', 'branch', 'model', 'effort',
      'title', 'correlation', 'parent_id',
    ],
    orderBy: 'id',
  },
  activities: {
    columns: ['session_id', 'seq', 'ts', 'kind', 'tool_name', 'attr_skill', 'attr_plugin'],
    orderBy: 'session_id, seq',
  },
}

/**
 * Everything the snapshot deliberately does not read, and why.
 *
 * Keyed by table or by `table.column`. The reason is the mechanism: a bare
 * list would be somewhere to append a name and move on, which is the
 * forgetting this exists to prevent.
 */
export const NOT_SNAPSHOTTED: Record<string, string> = {
  hook_events:
    'Live events, not reproducible from files: a hook is in no transcript, so a ' +
    'rebuild cannot produce these rows and comparing them would compare nothing.',
  ingest_cursors:
    'A byte position in a file, not a fact about the work. Two rebuilds reach the ' +
    'same rows by different reading, so the position differs without the state differing.',
  sqlite_sequence:
    "SQLite's own bookkeeping for autoincrement counters. It advances with insert " +
    'order and says nothing about what was indexed.',
  notes_fts_data: 'FTS5 internal storage, rebuilt wholesale from the rows of notes_fts.',
  notes_fts_idx: 'FTS5 internal storage, rebuilt wholesale from the rows of notes_fts.',
  notes_fts_content: 'FTS5 internal storage, rebuilt wholesale from the rows of notes_fts.',
  notes_fts_docsize: 'FTS5 internal storage, rebuilt wholesale from the rows of notes_fts.',
  notes_fts_config: 'FTS5 internal storage, rebuilt wholesale from the rows of notes_fts.',
  'activities.id':
    'An autoincrement rowid. It differs between runs with the state identical, and ' +
    '(session_id, seq) already identifies the row.',
}

/**
 * A canonical projection of durable state, for asserting that two rebuilds
 * agree. Autoincrement rowids and wall-clock columns are excluded: they differ
 * between runs without the state differing.
 *
 * Closes the database it is given.
 */
export function snapshotState(db: Database.Database): string {
  const state: Record<string, unknown> = {}
  for (const [table, spec] of Object.entries(SNAPSHOT)) {
    state[table] = db
      .prepare(`SELECT ${spec.columns.join(', ')} FROM ${table} ORDER BY ${spec.orderBy}`)
      .all()
  }
  db.close()
  return JSON.stringify(state, null, 2)
}
