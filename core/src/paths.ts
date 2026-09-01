import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'

/** Strip a trailing separator so `/a/b/` and `/a/b` hash identically. */
function normalise(absPath: string): string {
  return absPath.length > 1 && absPath.endsWith('/') ? absPath.slice(0, -1) : absPath
}

/**
 * Directory-safe, stable, collision-free identifier for a project path.
 * The hash suffix is unconditional: two projects on this machine already share
 * the basename `tnm-dms`, and conditional suffixing would need global state.
 */
export function projectSlug(absPath: string): string {
  const path = normalise(absPath)
  const hash = createHash('sha256').update(path).digest('hex').slice(0, 6)
  const name = basename(path)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `${name || 'project'}-${hash}`
}

export function storeRoot(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.HOUNTYBUNTER_HOME
  if (override) return override
  return join(env.HOME ?? homedir(), '.hountybunter')
}

export function notesDir(slug: string, env: NodeJS.ProcessEnv = process.env): string {
  return join(storeRoot(env), 'notes', slug)
}

export function jotsDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(storeRoot(env), 'jots')
}

export function dbPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(storeRoot(env), 'index.db')
}

/** Where the running server publishes the port it actually bound. */
export function portFile(env: NodeJS.ProcessEnv = process.env): string {
  return join(storeRoot(env), 'port')
}

/** Where a hook parks an event when nothing is listening. */
export function spoolFile(env: NodeJS.ProcessEnv = process.env): string {
  return join(storeRoot(env), 'spool.jsonl')
}
