import type Database from 'better-sqlite3'
import { mkdir, open, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { transcriptsDir } from '@hountybunter/core'
import { transcriptRoot } from './locate.js'

export interface ArchiveReport {
  files: number
  bytesCopied: number
}

/**
 * Copy new transcript bytes out of the agent's directory and into the store.
 *
 * Claude Code deletes transcripts older than `cleanupPeriodDays` (30 by
 * default), so what lives under ~/.claude/projects is a rolling window rather
 * than a history. Ingesting straight from it means the index quietly becomes
 * the only surviving copy of anything older than that — and the index is
 * declared disposable. Copying first is what keeps both claims true at once.
 *
 * Append-only and byte-exact: the archive is a prefix-identical copy, which is
 * what lets a cursor taken against the original stay valid against the copy.
 */
export async function syncArchive(
  env: NodeJS.ProcessEnv = process.env,
  db?: Database.Database,
): Promise<ArchiveReport> {
  const from = transcriptRoot(env)
  const to = transcriptsDir(env)
  const report: ArchiveReport = { files: 0, bytesCopied: 0 }

  for (const relative of await walk(from)) {
    const copied = await appendNewBytes(join(from, relative), join(to, relative))
    if (copied === null) continue
    report.files += 1
    report.bytesCopied += copied
    if (db) adoptCursor(db, join(from, relative), join(to, relative))
  }
  return report
}

/**
 * Every `.jsonl` under `root`, as paths relative to it. Recursive because a
 * Task-tool run lands in <project>/<sessionId>/subagents/, a level deeper than
 * an ordinary session, and it expires on the same clock.
 */
async function walk(root: string, prefix = ''): Promise<string[]> {
  let entries
  try {
    entries = await readdir(join(root, prefix), { withFileTypes: true })
  } catch {
    // A directory that cannot be read must not cost every other directory.
    return []
  }
  const found: string[] = []
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const relative = join(prefix, entry.name)
    if (entry.isDirectory()) found.push(...(await walk(root, relative)))
    else if (entry.name.endsWith('.jsonl')) found.push(relative)
  }
  return found
}

/**
 * Append the bytes of `source` beyond what `target` already holds. Returns the
 * number copied, or null if the source could not be read.
 */
async function appendNewBytes(source: string, target: string): Promise<number | null> {
  let sourceSize: number
  try {
    sourceSize = (await stat(source)).size
  } catch {
    return null
  }

  let targetSize = 0
  try {
    targetSize = (await stat(target)).size
  } catch {
    await mkdir(join(target, '..'), { recursive: true })
  }

  // A source shorter than the copy was truncated or replaced, so the copy is no
  // longer a prefix of it. Keep what is archived rather than overwriting it: the
  // archive's job is to hold what would otherwise be lost.
  if (sourceSize <= targetSize) return 0

  const reader = await open(source, 'r')
  try {
    const buffer = Buffer.alloc(sourceSize - targetSize)
    await reader.read(buffer, 0, buffer.length, targetSize)
    const writer = await open(target, 'a')
    try {
      await writer.write(buffer)
    } finally {
      await writer.close()
    }
    return buffer.length
  } finally {
    await reader.close()
  }
}

/**
 * Carry a cursor recorded against the agent's path over to the archived path,
 * once. Cursors were keyed by the original location before the archive existed;
 * without this, ingest would re-read those bytes from the copy and append the
 * same records again under fresh seq numbers, which UNIQUE(session_id, seq)
 * cannot catch.
 */
function adoptCursor(db: Database.Database, source: string, target: string): void {
  db.prepare(
    `INSERT INTO ingest_cursors (file_path, byte_offset, last_seen_at)
     SELECT ?, byte_offset, last_seen_at FROM ingest_cursors WHERE file_path = ?
     ON CONFLICT(file_path) DO NOTHING`,
  ).run(target, source)
}
