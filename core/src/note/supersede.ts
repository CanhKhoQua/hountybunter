import type Database from 'better-sqlite3'
import { indexNote } from '../db/write.js'
import { getNote } from './read.js'
import { writeNote } from './store.js'

/**
 * Mark a note as replaced by a later one.
 *
 * Written to the markdown first and only then to the index, because the file is
 * the record: a status kept only in the index would come back `standing` after
 * a rebuild, and the note would go on claiming to be current long after it was
 * replaced.
 *
 * Refuses an id it cannot find rather than linking a new decision to nothing —
 * a chain that points at a note nobody can open is worse than no chain, since
 * it reads as though the history were recorded.
 */
export async function markSuperseded(
  db: Database.Database,
  id: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const note = await getNote(db, id)
  if (!note) throw new Error(`no note ${id} to supersede`)
  if (note.status === 'superseded') return

  const replaced = { ...note, status: 'superseded' as const }
  replaced.sourcePath = await writeNote(replaced, env)
  indexNote(db, replaced)
}
