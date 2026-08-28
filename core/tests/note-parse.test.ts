import { describe, expect, it } from 'vitest'
import { NoteParseError, parseNote } from '../src/note/parse.js'

const FULL = `---
id: 2026-08-12-offline-reads
title: Offline reads for the rep PWA
project: tnm-dms-a3f9c1
kind: decision
status: standing
decided_on: 2026-08-12
question: How do reps keep working through network gaps?
chosen: TanStack Query v5 + idb-keyval persister
rejected:
  - option: Full offline sync engine
    why_not: Needs idempotency keys; gaps are minutes, not hours
evidence:
  - kind: file
    ref: src/lib/query/persister.ts
confidence: high
supersedes: []
---

The reasoning, in prose.
`

const MINIMAL = `---
question: Which database?
chosen: SQLite
---

Because it is a file.
`

describe('parseNote', () => {
  it('parses a full note', () => {
    const note = parseNote(FULL, '/store/a.md')
    expect(note.id).toBe('2026-08-12-offline-reads')
    expect(note.title).toBe('Offline reads for the rep PWA')
    expect(note.kind).toBe('decision')
    expect(note.status).toBe('standing')
    expect(note.rejected).toHaveLength(1)
    expect(note.rejected[0]?.option).toBe('Full offline sync engine')
    expect(note.evidence[0]).toEqual({ kind: 'file', ref: 'src/lib/query/persister.ts' })
    expect(note.confidence).toBe('high')
    expect(note.body.trim()).toBe('The reasoning, in prose.')
  })

  it('accepts a note with only the two required fields', () => {
    const note = parseNote(MINIMAL, '/store/b.md')
    expect(note.question).toBe('Which database?')
    expect(note.chosen).toBe('SQLite')
    expect(note.rejected).toEqual([])
    expect(note.evidence).toEqual([])
    expect(note.kind).toBe('decision')
    expect(note.status).toBe('standing')
  })

  it('derives a missing id from the filename', () => {
    expect(parseNote(MINIMAL, '/store/2026-01-02-pick-db.md').id).toBe('2026-01-02-pick-db')
  })

  it('rejects a note with no question', () => {
    const raw = '---\nchosen: SQLite\n---\n\nbody\n'
    expect(() => parseNote(raw, '/store/c.md')).toThrow(NoteParseError)
    expect(() => parseNote(raw, '/store/c.md')).toThrow(/question/)
  })

  it('rejects a note with no chosen', () => {
    expect(() => parseNote('---\nquestion: Which?\n---\n\nbody\n', '/store/d.md')).toThrow(/chosen/)
  })

  it('rejects an unknown kind rather than silently defaulting', () => {
    const raw = '---\nquestion: q\nchosen: c\nkind: wildguess\n---\n\nbody\n'
    expect(() => parseNote(raw, '/store/e.md')).toThrow(/kind/)
  })

  it('keeps unknown frontmatter keys in extra', () => {
    const raw = '---\nquestion: q\nchosen: c\nmood: cautious\n---\n\nbody\n'
    expect(parseNote(raw, '/store/f.md').extra).toEqual({ mood: 'cautious' })
  })

  it('tolerates a rejected entry missing why_not', () => {
    const raw = '---\nquestion: q\nchosen: c\nrejected:\n  - option: Redis\n---\n\nbody\n'
    expect(parseNote(raw, '/store/g.md').rejected[0]).toEqual({ option: 'Redis', why_not: '' })
  })

  it('reads an unquoted YAML date as the calendar day the author wrote', () => {
    const note = parseNote(FULL, '/store/a.md')
    expect(note.decided_on).toBe('2026-08-12')
  })

  it('reads a quoted YAML date identically', () => {
    const raw = '---\nquestion: q\nchosen: c\ndecided_on: "2026-08-12"\n---\n\nbody\n'
    expect(parseNote(raw, '/store/h.md').decided_on).toBe('2026-08-12')
  })

  it('reads review_after the same way', () => {
    const raw = '---\nquestion: q\nchosen: c\nreview_after: 2027-02-01\n---\n\nbody\n'
    expect(parseNote(raw, '/store/i.md').review_after).toBe('2027-02-01')
  })
})
