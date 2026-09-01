import { readFile } from 'node:fs/promises'
import type Database from 'better-sqlite3'
import type { Note } from '../types.js'
import { parseNote } from './parse.js'

/**
 * Read one note in full. The index only says where the file is; the file is the
 * record. A row pointing at a file that has been deleted or moved is treated as
 * absent rather than fatal — the index is derived, and is allowed to be stale
 * until the next rebuild.
 */
export async function getNote(db: Database.Database, id: string): Promise<Note | undefined> {
  const row = db.prepare('SELECT path FROM notes WHERE id = ?').get(id) as
    | { path: string }
    | undefined
  if (!row?.path) return undefined

  try {
    return parseNote(await readFile(row.path, 'utf8'), row.path)
  } catch {
    return undefined
  }
}
