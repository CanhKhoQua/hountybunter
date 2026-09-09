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
  },
  planPath: 'docs/superpowers/plans/p.md',
  planSteps: ['Step 1: Write the failing test', 'Step 2: Implement'],
  notes: [{ id: 'n1', title: 'SQLite over Postgres', stale: false }],
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
      git: { ok: false, branch: null, head: null, dirty: [], diffstat: null, defaultBranch: null, commits: [] },
      planPath: null,
      planSteps: [],
      notes: [],
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
})
