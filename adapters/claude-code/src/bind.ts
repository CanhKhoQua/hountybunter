import type Database from 'better-sqlite3'
import { createReadStream } from 'node:fs'
import { readdir, realpath, stat } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { join } from 'node:path'
import { transcriptRoot } from './locate.js'

export interface Binding {
  sessionId: string
  /** `exact` came from a hook that named the session. `guessed` did not. */
  correlation: 'exact' | 'guessed'
}

export interface BindOptions {
  /** The directory the hunt was started in. */
  cwd: string
  /** Highest hook_events id at spawn time; only later hooks can be this hunt's. */
  sinceHookId: number
  /** When the hunt started, ISO 8601 UTC. */
  startedAt: string
}

/**
 * How many records to read before giving up on a transcript reporting its cwd.
 *
 * Bounded by lines rather than by bytes. Measured over 120 real transcripts,
 * the cwd is always within the first three records but is past 8 KB in 84 of
 * them, and as far in as 92 KB: the opening record can carry a whole prompt,
 * so a byte budget large enough to be safe would be large enough to be slow on
 * the 40 MB files in the same directory.
 */
const HEAD_LINES = 10

/** Where Claude Code writes the transcript of a Task-tool run. */
const SUBAGENT_DIR = 'subagents'

/** Watermark to take before spawning, so an older session's hooks cannot match. */
export function latestHookId(db: Database.Database): number {
  return (db.prepare('SELECT COALESCE(MAX(id), 0) AS id FROM hook_events').get() as { id: number })
    .id
}

/**
 * Work out which transcript a hunt is writing, in the order §7.4 sets out.
 *
 * A hook names the session outright, so it wins. Without hooks the best
 * available answer is the newest transcript that appeared in the same directory
 * after the hunt started — which is a guess, is labelled one, and must never be
 * shown as anything else: two sessions can be started in one directory seconds
 * apart, and nothing here can tell them apart.
 *
 * Re-resolved rather than decided once, because a hook is fire-and-forget and
 * can lose the race with the first paint. Returns null when nothing supports a
 * binding: an absent signal is shown as absent, not filled in.
 */
export async function bindHunt(
  db: Database.Database,
  opts: BindOptions,
  env: NodeJS.ProcessEnv = process.env,
): Promise<Binding | null> {
  const cwd = await resolved(opts.cwd)

  // Candidates first, then compare resolved paths. A directory reached through
  // a symlink is reported by the agent as its real location — on macOS every
  // /tmp path is really /private/tmp — so string equality in SQL would miss
  // every one of them, and a missed match reads as "no hooks installed".
  const candidates = db
    .prepare(
      `SELECT session_id, json_extract(payload_json, '$.cwd') AS cwd
       FROM hook_events WHERE id > ? ORDER BY id`,
    )
    .all(opts.sinceHookId) as { session_id: string; cwd: string | null }[]

  for (const candidate of candidates) {
    if (candidate.cwd && (await resolved(candidate.cwd)) === cwd) {
      return { sessionId: candidate.session_id, correlation: 'exact' }
    }
  }

  const guess = await newestTranscriptIn(cwd, Date.parse(opts.startedAt), env)
  return guess ? { sessionId: guess, correlation: 'guessed' } : null
}

/**
 * The newest transcript whose own opening records report this `cwd`.
 *
 * Matching on the file's contents rather than on the directory name: Claude
 * Code mangles a path into a directory name by a transform this code would have
 * to reproduce exactly, and a near-miss would bind confidently to the wrong
 * project. The file says where it ran.
 */
async function newestTranscriptIn(
  cwd: string,
  startedAtMs: number,
  env: NodeJS.ProcessEnv,
): Promise<string | null> {
  let best: { sessionId: string; mtime: number } | null = null

  for (const path of await walk(transcriptRoot(env))) {
    let mtime: number
    try {
      mtime = (await stat(path)).mtimeMs
    } catch {
      continue
    }
    // A file untouched since before the hunt started cannot be its transcript.
    // This is also what keeps the scan cheap: only what moved recently is read.
    if (mtime < startedAtMs) continue
    if (best && mtime <= best.mtime) continue
    const reported = await reportedCwd(path)
    if (!reported || (await resolved(reported)) !== cwd) continue

    const name = path.slice(path.lastIndexOf('/') + 1)
    best = { sessionId: name.replace(/\.jsonl$/, ''), mtime }
  }
  return best?.sessionId ?? null
}

/** The real location of a path, or the path itself when it does not exist. */
async function resolved(path: string): Promise<string> {
  try {
    return await realpath(path)
  } catch {
    // A directory that has since been deleted still has to compare equal to
    // itself, so an unresolvable path falls back to what it says.
    return path
  }
}

async function reportedCwd(path: string): Promise<string | null> {
  const stream = createReadStream(path, { encoding: 'utf8' })
  const lines = createInterface({ input: stream, crlfDelay: Infinity })
  try {
    let seen = 0
    for await (const line of lines) {
      if (++seen > HEAD_LINES) break
      if (!line) continue
      let record: { cwd?: unknown }
      try {
        record = JSON.parse(line) as { cwd?: unknown }
      } catch {
        // A half-written or non-JSON record is skipped, not fatal: the record
        // that names the cwd may still be further down.
        continue
      }
      if (typeof record.cwd === 'string') return record.cwd
    }
    return null
  } catch {
    // An unreadable file cannot answer.
    return null
  } finally {
    lines.close()
    stream.destroy()
  }
}

async function walk(root: string, prefix = ''): Promise<string[]> {
  let entries
  try {
    entries = await readdir(join(root, prefix), { withFileTypes: true })
  } catch {
    return []
  }
  const found: string[] = []
  for (const entry of entries) {
    const relative = join(prefix, entry.name)
    if (entry.isDirectory()) {
      // A Task-tool run writes its own transcript under `subagents/`, and it is
      // frequently the newest file in a project. A hunt spawns a top-level
      // `claude` and can never be one of these, so they are not candidates.
      if (entry.name === SUBAGENT_DIR) continue
      found.push(...(await walk(root, relative)))
    } else if (entry.name.endsWith('.jsonl')) found.push(join(root, relative))
  }
  return found
}
