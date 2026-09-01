import type Database from 'better-sqlite3'
import { open, stat } from 'node:fs/promises'

export interface ReadResult {
  lines: string[]
  from: number
  to: number
}

/**
 * Read the bytes appended since the last call. A trailing line without a
 * newline is left unconsumed so a half-written record is never parsed; the
 * cursor advances only past complete lines.
 *
 * This does NOT persist the new offset — call `saveCursor` with the `to` it
 * returns once the rows derived from these lines are safely committed.
 */
export async function readNewLines(
  db: Database.Database,
  path: string,
): Promise<ReadResult> {
  let size: number
  try {
    size = (await stat(path)).size
  } catch {
    return { lines: [], from: 0, to: 0 }
  }

  const row = db
    .prepare('SELECT byte_offset FROM ingest_cursors WHERE file_path = ?')
    .get(path) as { byte_offset: number } | undefined

  // A file that shrank was truncated or replaced; the old offset is meaningless.
  let from = row?.byte_offset ?? 0
  if (from > size) from = 0
  if (from === size) return { lines: [], from, to: size }

  const handle = await open(path, 'r')
  let text: string
  try {
    const buffer = Buffer.alloc(size - from)
    await handle.read(buffer, 0, buffer.length, from)
    text = buffer.toString('utf8')
  } finally {
    await handle.close()
  }

  const lastNewline = text.lastIndexOf('\n')
  const complete = lastNewline === -1 ? '' : text.slice(0, lastNewline)
  const consumed = lastNewline === -1 ? 0 : Buffer.byteLength(complete, 'utf8') + 1
  const to = from + consumed

  return { lines: complete.split('\n').filter((l) => l.length > 0), from, to }
}

/**
 * Persist a cursor advance. Deliberately separate from readNewLines and
 * synchronous, so a caller can run it inside the same db.transaction() as the
 * rows it derived from. If the cursor advanced on its own and the rows then
 * rolled back, those lines would be skipped forever with nothing reported.
 */
export function saveCursor(
  db: Database.Database,
  path: string,
  byteOffset: number,
  nowIso: string,
): void {
  db.prepare(
    `INSERT INTO ingest_cursors (file_path, byte_offset, last_seen_at)
     VALUES (?, ?, ?)
     ON CONFLICT(file_path) DO UPDATE SET
       byte_offset = excluded.byte_offset, last_seen_at = excluded.last_seen_at`,
  ).run(path, byteOffset, nowIso)
}
