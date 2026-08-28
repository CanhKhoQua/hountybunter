import { describe, expect, it } from 'vitest'
import { parseNote } from '../src/note/parse.js'
import { serializeNote } from '../src/note/serialize.js'

const CASES: Record<string, string> = {
  full: `---
id: 2026-08-12-offline-reads
title: Offline reads
project: tnm-dms-a3f9c1
kind: decision
status: standing
decided_on: 2026-08-12
question: How do reps work through network gaps?
chosen: TanStack Query + idb-keyval
rejected:
  - option: Full sync engine
    why_not: Needs idempotency keys
evidence:
  - kind: file
    ref: src/lib/query/persister.ts
  - kind: commit
    ref: abc1234
confidence: high
review_after: 2027-02-01
supersedes:
  - 2026-01-01-old-choice
---

Prose body.
`,
  minimal: `---
question: Which database?
chosen: SQLite
---

Because it is a file.
`,
  withUnknownKeys: `---
question: q
chosen: c
mood: cautious
reviewer: someone
---

body
`,
}

describe('note round trip', () => {
  for (const [name, raw] of Object.entries(CASES)) {
    it(`preserves everything for the ${name} case`, () => {
      const once = parseNote(raw, '/store/x.md')
      const twice = parseNote(serializeNote(once), '/store/x.md')
      expect(twice).toEqual(once)
    })
  }

  it('produces output that starts with frontmatter', () => {
    expect(serializeNote(parseNote(CASES.minimal!, '/store/x.md')).startsWith('---\n')).toBe(true)
  })

  it('omits optional fields that are empty rather than writing nulls', () => {
    const out = serializeNote(parseNote(CASES.minimal!, '/store/x.md'))
    expect(out).not.toMatch(/review_after/)
    expect(out).not.toMatch(/confidence/)
    expect(out).not.toMatch(/null/)
  })
})
