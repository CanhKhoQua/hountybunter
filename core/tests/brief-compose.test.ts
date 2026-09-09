import { describe, expect, it } from 'vitest'
import { composeBrief, type BriefInput } from '../src/brief/compose.js'

const base: BriefInput = {
  name: 'hountybunter',
  missingPaths: [],
  git: {
    ok: true,
    branch: 'feat/x',
    head: 'ac3b33f merge: note staleness',
    dirty: [' M core/src/a.ts'],
    diffstat: ' core/src/a.ts | 3 +-',
    defaultBranch: 'main',
    commits: ['bf70b99 fix(core): a hand-edited baseline'],
    commitsTotal: 1,
    dirtyTotal: 1,
  },
  planPath: 'docs/superpowers/plans/p.md',
  planSteps: ['Step 1: Write the failing test', 'Step 2: Implement'],
  planStepsTotal: 2,
  notes: [{ id: 'n1', title: 'SQLite over Postgres', stale: false }],
  notesTotal: 1,
  lastExchange: {
    harness: 'claude-code',
    when: '2026-09-08T10:00:00.000Z',
    prompt: 'continue the staleness work',
    reply: 'verified the baseline drops when the hash is gone',
  },
  ingestError: null,
}

describe('composeBrief', () => {
  it('leads with what is uncommitted, because that is what a dead session left', () => {
    const text = composeBrief(base)
    expect(text.indexOf('core/src/a.ts')).toBeLessThan(text.indexOf('docs/superpowers/plans/p.md'))
  })

  it('labels each block with how far it can be trusted', () => {
    const text = composeBrief(base)
    expect(text).toContain('observed')
    expect(text).toContain('declared')
  })

  it('warns that plan checkboxes are not where completion is read from', () => {
    expect(composeBrief(base)).toMatch(/checkbox/i)
  })

  it('tells the reader to check the tree before acting on any of it', () => {
    expect(composeBrief(base)).toMatch(/verify|check/i)
  })

  it('prints absence as absence rather than as nothing to do', () => {
    const text = composeBrief({
      ...base,
      git: {
        ok: false,
        branch: null,
        head: null,
        dirty: [],
        dirtyTotal: 0,
        diffstat: null,
        defaultBranch: null,
        commits: [],
        commitsTotal: 0,
      },
      planPath: null,
      planSteps: [],
      planStepsTotal: 0,
      notes: [],
      notesTotal: 0,
      lastExchange: null,
    })
    expect(text).toMatch(/absent/i)
    expect(text).not.toContain('undefined')
    expect(text).not.toContain('null')
  })

  it('marks a cut instead of trailing off, and respects the cap', () => {
    const long = 'x'.repeat(9000)
    const text = composeBrief({ ...base, lastExchange: { ...base.lastExchange!, reply: long } }, 2048)
    expect(Buffer.byteLength(text, 'utf8')).toBeLessThanOrEqual(2048)
    expect(text).toMatch(/cut|truncated/i)
  })

  it('keeps the blocks that matter when it has to cut', () => {
    const long = 'x'.repeat(9000)
    const text = composeBrief({ ...base, lastExchange: { ...base.lastExchange!, reply: long } }, 2048)
    // The exchange is the elastic part; the tree state is not.
    expect(text).toContain('core/src/a.ts')
  })

  it('says when the ingest that precedes it failed', () => {
    expect(composeBrief({ ...base, ingestError: 'EACCES' })).toContain('EACCES')
  })

  it('reports a registered directory that is not on disk, without dropping it', () => {
    // An unmounted drive is not a deregistration, so this is a line in the
    // brief rather than an edit to the record.
    const text = composeBrief({ ...base, missingPaths: ['/w/wt/phase-8b'] })
    expect(text).toContain('/w/wt/phase-8b')
    expect(text).toMatch(/not on disk/i)
  })

  it('cuts on a character boundary, so a multi-byte reply never leaves a replacement character', () => {
    const long = 'ệ'.repeat(9000) // Vietnamese, 3 bytes per character in UTF-8 — many ways to land mid-character
    const text = composeBrief({ ...base, lastExchange: { ...base.lastExchange!, reply: long } }, 2048)
    expect(text).not.toContain('�')
    expect(Buffer.byteLength(text, 'utf8')).toBeLessThanOrEqual(2048)
    expect(text).toMatch(/cut|truncated/i)
  })

  it('respects the cap for every reply length near the boundary, marking a cut whenever one happens', () => {
    // A single hand-picked length would not have caught this: the separator
    // `room` forgot to budget for is a one-byte miss, live at exactly one
    // length in this span. Pin the property across the whole span instead.
    for (let len = 1250; len <= 1360; len++) {
      const reply = 'x'.repeat(len)
      const text = composeBrief({ ...base, lastExchange: { ...base.lastExchange!, reply } }, 2048)
      expect(Buffer.byteLength(text, 'utf8')).toBeLessThanOrEqual(2048)
      if (!text.includes(reply)) {
        expect(text).toMatch(/cut|truncated/i)
      }
    }
  })

  it('trims the least irreplaceable content first when the fixed blocks alone are already over budget, and says what it dropped', () => {
    // Roughly what this repository's own `hb brief` produces: 20 commits, 5
    // dirty paths with a diffstat, 12 plan steps, 5 notes, and an exchange.
    const commits = Array.from(
      { length: 20 },
      (_, i) => `${(1000 + i).toString(16)} fix(core): a realistically long commit subject line number ${i}`,
    )
    const dirty = Array.from({ length: 5 }, (_, i) => ` M core/src/some/fairly/nested/file-${i}.ts`)
    const planSteps = Array.from(
      { length: 12 },
      (_, i) => `Step ${i + 1}: a reasonably long and descriptive plan step title`,
    )
    const notes = Array.from({ length: 5 }, (_, i) => ({
      id: `n${i}`,
      title: `Decision ${i}: a settled call with a fairly long title describing why`,
      stale: false,
    }))

    const text = composeBrief({
      ...base,
      git: {
        ...base.git,
        commits,
        commitsTotal: commits.length,
        dirty,
        dirtyTotal: dirty.length,
        diffstat: ' 5 files changed, 120 insertions(+), 40 deletions(-)',
      },
      planSteps,
      planStepsTotal: planSteps.length,
      notes,
      notesTotal: notes.length,
    })

    expect(Buffer.byteLength(text, 'utf8')).toBeLessThanOrEqual(2048)
    // Block 1's essentials are never sacrificed.
    expect(text).toContain('branch: feat/x')
    expect(text).toContain('head: ac3b33f merge: note staleness')
    // Something had to give, and the brief says so rather than just omitting it.
    expect(text).toMatch(/more, cut to fit/)
  })

  it('says a list was trimmed away rather than reading as though it was never there', () => {
    // A small, easily-fitting exchange keeps that block out of the way, so
    // only the notes block's own text is under test.
    const withoutNote: BriefInput = {
      name: 'x',
      git: {
        ok: true,
        branch: 'b',
        head: 'h',
        dirty: [],
        dirtyTotal: 0,
        diffstat: null,
        defaultBranch: 'main',
        commits: [],
        commitsTotal: 0,
      },
      missingPaths: [],
      planPath: null,
      planSteps: [],
      planStepsTotal: 0,
      notes: [],
      notesTotal: 0,
      lastExchange: { harness: 'claude-code', when: null, prompt: 'p', reply: 'r' },
      ingestError: null,
    }
    const withOneNote: BriefInput = {
      ...withoutNote,
      notes: [{ id: 'n1', title: 'a note long enough to matter once it is dropped', stale: false }],
      notesTotal: 1,
    }

    // Isolate the "Already settled" block: commits and the plan are also
    // genuinely absent in this fixture, and their own `_absent_` text isn't
    // what this test is about.
    function settledBlock(text: string): string {
      return text.slice(text.indexOf('## Already settled'), text.indexOf('## Last exchange'))
    }

    // Genuinely nothing there: prints absent.
    const absentText = composeBrief(withoutNote, 100_000)
    expect(settledBlock(absentText)).toContain('_absent_')

    // A cap tight enough that the one note cannot survive, but not so tight
    // that anything else needs sacrificing first — isolates the notes block.
    const tightCap = Buffer.byteLength(absentText, 'utf8')
    const trimmedText = composeBrief(withOneNote, tightCap)
    expect(settledBlock(trimmedText)).not.toContain('_absent_')
    expect(settledBlock(trimmedText)).toMatch(/more, cut to fit/)
  })

  /** Which `## ` block of the brief, given its title. */
  function blockOf(text: string, title: string): string {
    return text.split(/\n(?=## )/).find((b) => b.startsWith(`## ${title}`)) ?? ''
  }

  /** A brief whose only large part is a diffstat covering `files` changed files. */
  function withDiffstat(files: number): BriefInput {
    const names = Array.from({ length: files }, (_, i) => `core/src/some/nested/file-${i}.ts`)
    return {
      ...base,
      git: {
        ...base.git,
        diffstat: [
          ...names.map((n) => ` ${n} | 12 ++++++------`),
          ` ${files} files changed, ${files * 8} insertions(+), ${files * 4} deletions(-)`,
        ].join('\n'),
      },
    }
  }

  it('holds the cap however many files the diffstat covers', () => {
    // `git.dirty` is capped by its producer; the diffstat is not, and it grew
    // to 4x the cap at 200 changed files because it was never on the ladder.
    for (const files of [30, 60, 200]) {
      expect(Buffer.byteLength(composeBrief(withDiffstat(files)), 'utf8')).toBeLessThanOrEqual(2048)
    }
  })

  it('sacrifices the diffstat before the notes, because one git command reproduces it', () => {
    const text = composeBrief(withDiffstat(200))
    // The notes are the anti-rewalk protection; `git diff --stat` is one command.
    expect(text).toContain('SQLite over Postgres')
    expect(blockOf(text, 'In flight now')).toMatch(/more, cut to fit/)
  })

  it('never leaves a cut marker with nothing for it to be about', () => {
    // Truncating the exchange at a deeply negative budget used to erase its
    // own heading — and, with no exchange at all, the absent marker — leaving
    // the brief claiming a cut where it showed the reader nothing.
    for (const cap of [120, 200, 400, 800, 1200, 2048]) {
      for (const input of [withDiffstat(200), { ...withDiffstat(200), lastExchange: null }]) {
        const text = composeBrief(input, cap)
        const heading = text.indexOf('## Last exchange')
        expect(heading).toBeGreaterThan(-1)
        expect(text.slice(heading)).toMatch(/^## Last exchange[^\n]*\n\n(_absent_|you: |… cut to fit\n)/)
        // Every list marker carries its count; a bare one has no subject.
        expect(text.slice(0, heading)).not.toMatch(/^… cut to fit$/m)
      }
    }
  })

  it('gives up the uncommitted paths only when nothing else is left to give', () => {
    // The working tree is the evidence a session dying mid-edit left behind,
    // so it is the last rung: this fixture has nothing else on the ladder.
    const dirty = Array.from(
      { length: 20 },
      (_, i) => ` M core/src/a/deliberately/long/and/deeply/nested/path/that/eats/the/whole/budget/file-${i}.ts`,
    )
    const text = composeBrief({
      ...base,
      git: {
        ...base.git,
        dirty,
        dirtyTotal: dirty.length,
        diffstat: null,
        commits: [],
        commitsTotal: 0,
      },
      planPath: null,
      planSteps: [],
      planStepsTotal: 0,
      notes: [],
      notesTotal: 0,
      lastExchange: null,
    })

    expect(Buffer.byteLength(text, 'utf8')).toBeLessThanOrEqual(2048)
    expect(text).toContain('branch: feat/x')
    expect(text).toContain('head: ac3b33f merge: note staleness')
    expect(blockOf(text, 'In flight now')).toMatch(/more, cut to fit/)
  })

  it('counts what its caller cut before handing the list over, not only what it cut itself', () => {
    // The real numbers on this branch: 76 commits and 70 plan steps, of which
    // the producers pass on 20 and 12. A count of what the composer alone
    // dropped would tell the reader the branch holds 20 commits.
    const commits = Array.from(
      { length: 20 },
      (_, i) => `${(1000 + i).toString(16)} fix(core): a realistically long commit subject ${i}`,
    )
    const planSteps = Array.from(
      { length: 12 },
      (_, i) => `Step ${i + 1}: a reasonably long and descriptive plan step title`,
    )
    const text = composeBrief({
      ...base,
      git: { ...base.git, commits, commitsTotal: 76, diffstat: null },
      planSteps,
      planStepsTotal: 70,
    })

    function accounted(block: string, bullet: string): number {
      const kept = block.split('\n').filter((l) => l.startsWith(bullet)).length
      const dropped = Number(/… (\d+) more, cut to fit/.exec(block)?.[1] ?? 0)
      return kept + dropped
    }

    expect(accounted(blockOf(text, 'Done on this branch'), '- ')).toBe(76)
    expect(accounted(blockOf(text, 'Aiming at'), '- ')).toBe(70)
  })

  it('keeps a short diffstat whole rather than empty it for no saving, when the commit list can give a little instead', () => {
    // Regression for a real reproduction: a diffstat this short costs about as
    // many bytes to replace with the marker as it saves, so giving it up
    // should never happen while dropping a single commit already fits. At
    // this exact cap the fixed blocks alone need trimming, and the only two
    // honest outcomes are "keep the diffstat, drop one commit" (524 bytes) or
    // the wasteful one this bug produced: empty the diffstat for nothing and
    // still drop two commits (487 bytes) to compensate.
    const commits = Array.from({ length: 5 }, (_, i) => `abc000${i} fix: short commit subject ${i}`)
    const text = composeBrief(
      {
        name: 'x',
        git: {
          ok: true,
          branch: 'b',
          head: 'h',
          dirty: [],
          dirtyTotal: 0,
          diffstat: ' core/src/a.ts | 3 +-',
          defaultBranch: 'main',
          commits,
          commitsTotal: commits.length,
        },
        missingPaths: [],
        planPath: null,
        planSteps: [],
        planStepsTotal: 0,
        notes: [],
        notesTotal: 0,
        lastExchange: null,
        ingestError: null,
      },
      524,
    )

    expect(Buffer.byteLength(text, 'utf8')).toBeLessThanOrEqual(524)
    expect(blockOf(text, 'In flight now')).toContain('core/src/a.ts | 3 +-')
    expect(blockOf(text, 'In flight now')).not.toMatch(/more, cut to fit/)
    expect(blockOf(text, 'Done on this branch')).toMatch(/1 more, cut to fit/)
  })

  /**
   * The byte size `composeBrief` would produce for the same input if the
   * named block kept one more entry than it actually did — reconstructed from
   * the block's own marker, since the composer exposes no way to ask for a
   * keep count directly. `items` must be the exact list passed to that block
   * (no producer-side truncation), so the dropped count equals its own length
   * minus how many are shown.
   */
  function sizeIfOneMoreKept(text: string, title: string, items: string[], render: (item: string) => string): number | null {
    const b = blockOf(text, title)
    const match = /… (\d+) more, cut to fit/.exec(b)
    if (!match) return null // nothing was dropped here; there is nothing to restore
    const dropped = Number(match[1])
    const kept = items.length - dropped
    const restoredItem = render(items[kept])
    const newMarker = dropped - 1 > 0 ? `\n… ${dropped - 1} more, cut to fit` : ''
    const newBlock = b.slice(0, match.index) + restoredItem + newMarker + b.slice(match.index + match[0].length)
    const at = text.indexOf(b)
    return Buffer.byteLength(text.slice(0, at) + newBlock + text.slice(at + b.length), 'utf8')
  }

  it('reduces a rung only as far as it must, for a whole span of caps', () => {
    // Short entries everywhere: a diffstat line, a commit subject, a plan
    // step and a note title all cost about as much as the "… N more, cut to
    // fit" marker that replaces the first one dropped — exactly the territory
    // where the search used to zero a rung that had nothing to gain from it.
    const diffstatLines = Array.from({ length: 10 }, (_, i) => ` f${i}.ts | 1 +`)
    const commits = Array.from({ length: 10 }, (_, i) => `h${i} a`)
    const planSteps = Array.from({ length: 10 }, (_, i) => `s${i}`)
    const noteTitles = Array.from({ length: 10 }, (_, i) => `t${i}`)
    const input: BriefInput = {
      name: 'x',
      git: {
        ok: true,
        branch: 'b',
        head: 'h',
        dirty: [],
        dirtyTotal: 0,
        diffstat: diffstatLines.join('\n'),
        defaultBranch: 'main',
        commits,
        commitsTotal: commits.length,
      },
      missingPaths: [],
      planPath: 'p.md',
      planSteps,
      planStepsTotal: planSteps.length,
      notes: noteTitles.map((title, i) => ({ id: `n${i}`, title, stale: false })),
      notesTotal: noteTitles.length,
      lastExchange: null,
      ingestError: null,
    }

    // Below this floor, even every rung emptied can't fit — the "print
    // anyway, honesty beats obedience to a byte count" last resort, which the
    // "gives up the uncommitted paths" test above already covers. The cap
    // invariant only has content to say once the ladder has room to work.
    const floor = Buffer.byteLength(composeBrief(input, 1), 'utf8')
    const full = Buffer.byteLength(composeBrief(input, 100_000), 'utf8')

    for (let cap = floor + 1; cap <= full; cap++) {
      const text = composeBrief(input, cap)
      expect(Buffer.byteLength(text, 'utf8')).toBeLessThanOrEqual(cap)

      const restored = [
        sizeIfOneMoreKept(text, 'In flight now', diffstatLines, (l) => l),
        sizeIfOneMoreKept(text, 'Done on this branch', commits, (c) => `- ${c}`),
        sizeIfOneMoreKept(text, 'Aiming at', planSteps, (s) => `- ${s}`),
        sizeIfOneMoreKept(text, 'Already settled', noteTitles, (t) => `- ${t}`),
      ]
      for (const size of restored) {
        if (size !== null) expect(size).toBeGreaterThan(cap)
      }
    }
  })
})
