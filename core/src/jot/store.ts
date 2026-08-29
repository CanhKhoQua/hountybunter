import { appendFile, mkdir, readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { jotsDir } from '../paths.js'
import { calendarDate, nowIso, resolveTimeZone } from '../time.js'

export interface Jot {
  instant: string
  project: string
  text: string
  /** 1-based line number within its day file, for later promotion. */
  line: number
  date: string
}

export interface JotOpts {
  env?: NodeJS.ProcessEnv
  clock?: () => Date
  timeZone?: string
}

const SEPARATOR = ' | '

export async function appendJot(
  input: { project: string; text: string },
  opts: JotOpts = {},
): Promise<Jot> {
  const text = input.text.replace(/\s*\n\s*/g, ' ').trim()
  if (!text) throw new Error('jot text is empty')

  const env = opts.env ?? process.env
  const timeZone = opts.timeZone ?? resolveTimeZone(env)
  const instant = nowIso(opts.clock)
  const date = calendarDate(instant, timeZone)

  const dir = jotsDir(env)
  await mkdir(dir, { recursive: true })
  const file = join(dir, `${date}.md`)

  let existing = ''
  try {
    existing = await readFile(file, 'utf8')
  } catch {
    existing = ''
  }
  const line = existing.split('\n').filter(Boolean).length + 1

  // A jot file is plain markdown and may be hand-edited, so it can arrive without
  // its trailing newline. Appending straight onto that line would merge two jots
  // into one that still parses as three fields — corruption that readJots cannot
  // detect, because the result is not malformed.
  const separator = existing.length > 0 && !existing.endsWith('\n') ? '\n' : ''

  await appendFile(
    file,
    `${separator}${instant}${SEPARATOR}${input.project}${SEPARATOR}${text}\n`,
    'utf8',
  )
  return { instant, project: input.project, text, line, date }
}

export async function readJots(opts: JotOpts = {}): Promise<Jot[]> {
  const dir = jotsDir(opts.env ?? process.env)
  let files: string[]
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith('.md')).sort()
  } catch {
    return []
  }

  const jots: Jot[] = []
  for (const file of files) {
    const date = file.replace(/\.md$/, '')
    const contents = await readFile(join(dir, file), 'utf8')
    let line = 0
    for (const raw of contents.split('\n')) {
      if (!raw.trim()) continue
      line += 1
      const parts = raw.split(SEPARATOR)
      // A line that does not match the format is skipped, not fatal.
      if (parts.length < 3) continue
      const [instant, project, ...rest] = parts
      jots.push({
        instant: instant!,
        project: project!,
        text: rest.join(SEPARATOR),
        line,
        date,
      })
    }
  }
  return jots
}
