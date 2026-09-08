import matter from 'gray-matter'
import { dateStr, str } from '../frontmatter.js'

export interface Registration {
  slug: string
  name: string
  /** Ordered. The first is primary: new notes are filed under its slug. */
  paths: string[]
  git_remote: string | null
  /** Repo-relative, so it reads the same from every worktree. */
  plan: string | null
  registered_at: string
  /** The record's prose. Somewhere to write this project's own conventions. */
  body: string
  /** Frontmatter keys we do not know about, preserved for a lossless round trip. */
  extra: Record<string, unknown>
  sourcePath: string
}

export class RegistrationParseError extends Error {
  constructor(
    message: string,
    readonly sourcePath: string,
    readonly field?: string,
  ) {
    super(message)
    this.name = 'RegistrationParseError'
  }
}

const KNOWN_KEYS = new Set(['slug', 'name', 'paths', 'git_remote', 'plan', 'registered_at'])

export function parseRegistration(raw: string, sourcePath: string): Registration {
  const { data, content } = matter(raw)

  const slug = str(data.slug)
  if (!slug) throw new RegistrationParseError('slug is required', sourcePath, 'slug')

  const paths = Array.isArray(data.paths) ? data.paths.map(str).filter(Boolean) : []
  if (paths.length === 0) {
    throw new RegistrationParseError('paths must name at least one directory', sourcePath, 'paths')
  }
  for (const path of paths) {
    if (!path.startsWith('/')) {
      throw new RegistrationParseError(
        `paths must be absolute — got "${path}"`,
        sourcePath,
        'paths',
      )
    }
  }

  const plan = str(data.plan) || null
  if (plan?.startsWith('/')) {
    throw new RegistrationParseError(
      `plan must be repo-relative so it survives the repository moving — got "${plan}"`,
      sourcePath,
      'plan',
    )
  }

  const extra: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(data)) {
    if (!KNOWN_KEYS.has(key)) extra[key] = value
  }

  return {
    slug,
    name: str(data.name) || slug,
    paths,
    git_remote: str(data.git_remote) || null,
    plan,
    registered_at: dateStr(data.registered_at),
    body: content.trim(),
    extra,
    sourcePath,
  }
}
