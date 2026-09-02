import { readdir, realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export interface DirectoryEntry {
  name: string
  path: string
}

export interface Listing {
  /** The resolved directory being listed. */
  path: string
  /** One level up, or null at the filesystem root. */
  parent: string | null
  entries: DirectoryEntry[]
}

/**
 * The directories inside `path`, for choosing where to start a hunt.
 *
 * Names only, never file contents. Anything able to reach this port can
 * already ask `POST /api/hunts` to run an agent in any directory, so listing
 * the names of directories adds nothing to what that grants — but it is worth
 * being deliberate: the browser needs to show what is there, not what is in it.
 */
export async function listDirectories(
  path: string | undefined,
  env: NodeJS.ProcessEnv,
): Promise<Listing | null> {
  const asked = path?.trim() || env.HOME || homedir()

  // Resolved first, so a directory reached through a symlink reports the
  // location the agent will report from inside it. Comparing the two forms is
  // what silently unbinds every hunt started under /tmp on macOS.
  let here: string
  try {
    here = await realpath(asked)
    if (!(await stat(here)).isDirectory()) return null
  } catch {
    return null
  }

  let found
  try {
    found = await readdir(here, { withFileTypes: true })
  } catch {
    // A directory that exists but cannot be read is not an empty one, and
    // saying so would invite the user to start a hunt they cannot start.
    return null
  }

  const entries = found
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => ({ name: entry.name, path: join(here, entry.name) }))
    // Case-insensitive, or every capitalised name sorts above every lowercase
    // one and `Library` lands nowhere near where it is read for.
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))

  const up = dirname(here)
  return { path: here, parent: up === here ? null : up, entries }
}
