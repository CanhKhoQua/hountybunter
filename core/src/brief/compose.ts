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

/**
 * The cut is byte-budgeted, but text is not byte-addressable: slicing a UTF-8
 * buffer at an arbitrary byte offset can land inside a multi-byte character
 * and hand the reader a replacement glyph in place of the character that was
 * there. Walk back by whole characters instead, so the kept text is always
 * valid UTF-8 — this can only make the result shorter than a raw byte slice,
 * never longer.
 */
function truncateUtf8(text: string, maxBytes: number): string {
  let bytes = 0
  let end = 0
  for (const ch of text) {
    bytes += Buffer.byteLength(ch, 'utf8')
    if (bytes > maxBytes) break
    end += ch.length
  }
  return text.slice(0, end)
}

function block(title: string, tier: 'declared' | 'observed', lines: string[]): string {
  const body = lines.length > 0 ? lines.join('\n') : ABSENT
  return `## ${title}  (${tier})\n\n${body}\n`
}

/**
 * Keep the first `keep` entries and say what happened to the rest. A list cut
 * down to nothing still has to report that — rendering it as an empty list
 * would read as absence, and absence is a different claim than "there was
 * content here that didn't fit."
 */
function trimmed<T>(items: T[], keep: number, render: (item: T) => string): string[] {
  const dropped = items.length - keep
  const lines = items.slice(0, keep).map(render)
  return dropped > 0 ? [...lines, `… ${dropped} more, cut to fit`] : lines
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

  const tail = '\nVerify against the working tree before acting on any of this.\n'

  const exchange = input.lastExchange
  const exchangeHead = exchange
    ? `## Last exchange  (observed · ${exchange.harness}${exchange.when ? ` · ${exchange.when}` : ''})\n\n`
    : ''
  const exchangeBody = exchange
    ? `you: ${exchange.prompt ?? ABSENT}\n\nagent: ${exchange.reply ?? ABSENT}\n`
    : `${block('Last exchange', 'observed', [])}`

  const head = [
    `# ${input.name} — where this was left`,
    '',
    input.ingestError ? `_ingest failed before this was written: ${input.ingestError}_\n` : '',
    // Reported, never pruned: an unmounted drive is not a deregistration.
    ...input.missingPaths.map((p) => `_registered but not on disk right now: ${p}_\n`),
  ].join('\n')

  // How many entries survive from each trimmable list. Sacrificed in this
  // order once the exchange alone can't make room: plan steps and commits are
  // recoverable — the plan file and `git log` still have them — the notes are
  // the anti-rewalk protection, and the dirty paths are, per spec, the
  // evidence that survived a session dying mid-edit. Least irreplaceable goes
  // first; branch/head and the closing instruction are never sacrificed.
  let planStepsKeep = input.planSteps.length
  let commitsKeep = git.commits.length
  let notesKeep = input.notes.length
  let dirtyKeep = git.dirty.length

  function fixedBlocks(): string {
    const inFlight = git.ok
      ? [
          `branch: ${git.branch ?? ABSENT}`,
          `head: ${git.head ?? ABSENT}`,
          ...(git.dirty.length > 0
            ? ['', 'uncommitted:', ...trimmed(git.dirty, dirtyKeep, (l) => `  ${l}`)]
            : ['', 'working tree clean']),
          ...(git.diffstat ? ['', git.diffstat] : []),
        ]
      : []

    const done = trimmed(git.commits, commitsKeep, (c) => `- ${c}`)

    const aiming = input.planPath
      ? [
          input.planPath,
          '',
          ...trimmed(input.planSteps, planStepsKeep, (s) => `- ${s}`),
          '',
          'Checkbox state in that file is unreliable — steps stay unticked after they land.',
          'Read completion from the commits above, not from the boxes.',
        ]
      : []

    const settled = trimmed(
      input.notes,
      notesKeep,
      (n) => `- ${n.title}${n.stale ? '  (stale — its evidence stopped matching)' : ''}`,
    )

    return [
      head,
      block('In flight now', 'observed', inFlight),
      block('Done on this branch', 'observed', done),
      block('Aiming at', 'declared', aiming),
      block('Already settled', 'declared', settled),
    ].join('\n')
  }

  // Assemble around whatever the fixed blocks currently are, applying the
  // existing exchange cut on top. Used both to search for a keep-count that
  // fits and to produce the final string, so there is exactly one formula for
  // "does this fit" — a second one, computed separately, is how the last
  // budgeting bug happened.
  function assemble(fixed: string): string {
    const room = capBytes - Buffer.byteLength(fixed + '\n' + exchangeHead + tail, 'utf8')
    // The exchange is the one elastic block, so it is the one that gets cut
    // first. The tree state is short and is what the reader most needs exact.
    const cut = Buffer.byteLength(exchangeBody, 'utf8') > room
    const kept = cut
      ? `${truncateUtf8(exchangeBody, Math.max(room - 24, 0))}\n… cut to fit\n`
      : exchangeBody
    return `${fixed}\n${exchangeHead}${kept}${tail}`
  }

  // Cutting the exchange down to nothing is sometimes not enough: the fixed
  // blocks themselves — twenty commits, a dozen plan steps — can exceed the
  // cap on their own. Fall back to trimming them, strictly in priority order.
  while (Buffer.byteLength(assemble(fixedBlocks()), 'utf8') > capBytes) {
    if (planStepsKeep > 0) planStepsKeep--
    else if (commitsKeep > 0) commitsKeep--
    else if (notesKeep > 0) notesKeep--
    else if (dirtyKeep > 0) dirtyKeep--
    // Nothing left to sacrifice: branch, head, and the closing instruction
    // are printed anyway. Honesty about the tree beats obedience to a byte
    // count, and every list that lost entries has already said so above.
    else break
  }

  return assemble(fixedBlocks())
}
