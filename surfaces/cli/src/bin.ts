import { execFile } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { parseArgs, promisify } from 'node:util'
import {
  EVIDENCE_KINDS,
  acknowledgeNote,
  appendJot,
  calendarDate,
  composeBrief,
  countNotes,
  indexNote,
  indexRegistration,
  listNotes,
  listSessions,
  markSuperseded,
  nowIso,
  openDb,
  projectPathFor,
  projectSlug,
  projectsDir,
  promoteJot,
  readAllNotes,
  readAllRegistrations,
  readGitState,
  readJots,
  recordVerification,
  clearSessionIndex,
  rebuildFromDisk,
  replaySpool,
  resolveFrom,
  resolveProject,
  resolveTimeZone,
  slugFor,
  searchNotes,
  snapshotState,
  verifyNote,
  writeRegistration,
} from '@hountybunter/core'
import type { Evidence, EvidenceKind, Note, RejectedOption } from '@hountybunter/core'
import { findTranscripts, ingestAll, readLastExchange, syncArchive } from '@hountybunter/adapter-claude-code'
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
              [--drafted]                           an agent worded it; you approved it
              [--supersedes note-id]                retires that note, repeatable
  search <query> [--project P] [--limit N]
  list [--project P] [--status S] [--limit N]
  ingest                              read new Claude Code transcript lines
  verify [--ack (<note-id> | --all)]  check cited evidence against the code; --ack records a baseline
  sessions [--project P] [--limit N]  list ingested sessions, newest first
  rebuild [--verify]                  rebuild the index from disk
  register [path] [--plan P]          declare a project so hb brief can speak for it
  brief [--no-ingest]                 what a fresh agent needs to continue here
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
      case 'verify': return await cmdVerify(rest, io)
      case 'sessions': return await cmdSessions(rest, io)
      case 'rebuild': return await cmdRebuild(rest, io)
      case 'register': return await cmdRegister(rest, io)
      case 'brief': return await cmdBrief(rest, io)
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
    { project: await slugFor(io.cwd, io.env), text },
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
      drafted: { type: 'boolean' },
      supersedes: { type: 'string', multiple: true },
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

  // Registered or not, the resolver below covers both: a resolved project
  // reports its own slug regardless of path, and falling back to `projectSlug`
  // reproduces today's unregistered behaviour exactly.
  const resolved = await resolveProject(io.cwd, io.env)
  const slugOf = resolved ? () => resolved.slug : projectSlug

  const note = await promoteJot(
    jot,
    {
      question: values.question,
      chosen: values.chosen,
      title: values.title,
      rejected: parseRejected(values.rejected),
      evidence: parseEvidence(values.evidence),
      origin: values.drafted ? 'drafted' : 'authored',
      supersedes: values.supersedes ?? [],
      // Where the note is being written from. Kept only if it hashes to the
      // jot's project, so the store learns the directory of a project it knows
      // only through decisions — and never learns a wrong one.
      projectPath: io.cwd,
      slugOf,
    },
    { env: io.env, timeZone: io.env.HOUNTYBUNTER_TZ },
  )

  // Index it now. The store is the source of truth and the index is derived, so
  // writing one without the other leaves `hb search` unable to find a note that
  // demonstrably exists — which is exactly what the README's own sequence did.
  const db = openDb(io.env)
  try {
    indexNote(db, note)
    // The replaced notes are marked after the new one is written: a decision
    // must never be retired before the thing that replaces it exists.
    for (const id of values.supersedes ?? []) await markSuperseded(db, id, io.env)
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

    // The command people already run. Verification that needs its own command
    // to be remembered is verification that does not happen.
    const { notes } = await readAllNotes(io.env)
    const checked = await verifyAll(notes, db, io)
    if (checked.stale > 0) io.out(`${checked.stale} notes look stale — run \`hb verify\``)
    return 0
  } finally {
    db.close()
  }
}

/**
 * Check notes and record what was found. Reading only — `hb ingest` calls this
 * too, and it must never write to a note file.
 */
async function verifyAll(
  notes: Note[],
  db: ReturnType<typeof openDb>,
  io: Io,
): Promise<{ checked: number; stale: number; unbaselined: number }> {
  const hasSession = db.prepare('SELECT 1 FROM sessions WHERE id = ?')
  const sessionExists = (id: string) => hasSession.get(id) !== undefined
  const today = calendarDate(nowIso(), resolveTimeZone(io.env))
  const at = nowIso()

  let stale = 0
  let unbaselined = 0
  for (const note of notes) {
    const verdict = await verifyNote(note, { projectPath: projectPathFor(db, note), sessionExists, today })
    recordVerification(db, verdict, at)
    if (!note.verified) unbaselined += 1
    if (verdict.stale) {
      stale += 1
      io.out(`${note.id} — ${verdict.reasons.join(', ')}`)
    }
  }
  return { checked: notes.length, stale, unbaselined }
}

async function cmdVerify(args: string[], io: Io): Promise<number> {
  const ack = args.includes('--ack')
  const all = args.includes('--all')
  const positionals = args.filter((a) => !a.startsWith('-'))
  const named = positionals[0]

  // Validate before anything opens the database: `--ack` writes to note files,
  // and a typo or an unsupported combination must refuse rather than guess
  // which half of it was meant.
  const unknownFlag = args.find((a) => a.startsWith('-') && a !== '--ack' && a !== '--all')
  if (unknownFlag) {
    io.err(`hb verify: unrecognized flag "${unknownFlag}" — expected --ack or --all`)
    return 1
  }
  if (positionals.length > 1) {
    io.err(`hb verify: takes at most one note id — got ${positionals.join(', ')}`)
    return 1
  }
  if (all && named) {
    io.err(`hb verify: --all and a note id are mutually exclusive — got "${named}"`)
    return 1
  }
  if (all && !ack) {
    io.err('hb verify: --all only makes sense with --ack')
    return 1
  }
  if (ack && !all && !named) {
    io.err('hb verify: --ack needs a note id, or --all')
    return 1
  }

  const { notes, errors } = await readAllNotes(io.env)
  for (const error of errors) io.err(`hb verify: ${error.message}`)

  const db = openDb(io.env)
  try {
    const targets = all || !named ? notes : notes.filter((n) => n.id === named)
    if (named && targets.length === 0) {
      io.err(`hb verify: no note ${named}`)
      return 1
    }

    if (ack) {
      const hasSession = db.prepare('SELECT 1 FROM sessions WHERE id = ?')
      const sessionExists = (id: string) => hasSession.get(id) !== undefined
      const today = calendarDate(nowIso(), resolveTimeZone(io.env))
      for (const note of targets) {
        const acked = await acknowledgeNote(
          note,
          { projectPath: projectPathFor(db, note), sessionExists, today },
          io.env,
        )
        indexNote(db, acked)
        // indexNote resets every evidence row to `unknown`, which would
        // contradict what acknowledgeNote just measured — the same
        // re-verify-and-record the web surface's ack route does.
        const verdict = await verifyNote(acked, {
          projectPath: projectPathFor(db, acked),
          sessionExists,
          today,
        })
        recordVerification(db, verdict, nowIso())
        io.out(`confirmed ${acked.id}`)
      }
      return 0
    }

    const report = await verifyAll(targets, db, io)
    io.out(`${report.checked} notes checked, ${report.stale} stale`)
    if (report.unbaselined > 0) {
      // Not an error and not a stale count: nothing is known about these yet.
      io.out(
        `${report.unbaselined} note${report.unbaselined === 1 ? '' : 's'} have no baseline — ` +
          'run `hb verify --ack --all` to record one',
      )
    }
    return 0
  } finally {
    db.close()
  }
}

/**
 * Rebuild the whole index from what the store already holds: notes from their
 * markdown, sessions from the transcript archive. Pulling anything new in is
 * `hb ingest`'s job, not this one's.
 *
 * Both halves, because the schema-version error tells the user to delete the
 * index and rebuild — and an instruction that restores half the index is worse
 * than none, since `hb list` then reports nothing while the files are right
 * there.
 */
async function rebuildEverything(
  io: Io,
): Promise<{ notes: number; sessions: number; projects: number; errors: string[] }> {
  const db = openDb(io.env)
  let sessions: number
  try {
    clearSessionIndex(db)
    sessions = (await ingestAll(db, io.env)).sessions
  } finally {
    db.close()
  }
  const notes = await rebuildFromDisk(io.env)
  return {
    notes: notes.notesIndexed,
    sessions,
    projects: notes.projectsRegistered,
    errors: notes.errors.map((e) => `${e.sourcePath}: ${e.message}`),
  }
}

async function cmdRebuild(args: string[], io: Io): Promise<number> {
  const { values } = parseArgs({ args, options: { verify: { type: 'boolean' } } })

  const report = await rebuildEverything(io)
  io.out(
    `indexed ${report.notes} note${report.notes === 1 ? '' : 's'}, ` +
      `${report.sessions} session${report.sessions === 1 ? '' : 's'} and ` +
      `${report.projects} project${report.projects === 1 ? '' : 's'}`,
  )
  for (const error of report.errors) io.err(error)

  if (values.verify) {
    const first = snapshotState(openDb(io.env))
    await rebuildEverything(io)
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

/**
 * The main worktree for `path`, or null when this is not a git worktree.
 *
 * A worktree is a different directory for the same project, and
 * `projectSlug` is path-derived — so without this, every worktree would
 * register as a project of its own and the notes would scatter.
 */
async function mainWorktree(path: string): Promise<string | null> {
  try {
    const { stdout } = await promisify(execFile)(
      'git',
      ['-C', path, 'rev-parse', '--path-format=absolute', '--git-common-dir'],
      { timeout: 2000 },
    )
    const commonDir = stdout.trim()
    if (!commonDir) return null
    // `<main>/.git` for a normal clone and for every worktree of it.
    return commonDir.endsWith('/.git') ? dirname(commonDir) : null
  } catch {
    return null
  }
}

async function cmdRegister(args: string[], io: Io): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { plan: { type: 'string' } },
  })

  const path = resolve(io.cwd, positionals[0] ?? '.')
  const plan = values.plan
  if (plan?.startsWith('/')) {
    io.err(`hb register: --plan must be repo-relative so it survives the repository moving — got "${plan}"`)
    return 1
  }

  const { registrations, errors } = await readAllRegistrations(io.env)
  for (const error of errors) io.err(`hb register: skipped ${error.sourcePath}: ${error.message}`)

  const main = await mainWorktree(path)

  // Already registered under this path, or a worktree of something registered.
  const existing =
    resolveFrom(registrations, path) ?? (main ? resolveFrom(registrations, main) : null)

  // The record this command would write, and a refusal if it is one of the
  // records that did not parse — or if the store itself could not be read,
  // where such a record may be sitting unseen. A registration is authored:
  // paths, plan, prose and keys we know nothing about. Nothing regenerates it,
  // and a repair guessed at here would be the same overwrite by another name.
  const dir = projectsDir(io.env)
  const target = join(dir, `${existing?.registration.slug ?? projectSlug(path)}.md`)
  const blocking = errors.find((e) => e.sourcePath === target || e.sourcePath === dir)
  if (blocking) {
    io.err(
      `hb register: refusing to write ${target} — repair ${blocking.sourcePath} by hand first, or registering again would write over what is in it.`,
    )
    return 1
  }

  const today = calendarDate(nowIso(), resolveTimeZone(io.env))

  let written
  if (existing) {
    const record = existing.registration
    const paths = record.paths.includes(path) ? record.paths : [...record.paths, path]
    written = { ...record, paths, plan: plan ?? record.plan }
    await writeRegistration(written, io.env)
    io.out(`registered ${path} under ${written.slug} (${paths.length} path${paths.length > 1 ? 's' : ''})`)
  } else {
    const slug = projectSlug(path)
    written = {
      slug,
      name: basename(path) || slug,
      paths: [path],
      git_remote: null,
      plan: plan ?? null,
      registered_at: today,
      body: '',
      extra: {},
      sourcePath: target,
    }
    await writeRegistration(written, io.env)
    io.out(`registered ${path} as ${slug}`)
  }

  // Index it now. The store is the source of truth and the index is derived,
  // so writing one without the other leaves `hb search` unable to find a
  // project that demonstrably exists — which is exactly what the README's own
  // sequence did.
  const db = openDb(io.env)
  try {
    indexRegistration(db, written)
  } finally {
    db.close()
  }

  io.out('')
  io.out('Nothing in the repository was changed. Paste this into AGENTS.md and CLAUDE.md:')
  io.out('')
  io.out('    Run `hb brief` to see where this work was left.')
  return 0
}

/**
 * Registered directories that are not on disk right now. Reported in the brief
 * and never pruned from the record: an unmounted drive is not a deregistration.
 */
async function missingOf(paths: string[]): Promise<string[]> {
  const missing: string[] = []
  for (const path of paths) {
    try {
      await stat(path)
    } catch {
      missing.push(path)
    }
  }
  return missing
}

async function cmdBrief(args: string[], io: Io): Promise<number> {
  const { values } = parseArgs({ args, options: { 'no-ingest': { type: 'boolean' } } })

  const { registrations, errors } = await readAllRegistrations(io.env)
  // A malformed record is skipped with a named error (spec §9), and the name
  // has to reach a human: dropping it silently and calling the project
  // unregistered sends the user to `hb register`, which would then write over
  // the file they hand-edited.
  for (const error of errors) io.err(`hb brief: skipped ${error.sourcePath}: ${error.message}`)

  const project = resolveFrom(registrations, io.cwd)
  if (!project) {
    io.err(
      errors.length > 0
        ? `hb brief: ${io.cwd} matched no registered project, and the unreadable record${errors.length > 1 ? 's' : ''} above may be why. Repair the named file rather than registering again — \`hb register\` would write over it.`
        : `hb brief: ${io.cwd} is not a registered project. Run \`hb register\` here first.`,
    )
    return 1
  }

  // Ingest first: Codex has no hooks, so its sessions reach the index only
  // this way, and a brief that skipped it would be wrong in exactly the case
  // it exists for. A failure costs freshness, never the brief itself.
  let ingestError: string | null = null
  if (!values['no-ingest']) {
    try {
      await syncArchive(io.env)
      const db = openDb(io.env)
      try {
        await ingestAll(db, io.env)
      } finally {
        db.close()
      }
    } catch (error) {
      ingestError = (error as Error).message
    }
  }

  const db = openDb(io.env)
  try {
    // Merged and ordered before the limit, not concatenated and then sliced:
    // `listNotes` orders within one slug, so cutting the concatenation meant a
    // worktree slug's notes were never reached once the primary slug had ten
    // of its own — the fragmentation §5.2 exists to undo. Note ids start with
    // the date, so ordering by id descending is newest first, as `listNotes`
    // itself orders.
    const notes = project.slugs
      .flatMap((slug) => listNotes(db, { project: slug, status: 'standing', limit: 10 }))
      .sort((a, b) => b.id.localeCompare(a.id))
      .slice(0, 10)
    const notesTotal = project.slugs.reduce(
      (total, slug) => total + countNotes(db, { project: slug, status: 'standing' }),
      0,
    )
    // staleNoteIds(db, today) also flags notes whose review_after has passed,
    // which the brief must not report here: it labels a note "stale — its
    // evidence stopped matching", a claim that would be false for a note that
    // is merely due for review. This inline query keeps to evidence only.
    const staleIds = new Set(
      (db
        .prepare(
          `SELECT DISTINCT note_id FROM note_evidence WHERE state IN ('changed', 'missing')`,
        )
        .all() as { note_id: string }[]).map((r) => r.note_id),
    )

    const session = project.slugs
      .flatMap((slug) => listSessions(db, { project: slug, limit: 1 }))
      .sort((a, b) => (b.started_at ?? '').localeCompare(a.started_at ?? ''))[0]

    let lastExchange = null
    if (session) {
      const file = (await findTranscripts(io.env)).find((f) => f.sessionId === session.id)
      const tail = file ? await readLastExchange(file.path) : { prompt: null, reply: null }
      const harness = (db.prepare('SELECT harness FROM sessions WHERE id = ?').get(session.id) as
        | { harness: string }
        | undefined)?.harness
      lastExchange = { harness: harness ?? 'unknown', when: session.started_at, ...tail }
    }

    const planPath = project.plan
    let planSteps: string[] = []
    // What the plan holds, not what fits: the brief says how many steps it is
    // not showing, and it can only say that if it is told the real number.
    let planStepsTotal = 0
    if (planPath) {
      try {
        // Resolved against matchedPath, not primaryPath: the plan is
        // repo-relative so it reads the same from every worktree, and from a
        // worktree primaryPath names a *different* one. Do not fall back to
        // primaryPath when this read fails — that would show another
        // worktree's steps beside this one's commits, which is the bug this
        // resolution exists to fix.
        const text = await readFile(join(project.matchedPath, planPath), 'utf8')
        const steps = text
          .split('\n')
          .filter((l) => /^- \[[ x]\] /.test(l))
          .map((l) => l.replace(/^- \[[ x]\] /, '').replace(/\*\*/g, ''))
        planStepsTotal = steps.length
        planSteps = steps.slice(0, 12)
      } catch {
        // A plan pointing at a file that is not there is reported as the
        // pointer alone; inventing steps for it would be worse than silence.
      }
    }

    const brief = composeBrief({
      name: project.registration.name,
      slug: project.slug,
      git: await readGitState(io.cwd),
      missingPaths: await missingOf(project.registration.paths),
      planPath,
      planSteps,
      planStepsTotal,
      notes: notes.map((n) => ({ id: n.id, title: n.title, stale: staleIds.has(n.id) })),
      notesTotal,
      lastExchange,
      ingestError,
    })
    // The brief already ends in the newline after its closing instruction, and
    // `io.out` terminates every line it is given — so the last one is handed
    // over without it. Printing it whole would end the command with a blank
    // line and spend a byte the composer's cap never budgeted for.
    io.out(brief.replace(/\n$/, ''))
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
