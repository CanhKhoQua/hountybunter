import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { basename, join, relative } from 'node:path'
import { projectsDir } from '../paths.js'
import { RegistrationParseError, parseRegistration, type Registration } from './parse.js'
import { serializeRegistration } from './serialize.js'

/**
 * Where `slug` is recorded in the store, or a thrown error when it is not a
 * single path segment.
 *
 * The slug is read out of a file a person edits by hand, so it can say
 * anything — and `../../escaped` would send this write into the user's
 * repository, which `hb register` promises never to touch.
 */
function recordPath(dir: string, slug: string): string {
  const target = join(dir, `${slug}.md`)
  // Two questions, because either one alone lets something through: `../../x`
  // climbs out of the store, and `sub/x` stays inside it but not where the
  // reader of the store looks.
  if (relative(dir, target) !== `${slug}.md` || slug !== basename(slug)) {
    throw new RegistrationParseError(
      `slug must be a single path segment so the record stays in the store — got "${slug}"`,
      target,
      'slug',
    )
  }
  return target
}

export async function writeRegistration(
  registration: Registration,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const dir = projectsDir(env)
  const path = recordPath(dir, registration.slug)
  await mkdir(dir, { recursive: true })
  await writeFile(path, serializeRegistration(registration), 'utf8')
  return path
}

export interface ReadAllRegistrations {
  registrations: Registration[]
  errors: RegistrationParseError[]
}

/**
 * Every registration in the store. A record that fails to parse is collected
 * as an error rather than aborting the read: one hand-edit gone wrong must not
 * cost every other project its brief.
 */
export async function readAllRegistrations(
  env: NodeJS.ProcessEnv = process.env,
): Promise<ReadAllRegistrations> {
  const dir = projectsDir(env)
  let names: string[]
  try {
    names = (await readdir(dir)).filter((n) => n.endsWith('.md')).sort()
  } catch (error) {
    // A store with no directory is a store nobody has registered anything in.
    // Anything else — a permission failure, say — is a store we could not
    // read, and reporting that as "no registrations" routes the user to `hb
    // register`, which would write over records it never saw.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { registrations: [], errors: [] }
    }
    return {
      registrations: [],
      errors: [
        new RegistrationParseError(
          `could not read the registration store: ${(error as Error).message}`,
          dir,
        ),
      ],
    }
  }

  const registrations: Registration[] = []
  const errors: RegistrationParseError[] = []
  for (const name of names) {
    const path = join(dir, name)
    try {
      registrations.push(parseRegistration(await readFile(path, 'utf8'), path))
    } catch (error) {
      errors.push(
        error instanceof RegistrationParseError
          ? error
          : new RegistrationParseError(String(error), path),
      )
    }
  }
  return { registrations, errors }
}
