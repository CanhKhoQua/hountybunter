import matter from 'gray-matter'
import type { Registration } from './parse.js'

/**
 * Registration -> markdown. Empty optional fields are omitted rather than
 * written as null, so a minimal record stays minimal and re-reading it yields
 * the same object.
 */
export function serializeRegistration(registration: Registration): string {
  const data: Record<string, unknown> = {
    slug: registration.slug,
    name: registration.name,
    paths: registration.paths,
  }
  if (registration.git_remote) data.git_remote = registration.git_remote
  if (registration.plan) data.plan = registration.plan
  data.registered_at = registration.registered_at

  for (const [key, value] of Object.entries(registration.extra)) data[key] = value

  return matter.stringify(registration.body, data)
}
