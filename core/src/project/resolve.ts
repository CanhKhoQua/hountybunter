import { normalisePath, projectSlug } from '../paths.js'
import type { Registration } from './parse.js'
import { readAllRegistrations } from './store.js'

export interface ResolvedProject {
  /** Where new notes are filed. */
  slug: string
  /**
   * Every slug this record's paths hash to, primary first. `projectSlug` is
   * path-derived, so a worktree filed notes under its own slug; reading the
   * whole set makes them visible again without moving a file.
   */
  slugs: string[]
  primaryPath: string
  /**
   * The longest registered path that contains the resolved cwd — not
   * necessarily `primaryPath`. `plan` is repo-relative precisely so it reads
   * the same from every worktree (spec §3), so it must be resolved against
   * the directory the session is actually in, not the project's first path.
   */
  matchedPath: string
  plan: string | null
  registration: Registration
}

/** True when `cwd` is `root` or sits inside it, matched at a segment boundary. */
function within(root: string, cwd: string): boolean {
  return cwd === root || cwd.startsWith(`${root}/`)
}

export function resolveFrom(
  registrations: Registration[],
  cwd: string,
): ResolvedProject | null {
  const here = normalisePath(cwd)
  let best: { registration: Registration; path: string } | null = null

  for (const registration of registrations) {
    for (const raw of registration.paths) {
      const path = normalisePath(raw)
      if (!within(path, here)) continue
      // Longest wins, so a project registered inside another resolves to the
      // inner one rather than to whichever was read first.
      if (!best || path.length > best.path.length) best = { registration, path }
    }
  }
  if (!best) return null

  const { registration } = best
  const primaryPath = normalisePath(registration.paths[0]!)
  // Every path's hash-derived slug is read, not just the primary's: notes
  // filed under a path before it was registered — or under a worktree's own
  // slug — stay findable without a file ever moving.
  const slugs = [registration.slug, ...registration.paths.map((p) => projectSlug(p))]

  return {
    slug: registration.slug,
    slugs: [...new Set(slugs)],
    primaryPath,
    matchedPath: best.path,
    plan: registration.plan,
    registration,
  }
}

export async function resolveProject(
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ResolvedProject | null> {
  const { registrations } = await readAllRegistrations(env)
  return resolveFrom(registrations, cwd)
}

/**
 * The slug new work is filed under: the registered project's, or today's
 * path-derived one when nothing is registered. Registration is additive.
 */
export async function slugFor(
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  return (await resolveProject(cwd, env))?.slug ?? projectSlug(cwd)
}
