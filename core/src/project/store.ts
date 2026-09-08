import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { projectsDir } from '../paths.js'
import { RegistrationParseError, parseRegistration, type Registration } from './parse.js'
import { serializeRegistration } from './serialize.js'

export async function writeRegistration(
  registration: Registration,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const dir = projectsDir(env)
  await mkdir(dir, { recursive: true })
  const path = join(dir, `${registration.slug}.md`)
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
  } catch {
    return { registrations: [], errors: [] }
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
