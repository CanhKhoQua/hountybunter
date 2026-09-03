import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { parseNote } from '../src/note/parse.js'
import { verifyNote } from '../src/verify/note.js'

let dir: string
const never = () => false

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'hb-verify-note-'))
})

function note(frontmatter: string) {
  return parseNote(
    `---\nid: n1\ntitle: t\nproject: p\nquestion: q?\nchosen: c\n${frontmatter}---\n\nbody\n`,
    '/store/n1.md',
  )
}

describe('verifyNote', () => {
  it('is not stale when nobody has ever set a baseline', async () => {
    // The whole store starts here. Guessing either way would declare every note
    // fresh, or every note rotten, on a coin toss.
    await writeFile(join(dir, 'a.ts'), 'x\n')
    const verdict = await verifyNote(note('evidence:\n  - {kind: file, ref: a.ts}\n'), {
      projectPath: dir,
      sessionExists: never,
      today: '2026-09-02',
    })

    expect(verdict.refs[0]!.state).toBe('unknown')
    expect(verdict.stale).toBe(false)
    expect(verdict.reasons).toEqual([])
  })

  it('is stale when a cited file has been edited since it was confirmed', async () => {
    await writeFile(join(dir, 'a.ts'), 'x\n')
    const verdict = await verifyNote(
      note(
        'evidence:\n  - {kind: file, ref: a.ts}\n' +
          'verified:\n  on: 2026-09-01\n  refs:\n    - {ref: a.ts, hash: sha256:stale}\n',
      ),
      { projectPath: dir, sessionExists: never, today: '2026-09-02' },
    )

    expect(verdict.refs[0]!.state).toBe('changed')
    expect(verdict.stale).toBe(true)
    expect(verdict.reasons).toEqual(['changed'])
  })

  it('is stale when a cited file is gone, and says so differently', async () => {
    const verdict = await verifyNote(
      note(
        'evidence:\n  - {kind: file, ref: gone.ts}\n' +
          'verified:\n  on: 2026-09-01\n  refs:\n    - {ref: gone.ts, hash: sha256:x}\n',
      ),
      { projectPath: dir, sessionExists: never, today: '2026-09-02' },
    )

    expect(verdict.refs[0]!.state).toBe('missing')
    expect(verdict.reasons).toEqual(['missing'])
  })

  it('is stale once its review date has passed, whatever the evidence says', async () => {
    // The only source that works for a note whose evidence is all url.
    const verdict = await verifyNote(
      note('review_after: 2026-08-01\nevidence:\n  - {kind: url, ref: https://e.invalid}\n'),
      { projectPath: dir, sessionExists: never, today: '2026-09-02' },
    )

    expect(verdict.stale).toBe(true)
    expect(verdict.reasons).toEqual(['review-due'])
  })

  it('is not stale on the review date itself', async () => {
    // `review_after` means after.
    const verdict = await verifyNote(note('review_after: 2026-09-02\n'), {
      projectPath: dir,
      sessionExists: never,
      today: '2026-09-02',
    })
    expect(verdict.stale).toBe(false)
  })

  it('is not stale when the only thing wrong is that nothing could be checked', async () => {
    // The load-bearing rule. An absent repository is not news about the note.
    const verdict = await verifyNote(
      note('evidence:\n  - {kind: file, ref: a.ts}\n  - {kind: url, ref: https://e.invalid}\n'),
      { projectPath: null, sessionExists: never, today: '2026-09-02' },
    )

    expect(verdict.refs.map((r) => r.state)).toEqual(['unknown', 'unknown'])
    expect(verdict.stale).toBe(false)
  })

  it('reports every reason it is stale, without repeating one', async () => {
    const verdict = await verifyNote(
      note(
        'review_after: 2026-08-01\n' +
          'evidence:\n  - {kind: file, ref: g1.ts}\n  - {kind: file, ref: g2.ts}\n' +
          'verified:\n  on: 2026-07-01\n  refs:\n' +
          '    - {ref: g1.ts, hash: sha256:x}\n    - {ref: g2.ts, hash: sha256:y}\n',
      ),
      { projectPath: dir, sessionExists: never, today: '2026-09-02' },
    )

    expect(verdict.reasons).toEqual(['missing', 'review-due'])
  })

  it('puts a changed reference before a missing one, and says each once', async () => {
    // The order is part of what `reasons` promises, and swapping the two
    // pushes that build it would otherwise go unnoticed: no other test has a
    // changed reference and a missing one at the same time.
    await writeFile(join(dir, 'a.ts'), 'x\n')
    await writeFile(join(dir, 'b.ts'), 'y\n')
    const verdict = await verifyNote(
      note(
        'evidence:\n' +
          '  - {kind: file, ref: a.ts}\n' +
          '  - {kind: file, ref: b.ts}\n' +
          '  - {kind: file, ref: gone.ts}\n' +
          'verified:\n  on: 2026-09-01\n  refs:\n' +
          '    - {ref: a.ts, hash: sha256:stale}\n' +
          '    - {ref: b.ts, hash: sha256:also-stale}\n' +
          '    - {ref: gone.ts, hash: sha256:x}\n',
      ),
      { projectPath: dir, sessionExists: never, today: '2026-09-02' },
    )

    expect(verdict.refs.map((r) => r.state)).toEqual(['changed', 'changed', 'missing'])
    expect(verdict.reasons).toEqual(['changed', 'missing'])
  })
})
