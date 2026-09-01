import { parseArgs } from 'node:util'
import {
  EVIDENCE_KINDS,
  appendJot,
  calendarDate,
  indexNote,
  listNotes,
  listSessions,
  openDb,
  projectSlug,
  promoteJot,
  readJots,
  rebuildFromDisk,
  replaySpool,
  resolveTimeZone,
  searchNotes,
  snapshotState,
} from '@hountybunter/core'
import type { Evidence, EvidenceKind, RejectedOption } from '@hountybunter/core'
import { ingestAll, syncArchive } from '@hountybunter/adapter-claude-code'
import { serve } from '@hountybunter/web'

export interface Io {
  out(line: string): void
  err(line: string): void
  env: NodeJS.ProcessEnv
  cwd: string
}

const USAGE = `usage: hb <command>

  jot <text...>                       capture one line for the current project
  jots [--limit N]                    list captured jots with their promote positions
  promote <n> --question Q --chosen C [--title T]   n = position in the full list, oldest first
              [--rejected 'option :: why not']      repeatable
              [--evidence kind:ref]                 kind = file | commit | session | url, repeatable
  search <query> [--project P] [--limit N]
  list [--project P] [--status S] [--limit N]
  ingest                              read new Claude Code transcript lines
  sessions [--project P] [--limit N]  list ingested sessions, newest first
  rebuild [--verify]                  rebuild the index from disk
  web [--port N]                      serve the local UI on 127.0.0.1`

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
      case 'jots': return await cmdJots(rest, io)
      case 'promote': return await cmdPromote(rest, io)
      case 'search': return await cmdSearch(rest, io)
      case 'list': return await cmdList(rest, io)
      case 'ingest': return await cmdIngest(io)
      case 'sessions': return await cmdSessions(rest, io)
      case 'rebuild': return await cmdRebuild(rest, io)
      case 'web': return await cmdWeb(rest, io)
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
  // `hb jot` takes no flags, so anything that looks like one is a mistake — and
  // filing it as the note's text corrupts the store without a word. `--` is the
  // usual escape for text that genuinely starts with a dash.
  const words = args[0] === '--' ? args.slice(1) : args
  if (args[0] !== '--' && args[0]?.startsWith('-')) {
    io.err(`hb jot: takes text, not flags — got "${args[0]}". Use \`hb jot -- ${args[0]}\` to jot it literally.`)
    return 1
  }
  const text = words.join(' ').trim()
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

/**
 * `option :: why not`. A doubled colon is chosen because prose about a rejected
 * option routinely contains a single one ("reason: it was slow").
 */
function parseRejected(values: string[] | undefined): RejectedOption[] {
  return (values ?? []).map((raw) => {
    const parts = raw.split('::')
    const option = parts[0]?.trim() ?? ''
    const why_not = parts.slice(1).join('::').trim()
    if (parts.length < 2 || !option || !why_not) {
      throw new Error(`--rejected needs \`option :: why not\` — got "${raw}"`)
    }
    return { option, why_not }
  })
}

/** `kind:ref`. Split on the first colon only, so a url ref keeps its own. */
function parseEvidence(values: string[] | undefined): Evidence[] {
  return (values ?? []).map((raw) => {
    const at = raw.indexOf(':')
    const kind = at < 0 ? '' : raw.slice(0, at).trim()
    const ref = at < 0 ? '' : raw.slice(at + 1).trim()
    if (!ref || !EVIDENCE_KINDS.includes(kind as EvidenceKind)) {
      throw new Error(
        `--evidence needs \`kind:ref\` with kind one of ${EVIDENCE_KINDS.join(', ')} — got "${raw}"`,
      )
    }
    return { kind: kind as EvidenceKind, ref }
  })
}

async function cmdPromote(args: string[], io: Io): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      question: { type: 'string' },
      chosen: { type: 'string' },
      title: { type: 'string' },
      rejected: { type: 'string', multiple: true },
      evidence: { type: 'string', multiple: true },
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
    {
      question: values.question,
      chosen: values.chosen,
      title: values.title,
      rejected: parseRejected(values.rejected),
      evidence: parseEvidence(values.evidence),
    },
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

async function cmdJots(args: string[], io: Io): Promise<number> {
  const { values } = parseArgs({ args, options: { limit: { type: 'string' } } })
  const limit = positiveInt(values.limit, '--limit') ?? 20

  const jots = await readJots({ env: io.env })
  if (jots.length === 0) {
    io.out('no jots yet')
    return 0
  }

  const start = Math.max(0, jots.length - limit)
  for (let i = start; i < jots.length; i++) {
    const jot = jots[i]!
    io.out(`${i + 1}  ${jot.date}  ${jot.project}  ${jot.text}`)
  }
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
    // Copy before reading. The agent deletes its transcripts on a 30-day clock,
    // so a run that only indexed them would be the last chance to see them.
    const archived = await syncArchive(io.env, db)
    if (archived.bytesCopied > 0) {
      io.out(`archived ${archived.bytesCopied} bytes from ${archived.files} transcripts`)
    }
    const report = await ingestAll(db, io.env)
    const spooled = await replaySpool(db, io.env)
    if (spooled.replayed > 0 || spooled.skipped > 0) {
      io.out(`replayed ${spooled.replayed} spooled hook events (${spooled.skipped} skipped)`)
    }
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

async function cmdSessions(args: string[], io: Io): Promise<number> {
  const { values } = parseArgs({
    args,
    options: { project: { type: 'string' }, limit: { type: 'string' } },
  })

  const db = openDb(io.env)
  try {
    const hits = listSessions(db, {
      project: values.project,
      limit: positiveInt(values.limit, '--limit'),
    })
    if (hits.length === 0) {
      io.out('no sessions yet — run `hb ingest` first')
      return 0
    }
    const timeZone = resolveTimeZone(io.env)
    for (const hit of hits) {
      // A session with no observed timestamp is dated `undated` rather than
      // silently borrowing today's date, matching how an absent HP signal is
      // shown as absent.
      const date = hit.started_at ? calendarDate(hit.started_at, timeZone) : 'undated'
      io.out(`${date}  ${hit.id}  ${hit.activities} acts  ${hit.title ?? '(untitled)'}`)
    }
    return 0
  } finally {
    db.close()
  }
}

/** A port, where 0 legitimately means "pick a free one" — so positiveInt is wrong here. */
function portNumber(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const n = Number(value)
  if (!Number.isInteger(n) || n < 0 || n > 65535) {
    throw new Error(`--port must be a whole number between 0 and 65535 — got "${value}"`)
  }
  return n
}

let running: Awaited<ReturnType<typeof serve>> | null = null

/** Stop a server started by `hb web`. Exposed so a caller can end what it began. */
export function stopWeb(): void {
  running?.close()
  running = null
}

async function cmdWeb(args: string[], io: Io): Promise<number> {
  const { values } = parseArgs({ args, options: { port: { type: 'string' } } })
  const port = portNumber(values.port) ?? 4771

  running = await serve({ port, env: io.env, clientDir: clientDir() })
  const address = running.address()
  const bound = typeof address === 'object' && address ? address.port : port

  // The address printed is the one actually bound, not the one asked for:
  // with --port 0 they differ, and a URL that does not work is worse than none.
  io.out(`hountybunter is at http://127.0.0.1:${bound}`)
  return 0
}

/** The built client, next to this package rather than guessed from the cwd. */
function clientDir(): string {
  return new URL('../../web/dist/client/', import.meta.url).pathname
}
