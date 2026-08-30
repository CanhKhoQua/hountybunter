import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { notesDir, storeRoot } from '../paths.js'
import { calendarDate } from '../time.js'
import type { Note } from '../types.js'
import { NoteParseError, parseNote } from './parse.js'
import { serializeNote } from './serialize.js'

export function slugifyTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '')
}

export function makeNoteId(title: string, dateIso: string, timeZone: string): string {
  const date = calendarDate(dateIso, timeZone)
  const slug = slugifyTitle(title)
  // A title in a non-Latin script slugifies to nothing, and two titles sharing
  // their first 60 characters slugify identically — either way the second note
  // would overwrite the first without a word. A short hash of the full title keeps
  // the id distinctive in both cases and leaves ordinary titles untouched.
  const needsSuffix = slug === '' || title.length > 60
  if (!needsSuffix) return `${date}-${slug}`
  const digest = createHash('sha256').update(title).digest('hex').slice(0, 8)
  return slug === '' ? `${date}-${digest}` : `${date}-${slug}-${digest}`
}

export async function writeNote(
  note: Note,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const dir = notesDir(note.project, env)
  await mkdir(dir, { recursive: true })
  const path = join(dir, `${note.id}.md`)
  await writeFile(path, serializeNote(note), 'utf8')
  return path
}

export interface ReadAllResult {
  notes: Note[]
  errors: NoteParseError[]
}

/**
 * Read every note in the store. A file that fails to parse is collected as an
 * error rather than aborting the read, so one bad file cannot hide the rest.
 */
export async function readAllNotes(
  env: NodeJS.ProcessEnv = process.env,
): Promise<ReadAllResult> {
  const root = join(storeRoot(env), 'notes')
  const notes: Note[] = []
  const errors: NoteParseError[] = []

  let projectDirs: string[]
  try {
    const entries = await readdir(root, { withFileTypes: true })
    projectDirs = entries.filter((e) => e.isDirectory()).map((e) => e.name)
  } catch {
    return { notes, errors }
  }

  for (const slug of projectDirs.sort()) {
    const dir = join(root, slug)
    let files: string[]
    try {
      files = (await readdir(dir)).filter((f) => f.endsWith('.md')).sort()
    } catch (error) {
      // One unreadable project directory must not hide every other project's
      // notes, for the same reason one unreadable file must not.
      errors.push(new NoteParseError(`could not list project directory: ${String(error)}`, dir))
      continue
    }
    for (const file of files) {
      const path = join(dir, file)
      try {
        notes.push(parseNote(await readFile(path, 'utf8'), path))
      } catch (error) {
        errors.push(
          error instanceof NoteParseError ? error : new NoteParseError(String(error), path),
        )
      }
    }
  }

  notes.sort((a, b) => a.id.localeCompare(b.id))
  return { notes, errors }
}
