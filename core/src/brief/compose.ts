import type { GitState } from './git.js'

export interface BriefNote {
  id: string
  title: string
  stale: boolean
}

export interface LastExchange {
  harness: string
  when: string | null
  prompt: string | null
  reply: string | null
}

export interface BriefInput {
  name: string
  git: GitState
  /** Registered directories that are no longer on disk. Reported, never pruned. */
  missingPaths: string[]
  /** Repo-relative, as declared. */
  planPath: string | null
  planSteps: string[]
  notes: BriefNote[]
  lastExchange: LastExchange | null
  ingestError: string | null
}

const ABSENT = '_absent_'

function block(title: string, tier: 'declared' | 'observed', lines: string[]): string {
  const body = lines.length > 0 ? lines.join('\n') : ABSENT
  return `## ${title}  (${tier})\n\n${body}\n`
}

/**
 * The state of the work, as markdown, for an agent that has just arrived.
 *
 * Composed mechanically: no model is called, so what it says is only ever what
 * the store and the working tree already held. Every block names its tier, and
 * a block with nothing behind it prints as absent rather than as an all-clear.
 */
export function composeBrief(input: BriefInput, capBytes = 2048): string {
  const { git } = input

  const inFlight = git.ok
    ? [
        `branch: ${git.branch ?? ABSENT}`,
        `head: ${git.head ?? ABSENT}`,
        ...(git.dirty.length > 0
          ? ['', 'uncommitted:', ...git.dirty.map((l) => `  ${l}`)]
          : ['', 'working tree clean']),
        ...(git.diffstat ? ['', git.diffstat] : []),
      ]
    : []

  const done = git.commits.map((c) => `- ${c}`)

  const aiming = input.planPath
    ? [
        input.planPath,
        '',
        ...input.planSteps.map((s) => `- ${s}`),
        '',
        'Checkbox state in that file is unreliable — steps stay unticked after they land.',
        'Read completion from the commits above, not from the boxes.',
      ]
    : []

  const settled = [
    ...input.notes.map((n) => `- ${n.title}${n.stale ? '  (stale — its evidence stopped matching)' : ''}`),
  ]

  const head = [
    `# ${input.name} — where this was left`,
    '',
    input.ingestError ? `_ingest failed before this was written: ${input.ingestError}_\n` : '',
    // Reported, never pruned: an unmounted drive is not a deregistration.
    ...input.missingPaths.map((p) => `_registered but not on disk right now: ${p}_\n`),
  ].join('\n')

  const fixed = [
    head,
    block('In flight now', 'observed', inFlight),
    block('Done on this branch', 'observed', done),
    block('Aiming at', 'declared', aiming),
    block('Already settled', 'declared', settled),
  ].join('\n')

  const tail = '\nVerify against the working tree before acting on any of this.\n'

  const exchange = input.lastExchange
  const exchangeHead = exchange
    ? `## Last exchange  (observed · ${exchange.harness}${exchange.when ? ` · ${exchange.when}` : ''})\n\n`
    : ''
  const exchangeBody = exchange
    ? `you: ${exchange.prompt ?? ABSENT}\n\nagent: ${exchange.reply ?? ABSENT}\n`
    : `${block('Last exchange', 'observed', [])}`

  const room = capBytes - Buffer.byteLength(fixed + exchangeHead + tail, 'utf8')
  // The exchange is the one elastic block, so it is the one that gets cut. The
  // tree state is short and is what the reader most needs to be exact.
  const cut = Buffer.byteLength(exchangeBody, 'utf8') > room
  const kept = cut
    ? `${Buffer.from(exchangeBody, 'utf8').subarray(0, Math.max(room - 24, 0)).toString('utf8')}\n… cut to fit\n`
    : exchangeBody

  return `${fixed}\n${exchangeHead}${kept}${tail}`
}
