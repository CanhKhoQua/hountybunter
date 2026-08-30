import { parseArgs } from 'node:util'
import {
  appendJot,
  indexNote,
  listNotes,
  openDb,
  projectSlug,
  promoteJot,
  readJots,
  rebuildFromDisk,
  searchNotes,
  snapshotState,
} from '@hountybunter/core'
import { ingestAll } from '@hountybunter/adapter-claude-code'

export interface Io {
  out(line: string): void
  err(line: string): void
  env: NodeJS.ProcessEnv
  cwd: string
}

const USAGE = `usage: hb <command>

  jot <text...>                       capture one line for the current project
  promote <n> --question Q --chosen C [--title T]   n = position in the full list, oldest first
  search <query> [--project P] [--limit N]
  list [--project P] [--status S] [--limit N]
  ingest                              read new Claude Code transcript lines
  rebuild [--verify]                  rebuild the index from disk`

/** Parse a numeric CLI option, or explain precisely what was wrong with it. */
function positiveInt(value: string | undefined, flag: string): number | undefined {
  if (value === undefined) return undefined
  const n = Number(value)
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`${flag} must be a positive whole number — got "${value}"`)
  }
  return n
}

export async function runCli(argv: string[], io: Io): Promise<number> {
  const [command, ...rest] = argv
  try {
    switch (command) {
      case 'jot': return await cmdJot(rest, io)
      case 'promote': return await cmdPromote(rest, io)
      case 'search': return await cmdSearch(rest, io)
      case 'list': return await cmdList(rest, io)
      case 'ingest': return await cmdIngest(io)
      case 'rebuild': return await cmdRebuild(rest, io)
      default:
        io.err(USAGE)
        return 1
    }
  } catch (error) {
    // parseArgs throws on a malformed flag, and a bad value can surface far later
    // as a driver error. Someone typing `hb promote -1` should get a sentence.
    io.err(`hb${command ? ` ${command}` : ''}: ${(error as Error).message}`)
    return 1
  }
}

async function cmdJot(args: string[], io: Io): Promise<number> {
  const text = args.join(' ').trim()
  if (!text) {
    io.err('hb jot: needs some text')
    return 1
  }
  const jot = await appendJot(
    { project: projectSlug(io.cwd), text },
    { env: io.env, timeZone: io.env.HOUNTYBUNTER_TZ },
  )
  // The number reported here is what `hb promote` consumes: a position in the
  // full chronological list, not the line number within today's file. Those two
  // disagree from the second day onward.
  const position = (await readJots({ env: io.env })).length
  io.out(`jotted #${position} on ${jot.date} for ${jot.project}`)
  return 0
}

async function cmdPromote(args: string[], io: Io): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      question: { type: 'string' },
      chosen: { type: 'string' },
      title: { type: 'string' },
    },
  })

  if (!values.question) {
    io.err('hb promote: --question is required')
    return 1
  }
  if (!values.chosen) {
    io.err('hb promote: --chosen is required')
    return 1
  }

  const index = positiveInt(positionals[0], '<n>')
  if (index === undefined) {
    io.err('hb promote: needs a jot number — see `hb promote --help` for what n means')
    return 1
  }
  const jots = await readJots({ env: io.env })
  const jot = jots[index - 1]
  if (!jot) {
    io.err(`hb promote: no jot #${index}`)
    return 1
  }

  const note = await promoteJot(
    jot,
    { question: values.question, chosen: values.chosen, title: values.title },
    { env: io.env, timeZone: io.env.HOUNTYBUNTER_TZ },
  )

  // Index it now. The store is the source of truth and the index is derived, so
  // writing one without the other leaves `hb search` unable to find a note that
  // demonstrably exists — which is exactly what the README's own sequence did.
  const db = openDb(io.env)
  try {
    indexNote(db, note)
  } finally {
    db.close()
  }

  io.out(`wrote ${note.id}`)
  return 0
}

async function cmdSearch(args: string[], io: Io): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { project: { type: 'string' }, limit: { type: 'string' } },
  })
  const query = positionals.join(' ').trim()
  if (!query) {
    io.err('hb search: needs a query')
    return 1
  }

  const db = openDb(io.env)
  try {
    const hits = searchNotes(db, query, {
      project: values.project,
      limit: positiveInt(values.limit, '--limit'),
    })
    if (hits.length === 0) {
      io.out('no matches')
      return 0
    }
    for (const hit of hits) {
      io.out(`${hit.id}  ${hit.title}`)
      if (hit.snippet) io.out(`    ${hit.snippet}`)
    }
    return 0
  } finally {
    db.close()
  }
}

async function cmdList(args: string[], io: Io): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      project: { type: 'string' },
      status: { type: 'string' },
      limit: { type: 'string' },
    },
  })

  const db = openDb(io.env)
  try {
    const hits = listNotes(db, {
      project: values.project,
      status: values.status,
      limit: positiveInt(values.limit, '--limit'),
    })
    if (hits.length === 0) {
      io.out('no notes yet')
      return 0
    }
    for (const hit of hits) io.out(`${hit.id}  [${hit.status}]  ${hit.title}`)
    return 0
  } finally {
    db.close()
  }
}

async function cmdIngest(io: Io): Promise<number> {
  const db = openDb(io.env)
  try {
    const report = await ingestAll(db, io.env)
    io.out(`ingested ${report.activities} activities from ${report.sessions} sessions`)
    if (report.skippedLines > 0) io.out(`skipped ${report.skippedLines} malformed lines`)
    for (const [kind, count] of Object.entries(report.unknownKinds)) {
      io.out(`unknown record type "${kind}" x${count} (kept with payload)`)
    }
    return 0
  } finally {
    db.close()
  }
}

async function cmdRebuild(args: string[], io: Io): Promise<number> {
  const { values } = parseArgs({ args, options: { verify: { type: 'boolean' } } })

  const report = await rebuildFromDisk(io.env)
  io.out(`indexed ${report.notesIndexed} note${report.notesIndexed === 1 ? '' : 's'}`)
  for (const error of report.errors) {
    io.err(`${error.sourcePath}: ${error.message}`)
  }

  if (values.verify) {
    const first = snapshotState(openDb(io.env))
    await rebuildFromDisk(io.env)
    const second = snapshotState(openDb(io.env))
    if (first !== second) {
      io.err('rebuild is not deterministic — state differed between runs')
      return 1
    }
    io.out('verified: a second rebuild produced identical state')
  }
  return report.errors.length > 0 ? 1 : 0
}
