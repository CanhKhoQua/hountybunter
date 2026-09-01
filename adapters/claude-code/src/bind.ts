import type Database from 'better-sqlite3'
import { open, readdir, realpath, stat } from 'node:fs/promises'
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

/** Only the first chunk is read: `cwd` is on the transcript's first line. */
const HEAD_BYTES = 8192

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
 * The newest transcript whose own first line reports this `cwd`.
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
    const reported = await firstLineCwd(path)
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

async function firstLineCwd(path: string): Promise<string | null> {
  let handle
  try {
    handle = await open(path, 'r')
  } catch {
    return null
  }
  try {
    const buffer = Buffer.alloc(HEAD_BYTES)
    const { bytesRead } = await handle.read(buffer, 0, HEAD_BYTES, 0)
    const head = buffer.toString('utf8', 0, bytesRead)
    const line = head.split('\n', 1)[0]
    if (!line) return null
    const record = JSON.parse(line) as { cwd?: unknown }
    return typeof record.cwd === 'string' ? record.cwd : null
  } catch {
    // A half-written or non-JSON first line means this file cannot answer.
    return null
  } finally {
    await handle.close()
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
    if (entry.isDirectory()) found.push(...(await walk(root, relative)))
    else if (entry.name.endsWith('.jsonl')) found.push(join(root, relative))
  }
  return found
}
