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
  /**
   * How many steps the plan holds, of which `planSteps` may be only the first
   * few. Required rather than inferred from the array: the brief says how much
   * it dropped, and it can only say that about a cut it knows happened.
   */
  planStepsTotal: number
  notes: BriefNote[]
  /** How many standing notes the project holds, of which `notes` may be a prefix. */
  notesTotal: number
  lastExchange: LastExchange | null
  ingestError: string | null
}

const ABSENT = '_absent_'

/** What the exchange says when its content did not fit at all. */
const CUT = '… cut to fit\n'

/**
 * Below this there is no room for the exchange to say anything a reader could
 * act on, so the block prints its heading and the cut marker alone. A couple
 * of dozen bytes of a prompt is a fragment, not content.
 */
const MIN_EXCHANGE_BYTES = 24

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
 *
 * `total` is how many entries existed before anything cut them, which is not
 * always `items.length`: a producer that caps its own output hands over a
 * prefix, and counting only what this function dropped would understate the
 * work by exactly the amount already gone.
 */
function trimmed<T>(items: T[], keep: number, total: number, render: (item: T) => string): string[] {
  const dropped = total - keep
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
    : ''

  const head = [
    `# ${input.name} — where this was left`,
    '',
    input.ingestError ? `_ingest failed before this was written: ${input.ingestError}_\n` : '',
    // Reported, never pruned: an unmounted drive is not a deregistration.
    ...input.missingPaths.map((p) => `_registered but not on disk right now: ${p}_\n`),
  ].join('\n')

  // The diffstat is a list of lines like any other, and it goes on the ladder
  // as one: `git diff --stat` covers every changed file, so it is unbounded
  // where every other block is short.
  const diffstatLines = git.diffstat ? git.diffstat.split('\n') : []

  // How many entries survive from each trimmable list. Sacrificed in the
  // ladder order below, most recoverable first: the exchange body (cut inside
  // `assemble`), then the diffstat — one `git diff --stat` reproduces it —
  // then plan steps and commits, which the plan file and `git log` still hold,
  // then the notes, which are the anti-rewalk protection, and last the dirty
  // paths, which are per spec the evidence that survived a session dying
  // mid-edit. Branch, head and the closing instruction are never sacrificed.
  let diffstatKeep = diffstatLines.length
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
            ? ['', 'uncommitted:', ...trimmed(git.dirty, dirtyKeep, git.dirtyTotal, (l) => `  ${l}`)]
            : ['', 'working tree clean']),
          // Labelled, so that a diffstat trimmed to its marker says what the
          // marker is counting rather than sitting under the uncommitted list.
          ...(diffstatLines.length > 0
            ? ['', 'diffstat:', ...trimmed(diffstatLines, diffstatKeep, diffstatLines.length, (l) => l)]
            : []),
        ]
      : []

    const done = trimmed(git.commits, commitsKeep, git.commitsTotal, (c) => `- ${c}`)

    const aiming = input.planPath
      ? [
          input.planPath,
          '',
          ...trimmed(input.planSteps, planStepsKeep, input.planStepsTotal, (s) => `- ${s}`),
          '',
          'Checkbox state in that file is unreliable — steps stay unticked after they land.',
          'Read completion from the commits above, not from the boxes.',
        ]
      : []

    const settled = trimmed(
      input.notes,
      notesKeep,
      input.notesTotal,
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
  // exchange cut on top. Used both to search for keep-counts that fit and to
  // produce the final string, so there is exactly one formula for "does this
  // fit" — a second one, computed separately, is how the last budgeting bug
  // happened.
  function assemble(fixed: string): string {
    // With no exchange to show, the block is a fixed one: an absent marker
    // truncated away would leave the brief claiming it cut something from a
    // place where it showed nothing at all.
    if (!exchange) return `${fixed}\n${block('Last exchange', 'observed', [])}${tail}`

    const room = capBytes - Buffer.byteLength(`${fixed}\n${exchangeHead}${tail}`, 'utf8')
    if (Buffer.byteLength(exchangeBody, 'utf8') <= room) {
      return `${fixed}\n${exchangeHead}${exchangeBody}${tail}`
    }
    // The heading stays whatever happens: it is what the cut marker is about,
    // and a marker with no subject claims a cut the reader cannot place.
    const bodyBudget = room - Buffer.byteLength(CUT, 'utf8') - 1
    const kept = bodyBudget >= MIN_EXCHANGE_BYTES ? `${truncateUtf8(exchangeBody, bodyBudget)}\n` : ''
    return `${fixed}\n${exchangeHead}${kept}${CUT}${tail}`
  }

  function fits(): boolean {
    return Buffer.byteLength(assemble(fixedBlocks()), 'utf8') <= capBytes
  }

  // Cutting the exchange down to its heading is sometimes not enough: the
  // fixed blocks themselves — two hundred diffstat lines, twenty commits — can
  // exceed the cap on their own. Give up each rung in turn, in priority order.
  const ladder: { size: number; keep: (n: number) => void }[] = [
    { size: diffstatLines.length, keep: (n) => { diffstatKeep = n } },
    { size: input.planSteps.length, keep: (n) => { planStepsKeep = n } },
    { size: git.commits.length, keep: (n) => { commitsKeep = n } },
    { size: input.notes.length, keep: (n) => { notesKeep = n } },
    { size: git.dirty.length, keep: (n) => { dirtyKeep = n } },
  ]

  for (const rung of ladder) {
    if (fits()) break
    // The most this rung can keep, found by halving rather than by dropping
    // one entry at a time: a large repository's diffstat runs to thousands of
    // lines, and a pass per line would rebuild the whole brief thousands of
    // times. Rendering only grows with the count, so the two agree.
    let low = 0
    let high = rung.size
    while (low < high) {
      const mid = Math.ceil((low + high) / 2)
      rung.keep(mid)
      if (fits()) low = mid
      else high = mid - 1
    }
    rung.keep(low)
    // Nothing this rung can keep, so the next one is asked. When the last has
    // given everything, branch, head and the closing instruction are printed
    // anyway: honesty about the tree beats obedience to a byte count, and
    // every list that lost entries has already said so.
  }

  return assemble(fixedBlocks())
}
