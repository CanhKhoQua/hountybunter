# Note Staleness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A note whose cited evidence has changed, or disappeared, or fallen past its review date says so — and one command clears it once a human has looked.

**Architecture:** A new `core/src/verify/` verifies one evidence reference at a time against disk and git, returning one of four states. A note's verdict is derived from its references plus `review_after`. The baseline a `file` reference is compared against lives in the note's own frontmatter, in a `verified:` block, because the index is cleared and rebuilt from those files by design.

**Tech Stack:** TypeScript (ESM, NodeNext), better-sqlite3, gray-matter, vitest, React 18 + Tailwind v4 for the web surface.

**Spec:** `docs/superpowers/specs/2026-09-02-phase-8a-staleness-design.md`

## Global Constraints

- **`unknown` alone never makes a note stale.** Spec §3. A reference the tool could not check must never be reported as one it checked and found changed.
- **Four states, exactly:** `verified`, `changed`, `missing`, `unknown`. Spec §3.
- **`url` evidence is never verified.** It is always `unknown`. Spec §5. This is a decision; do not "fix" it.
- **`hb ingest` and a plain `hb verify` never write to a note file.** Only `--ack` writes. Spec §6, §9.
- **The baseline lives in the note file, never only in the index.** Spec §6.
- **`verified.refs` holds `file` references only.** A commit or session has no prior value worth recording. Spec §6.
- **One unverifiable note must never cost the run.** Missing git, missing repo, permission denied, unreadable file all resolve to `unknown` and never raise. Spec §10.
- **No `notes.stale` column.** Derived from a join. Spec §11.
- **Code, identifiers, comments and CLI flags in English.** Project CLAUDE.md §5.
- Tests import from `vitest` explicitly — this repo does not enable vitest globals.
- Source style: no semicolons, single quotes, 2-space indent. There is no prettier config in this repo; do not run prettier, it will reformat against the house style.

## One correction to the spec

Spec §5 says a `file` ref resolves "relative to the `projects.path` for the note's slug". The `Note` type already carries `project_path` (`core/src/types.ts`), recorded by the write path as the directory the note was written in. That is a better answer than a slug lookup, because it is what the note's own author saw.

**Resolution order for a `file` ref:** `note.project_path` if set → otherwise `projects.path` for `note.project` → otherwise `unknown`.

---

### Task 1: A `verified:` block survives a round trip

Nothing verifies anything yet. This task only teaches the note format the shape, so later tasks have somewhere to write.

Today an unknown frontmatter key lands in `Note.extra` and is preserved, so a hand-written `verified:` block already round-trips. That is not enough: the rest of the plan needs it typed.

**Files:**
- Modify: `core/src/types.ts` (add `VerifiedRef`, `Verified`; add `verified` to `Note`)
- Modify: `core/src/note/parse.ts:29-32` (`KNOWN_KEYS`), and add `parseVerified`
- Modify: `core/src/note/serialize.ts`
- Test: `core/tests/note-parse.test.ts`, `core/tests/note-roundtrip.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```ts
  export interface VerifiedRef { ref: string; hash: string }
  export interface Verified { on: string; refs: VerifiedRef[] }
  // on Note:
  verified: Verified | null
  ```

- [ ] **Step 1: Write the failing tests**

In `core/tests/note-parse.test.ts`:

```ts
it('reads the baseline a previous verification recorded', () => {
  const note = parseNote(
    `---\nid: n1\ntitle: t\nproject: p\nquestion: q?\nchosen: c\n` +
      `evidence:\n  - {kind: file, ref: src/a.ts}\n` +
      `verified:\n  on: 2026-09-02\n  refs:\n    - {ref: src/a.ts, hash: sha256:abc}\n---\n\nbody\n`,
    '/store/n1.md',
  )

  expect(note.verified).toEqual({
    on: '2026-09-02',
    refs: [{ ref: 'src/a.ts', hash: 'sha256:abc' }],
  })
})

it('treats a note that has never been verified as having no baseline', () => {
  const note = parseNote('---\nid: n1\nquestion: q?\nchosen: c\n---\n\nbody\n', '/store/n1.md')
  expect(note.verified).toBe(null)
})

it('drops a baseline entry with no ref rather than carrying a nameless one', () => {
  // Hand-edited frontmatter is expected. A malformed entry must not throw: a
  // person editing their own note must not be able to break reading it.
  const note = parseNote(
    `---\nid: n1\nquestion: q?\nchosen: c\n` +
      `verified:\n  on: 2026-09-02\n  refs:\n    - {hash: sha256:abc}\n    - {ref: src/a.ts, hash: sha256:d}\n---\n\nb\n`,
    '/store/n1.md',
  )

  expect(note.verified!.refs).toEqual([{ ref: 'src/a.ts', hash: 'sha256:d' }])
})

it('keeps the block out of extra, now that it is a field of its own', () => {
  const note = parseNote(
    `---\nid: n1\nquestion: q?\nchosen: c\nverified:\n  on: 2026-09-02\n  refs: []\n---\n\nb\n`,
    '/store/n1.md',
  )
  expect(note.extra.verified).toBeUndefined()
})
```

In `core/tests/note-roundtrip.test.ts`, following that file's existing round-trip style:

```ts
it('round-trips a note carrying a verification baseline', () => {
  const source =
    `---\nid: n1\ntitle: t\nproject: p\nkind: decision\nstatus: standing\n` +
    `question: q?\nchosen: c\nevidence:\n  - kind: file\n    ref: src/a.ts\n` +
    `verified:\n  on: 2026-09-02\n  refs:\n    - ref: src/a.ts\n      hash: sha256:abc\n---\n\nbody\n`
  const note = parseNote(source, '/store/n1.md')

  expect(parseNote(serializeNote(note), '/store/n1.md')).toEqual(note)
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run core/tests/note-parse.test.ts core/tests/note-roundtrip.test.ts`
Expected: FAIL — `note.verified` is `undefined`, and `extra.verified` is set.

- [ ] **Step 3: Add the types**

In `core/src/types.ts`, after `Evidence`:

```ts
/** One `file` reference and the digest it carried when a human last confirmed it. */
export interface VerifiedRef {
  ref: string
  hash: string
}

/**
 * What the tool measured, as opposed to what the note's author declared.
 *
 * Kept out of `evidence` on purpose: that list is a human record, and folding
 * machine bookkeeping into it erodes the thing that makes a note worth reading.
 * The two are matched on `ref`.
 *
 * Only `file` references appear. A commit either resolves or it does not, and a
 * session either is in the index or is not; neither has a prior value worth
 * writing down. `url` references are never verified at all.
 */
export interface Verified {
  /** The calendar date a human last confirmed the note, `YYYY-MM-DD`. */
  on: string
  refs: VerifiedRef[]
}
```

On `Note`, directly after `evidence`:

```ts
  /** Null for a note nobody has confirmed yet — absent, never assumed fresh. */
  verified: Verified | null
```

- [ ] **Step 4: Parse it**

In `core/src/note/parse.ts`, add `'verified'` to `KNOWN_KEYS`, add the parser beside `parseEvidence`:

```ts
function parseVerified(value: unknown): Verified | null {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const refs = Array.isArray(record.refs)
    ? record.refs.flatMap((entry) => {
        if (entry == null || typeof entry !== 'object') return []
        const row = entry as Record<string, unknown>
        const ref = str(row.ref)
        // A nameless baseline matches no evidence row, so it can only mislead.
        if (!ref) return []
        return [{ ref, hash: str(row.hash) }]
      })
    : []
  return { on: dateStr(record.on), refs }
}
```

and in the returned object, after `evidence`:

```ts
    verified: parseVerified(data.verified),
```

Import `type Verified` from `../types.js` alongside the existing type imports.

- [ ] **Step 5: Serialize it**

In `core/src/note/serialize.ts`, after the `evidence` line:

```ts
  if (note.verified) data.verified = note.verified
```

- [ ] **Step 6: Fix every other construction site of `Note`**

Adding a required field breaks every literal that builds a `Note`.

Run: `npx tsc -b`
Expected: errors naming each file. Add `verified: null` to each. Expect `core/src/note/record.ts` and `core/src/jot/promote.ts` among them, plus test fixtures.

- [ ] **Step 7: Run the tests**

Run: `npm test && npm run typecheck`
Expected: PASS, including the five new tests.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(core): a note can carry what was true when someone last looked"
```

---

### Task 2: Verifying one reference

**Files:**
- Create: `core/src/verify/evidence.ts`
- Test: `core/tests/verify-evidence.test.ts`

**Interfaces:**
- Consumes: `Evidence` from `core/src/types.js`.
- Produces:
  ```ts
  export const EVIDENCE_STATES = ['verified', 'changed', 'missing', 'unknown'] as const
  export type EvidenceState = (typeof EVIDENCE_STATES)[number]

  export interface VerifyContext {
    /** The directory a relative `file` ref resolves against. Null when unknown. */
    projectPath: string | null
    /** The digest recorded the last time a human confirmed this ref, if any. */
    baseline: string | undefined
    /** Whether a `session` ref is still in the index. */
    sessionExists: (id: string) => boolean
  }

  export async function verifyEvidence(
    evidence: Evidence,
    context: VerifyContext,
  ): Promise<{ state: EvidenceState; hash?: string }>

  /** sha256 of a file's bytes, prefixed, or undefined when it cannot be read. */
  export async function hashFile(path: string): Promise<string | undefined>
  ```
  `hash` is returned only for a `file` ref that was readable, so Task 5 can write a baseline without hashing twice.

- [ ] **Step 1: Write the failing test**

Create `core/tests/verify-evidence.test.ts`:

```ts
import { execFile } from 'node:child_process'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { beforeEach, describe, expect, it } from 'vitest'
import { verifyEvidence } from '../src/verify/evidence.js'

const run = promisify(execFile)

let dir: string
const never = () => false
const always = () => true

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'hb-verify-'))
})

async function repo(at: string) {
  await run('git', ['init', '-q'], { cwd: at })
  await run('git', ['config', 'user.email', 't@t'], { cwd: at })
  await run('git', ['config', 'user.name', 't'], { cwd: at })
}

describe('file evidence', () => {
  it('is verified when the bytes still hash to the baseline', async () => {
    await writeFile(join(dir, 'a.ts'), 'export const a = 1\n')
    const first = await verifyEvidence(
      { kind: 'file', ref: 'a.ts' },
      { projectPath: dir, baseline: undefined, sessionExists: never },
    )
    // No baseline yet, so the first look can only report that it does not know.
    expect(first.state).toBe('unknown')
    expect(first.hash).toMatch(/^sha256:[0-9a-f]{64}$/)

    const second = await verifyEvidence(
      { kind: 'file', ref: 'a.ts' },
      { projectPath: dir, baseline: first.hash, sessionExists: never },
    )
    expect(second.state).toBe('verified')
  })

  it('is changed when the bytes differ from the baseline', async () => {
    await writeFile(join(dir, 'a.ts'), 'export const a = 1\n')
    const before = await verifyEvidence(
      { kind: 'file', ref: 'a.ts' },
      { projectPath: dir, baseline: undefined, sessionExists: never },
    )
    await writeFile(join(dir, 'a.ts'), 'export const a = 2\n')

    const after = await verifyEvidence(
      { kind: 'file', ref: 'a.ts' },
      { projectPath: dir, baseline: before.hash, sessionExists: never },
    )
    expect(after.state).toBe('changed')
  })

  it('is missing when the file the note cites is gone', async () => {
    const result = await verifyEvidence(
      { kind: 'file', ref: 'gone.ts' },
      { projectPath: dir, baseline: 'sha256:whatever', sessionExists: never },
    )
    expect(result.state).toBe('missing')
  })

  it('is unknown when the project is not on this machine', async () => {
    // The repository being absent says nothing about whether the note is stale.
    const result = await verifyEvidence(
      { kind: 'file', ref: 'a.ts' },
      { projectPath: null, baseline: 'sha256:whatever', sessionExists: never },
    )
    expect(result.state).toBe('unknown')
  })

  it('never resolves a ref outside the project directory', async () => {
    // `ref` comes out of a file a person edits. A traversal would let a note
    // report on, and hash, something the project does not contain.
    const result = await verifyEvidence(
      { kind: 'file', ref: '../../etc/hosts' },
      { projectPath: dir, baseline: undefined, sessionExists: never },
    )
    expect(result.state).toBe('unknown')
  })
})

describe('commit evidence', () => {
  it('is verified when the commit still resolves', async () => {
    await repo(dir)
    await writeFile(join(dir, 'a.ts'), 'x\n')
    await run('git', ['add', '-A'], { cwd: dir })
    await run('git', ['commit', '-qm', 'first'], { cwd: dir })
    const { stdout } = await run('git', ['rev-parse', 'HEAD'], { cwd: dir })

    const result = await verifyEvidence(
      { kind: 'commit', ref: stdout.trim() },
      { projectPath: dir, baseline: undefined, sessionExists: never },
    )
    expect(result.state).toBe('verified')
  })

  it('is missing when the commit does not resolve in a real repository', async () => {
    await repo(dir)
    const result = await verifyEvidence(
      { kind: 'commit', ref: '0'.repeat(40) },
      { projectPath: dir, baseline: undefined, sessionExists: never },
    )
    expect(result.state).toBe('missing')
  })

  it('is unknown when the directory is not a repository at all', async () => {
    // Not the same claim as "that commit is gone".
    const result = await verifyEvidence(
      { kind: 'commit', ref: '0'.repeat(40) },
      { projectPath: dir, baseline: undefined, sessionExists: never },
    )
    expect(result.state).toBe('unknown')
  })
})

describe('session and url evidence', () => {
  it('verifies a session that is still in the index', async () => {
    const result = await verifyEvidence(
      { kind: 'session', ref: 's1' },
      { projectPath: null, baseline: undefined, sessionExists: always },
    )
    expect(result.state).toBe('verified')
  })

  it('reports a session the index no longer holds as missing', async () => {
    const result = await verifyEvidence(
      { kind: 'session', ref: 's1' },
      { projectPath: null, baseline: undefined, sessionExists: never },
    )
    expect(result.state).toBe('missing')
  })

  it('never checks a url, however reachable it looks', async () => {
    // Offline would otherwise mark every note stale at once, which trains the
    // reader to disregard the one signal this feature exists to give.
    const result = await verifyEvidence(
      { kind: 'url', ref: 'https://example.invalid/adr' },
      { projectPath: null, baseline: undefined, sessionExists: always },
    )
    expect(result.state).toBe('unknown')
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run core/tests/verify-evidence.test.ts`
Expected: FAIL — cannot resolve `../src/verify/evidence.js`.

- [ ] **Step 3: Implement**

Create `core/src/verify/evidence.ts`:

```ts
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import { promisify } from 'node:util'
import type { Evidence } from '../types.js'

const run = promisify(execFile)

export const EVIDENCE_STATES = ['verified', 'changed', 'missing', 'unknown'] as const
export type EvidenceState = (typeof EVIDENCE_STATES)[number]

export interface VerifyContext {
  projectPath: string | null
  baseline: string | undefined
  sessionExists: (id: string) => boolean
}

/** sha256 of a file's bytes, or undefined when it cannot be read at all. */
export async function hashFile(path: string): Promise<string | undefined> {
  try {
    return `sha256:${createHash('sha256').update(await readFile(path)).digest('hex')}`
  } catch {
    return undefined
  }
}

/**
 * The absolute path a `file` ref names, or null when it names nothing this
 * project contains.
 *
 * `ref` is read out of a file a person edits by hand, so it can say anything. A
 * ref that climbs out of the project would let a note report on — and hash — a
 * file the project has nothing to do with.
 */
function resolveInside(projectPath: string, ref: string): string | null {
  if (isAbsolute(ref)) return null
  const target = resolve(projectPath, ref)
  const step = relative(projectPath, target)
  return step && !step.startsWith('..') ? target : null
}

export async function verifyEvidence(
  evidence: Evidence,
  context: VerifyContext,
): Promise<{ state: EvidenceState; hash?: string }> {
  if (evidence.kind === 'url') return { state: 'unknown' }

  if (evidence.kind === 'session') {
    return { state: context.sessionExists(evidence.ref) ? 'verified' : 'missing' }
  }

  if (!context.projectPath) return { state: 'unknown' }

  if (evidence.kind === 'commit') {
    // Two failures that look alike and are not: a repository that does not have
    // this commit, and a directory that is not a repository. Only the first is
    // news about the note.
    try {
      await run('git', ['rev-parse', '--git-dir'], { cwd: context.projectPath })
    } catch {
      return { state: 'unknown' }
    }
    try {
      await run('git', ['cat-file', '-e', `${evidence.ref}^{commit}`], {
        cwd: context.projectPath,
      })
      return { state: 'verified' }
    } catch {
      return { state: 'missing' }
    }
  }

  const path = resolveInside(context.projectPath, evidence.ref)
  if (!path) return { state: 'unknown' }

  const hash = await hashFile(path)
  if (hash === undefined) return { state: 'missing' }
  // Readable, but nobody has said what it should look like. Not news either way.
  if (context.baseline === undefined) return { state: 'unknown', hash }
  return { state: hash === context.baseline ? 'verified' : 'changed', hash }
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run core/tests/verify-evidence.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add core/src/verify/evidence.ts core/tests/verify-evidence.test.ts
git commit -m "feat(core): tell a reference that changed from one nobody could check"
```

---

### Task 3: The verdict for a whole note

**Files:**
- Create: `core/src/verify/note.ts`
- Test: `core/tests/verify-note.test.ts`

**Interfaces:**
- Consumes: `verifyEvidence`, `EvidenceState` from Task 2; `Note`, `Evidence` from types.
- Produces:
  ```ts
  export interface RefResult {
    kind: Evidence['kind']
    ref: string
    state: EvidenceState
    hash?: string
  }
  export type StaleReason = 'changed' | 'missing' | 'review-due'
  export interface NoteVerdict {
    noteId: string
    refs: RefResult[]
    stale: boolean
    reasons: StaleReason[]
  }

  export async function verifyNote(
    note: Note,
    deps: {
      projectPath: string | null
      sessionExists: (id: string) => boolean
      /** Today, as `YYYY-MM-DD`, in the caller's declared zone. */
      today: string
    },
  ): Promise<NoteVerdict>
  ```

- [ ] **Step 1: Write the failing test**

Create `core/tests/verify-note.test.ts`:

```ts
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
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run core/tests/verify-note.test.ts`
Expected: FAIL — cannot resolve `../src/verify/note.js`.

- [ ] **Step 3: Implement**

Create `core/src/verify/note.ts`:

```ts
import type { Evidence, Note } from '../types.js'
import { verifyEvidence, type EvidenceState } from './evidence.js'

export interface RefResult {
  kind: Evidence['kind']
  ref: string
  state: EvidenceState
  hash?: string
}

export type StaleReason = 'changed' | 'missing' | 'review-due'

export interface NoteVerdict {
  noteId: string
  refs: RefResult[]
  stale: boolean
  reasons: StaleReason[]
}

export async function verifyNote(
  note: Note,
  deps: {
    projectPath: string | null
    sessionExists: (id: string) => boolean
    today: string
  },
): Promise<NoteVerdict> {
  const baselines = new Map((note.verified?.refs ?? []).map((r) => [r.ref, r.hash]))

  const refs: RefResult[] = []
  for (const evidence of note.evidence) {
    const result = await verifyEvidence(evidence, {
      projectPath: deps.projectPath,
      baseline: baselines.get(evidence.ref),
      sessionExists: deps.sessionExists,
    })
    refs.push({ kind: evidence.kind, ref: evidence.ref, ...result })
  }

  // Ordered and deduplicated, so the interface says the same thing about the
  // same note twice running.
  const reasons: StaleReason[] = []
  if (refs.some((r) => r.state === 'changed')) reasons.push('changed')
  if (refs.some((r) => r.state === 'missing')) reasons.push('missing')
  // Dates are `YYYY-MM-DD`, so a string compare is a date compare.
  if (note.review_after && note.review_after < deps.today) reasons.push('review-due')

  return { noteId: note.id, refs, stale: reasons.length > 0, reasons }
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run core/tests/verify-note.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add core/src/verify/note.ts core/tests/verify-note.test.ts
git commit -m "feat(core): a note is stale for a reason it can name"
```

---

### Task 4: The index records what was found

**Files:**
- Modify: `core/src/db/schema.sql` (the `note_evidence` table)
- Modify: `core/src/db/open.ts:7` (`SCHEMA_VERSION` 3 → 4)
- Modify: `core/src/rebuild.ts:58-59` (snapshot column list)
- Modify: `core/src/db/write.ts` (add `recordVerification`)
- Modify: `core/src/db/query.ts` (add `staleNoteIds`; extend `listRegions` and `RegionRow`)
- Modify: `core/src/index.ts` (export the verify module)
- Test: `core/tests/db-verify.test.ts`, `core/tests/db-query.test.ts`

**Interfaces:**
- Consumes: `NoteVerdict` from Task 3.
- Produces:
  ```ts
  // core/src/db/write.ts
  export function recordVerification(
    db: Database.Database,
    verdict: NoteVerdict,
    at: string,
  ): void
  // core/src/db/query.ts
  export function staleNoteIds(db: Database.Database): Set<string>
  // RegionRow gains:
  stale: number
  ```

- [ ] **Step 1: Write the failing test**

Create `core/tests/db-verify.test.ts`:

```ts
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { staleNoteIds } from '../src/db/query.js'
import { openDb } from '../src/db/open.js'
import { indexNote, recordVerification } from '../src/db/write.js'
import { parseNote } from '../src/note/parse.js'

let db: ReturnType<typeof openDb>

const note = (id: string, ref: string) =>
  parseNote(
    `---\nid: ${id}\ntitle: ${id}\nproject: proj-a\nquestion: q?\nchosen: c\n` +
      `evidence:\n  - {kind: file, ref: ${ref}}\n---\n\nb\n`,
    `/store/${id}.md`,
  )

const at = '2026-09-02T10:00:00.000Z'
const verdict = (noteId: string, ref: string, state: string) => ({
  noteId,
  stale: state === 'changed' || state === 'missing',
  reasons: [] as never[],
  refs: [{ kind: 'file' as const, ref, state: state as never }],
})

beforeEach(async () => {
  const home = await mkdtemp(join(tmpdir(), 'hb-dbv-'))
  db = openDb({ HOUNTYBUNTER_HOME: home } as NodeJS.ProcessEnv)
})

describe('recordVerification', () => {
  it('stores a state and a time against each reference', () => {
    indexNote(db, note('n1', 'a.ts'))
    recordVerification(db, verdict('n1', 'a.ts', 'changed'), at)

    const row = db
      .prepare('SELECT state, last_verified_at FROM note_evidence WHERE note_id = ?')
      .get('n1')
    expect(row).toEqual({ state: 'changed', last_verified_at: at })
  })

  it('starts every reference at unknown, before anything has looked', () => {
    // Indexing a note is not checking it. A default that read as a pass would
    // report a store nobody has looked at as a clean one.
    indexNote(db, note('n1', 'a.ts'))
    expect(db.prepare('SELECT state FROM note_evidence').get()).toEqual({ state: 'unknown' })
  })

  it('forgets an old verdict when the note is re-indexed', () => {
    // A state left behind would outlive the reading that produced it.
    indexNote(db, note('n1', 'a.ts'))
    recordVerification(db, verdict('n1', 'a.ts', 'changed'), at)
    indexNote(db, note('n1', 'a.ts'))

    expect(db.prepare('SELECT state FROM note_evidence').get()).toEqual({ state: 'unknown' })
  })
})

describe('staleNoteIds', () => {
  it('names the notes with a reference that changed or went missing', () => {
    indexNote(db, note('n1', 'a.ts'))
    indexNote(db, note('n2', 'b.ts'))
    indexNote(db, note('n3', 'c.ts'))
    recordVerification(db, verdict('n1', 'a.ts', 'changed'), at)
    recordVerification(db, verdict('n2', 'b.ts', 'missing'), at)
    recordVerification(db, verdict('n3', 'c.ts', 'verified'), at)

    expect(staleNoteIds(db)).toEqual(new Set(['n1', 'n2']))
  })

  it('leaves out a note whose references merely could not be checked', () => {
    indexNote(db, note('n1', 'a.ts'))
    recordVerification(db, verdict('n1', 'a.ts', 'unknown'), at)

    expect(staleNoteIds(db)).toEqual(new Set())
  })
})
```

In `core/tests/db-query.test.ts`, inside `describe('listRegions', ...)`:

```ts
  it('counts the stale notes in each region, so fog can thicken with the ratio', () => {
    // n1 belongs to proj-a in this file's fixture. Give it a row to move.
    db.prepare(
      `INSERT OR IGNORE INTO note_evidence (note_id, kind, ref) VALUES ('n1', 'file', 'a.ts')`,
    ).run()
    db.prepare(`UPDATE note_evidence SET state = 'missing' WHERE note_id = 'n1'`).run()

    const byProject = Object.fromEntries(listRegions(db).map((r) => [r.project, r.stale]))
    expect(byProject['proj-a']).toBe(1)
    expect(byProject['proj-b']).toBe(0)
  })
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run core/tests/db-verify.test.ts`
Expected: FAIL — `recordVerification` is not exported.

- [ ] **Step 3: Change the schema**

In `core/src/db/schema.sql`, replace the `ok` column:

```sql
CREATE TABLE IF NOT EXISTS note_evidence (
  note_id           TEXT NOT NULL,
  kind              TEXT NOT NULL,
  ref               TEXT NOT NULL,
  last_verified_at  TEXT,
  -- verified | changed | missing | unknown. Defaults to unknown because
  -- indexing a note is not checking it, and a default that read as a pass
  -- would report a store nobody has looked at as a clean one.
  state             TEXT NOT NULL DEFAULT 'unknown',
  PRIMARY KEY (note_id, kind, ref)
);
```

In `core/src/db/open.ts:7`: `export const SCHEMA_VERSION = 4`.

In `core/src/rebuild.ts:59`, change the column list to
`['note_id', 'kind', 'ref', 'last_verified_at', 'state']`.

- [ ] **Step 4: Write the recorder and the query**

In `core/src/db/write.ts` (importing `type NoteVerdict` from `../verify/note.js`):

```ts
/**
 * Store what a verification found.
 *
 * Evidence rows are owned by `indexNote`, which deletes and re-inserts them, so
 * a verdict written here lives exactly as long as the reading that produced it:
 * re-indexing a note drops it back to `unknown`, which is the honest answer
 * until something looks again.
 */
export function recordVerification(
  db: Database.Database,
  verdict: NoteVerdict,
  at: string,
): void {
  const update = db.prepare(
    `UPDATE note_evidence SET state = ?, last_verified_at = ?
     WHERE note_id = ? AND kind = ? AND ref = ?`,
  )
  const all = db.transaction(() => {
    for (const ref of verdict.refs) update.run(ref.state, at, verdict.noteId, ref.kind, ref.ref)
  })
  all()
}
```

In `core/src/db/query.ts`:

```ts
/**
 * The notes with a reference that was checked and found wanting.
 *
 * `unknown` is excluded on purpose: a reference nobody could check is not
 * evidence of anything. Review dates are not consulted here — they are a
 * property of the note, resolved against a clock the caller owns.
 */
export function staleNoteIds(db: Database.Database): Set<string> {
  const rows = db
    .prepare(`SELECT DISTINCT note_id FROM note_evidence WHERE state IN ('changed', 'missing')`)
    .all() as { note_id: string }[]
  return new Set(rows.map((r) => r.note_id))
}
```

In `listRegions`, add the subquery beside the existing two, and `stale: number` to `RegionRow`:

```sql
              (SELECT COUNT(DISTINCT e.note_id)
                 FROM note_evidence e JOIN notes n2 ON n2.id = e.note_id
                WHERE n2.project = p.project AND e.state IN ('changed', 'missing')) AS stale,
```

- [ ] **Step 5: Export the verify module**

In `core/src/index.ts`, after the `note/*` exports:

```ts
export * from './verify/evidence.js'
export * from './verify/note.js'
```

- [ ] **Step 6: Run the tests**

Run: `npm test && npm run typecheck`
Expected: PASS. The existing `listRegions` equality assertion in `core/tests/db-query.test.ts` will fail on the new `stale` key — add `stale: 0` to each expected row. That is the "a column cannot be left out of the snapshot by forgetting" guard doing its job; do not weaken it to `toMatchObject`.

- [ ] **Step 7: Rebuild your own index, then commit**

The version bump makes an existing `~/.hountybunter/index.db` throw `SchemaVersionError` until it is rebuilt. That is designed behaviour, but do it now or Task 6's manual check will look broken for the wrong reason.

```bash
npm run hb -- rebuild
git add -A
git commit -m "feat(core): the index remembers what a verification found"
```

---

### Task 5: Saying "still true"

**Files:**
- Create: `core/src/verify/acknowledge.ts`
- Modify: `core/src/index.ts`
- Test: `core/tests/verify-acknowledge.test.ts`

**Interfaces:**
- Consumes: `verifyNote` (Task 3), `writeNote` from `core/src/note/store.js`, `VerifiedRef` from types.
- Produces:
  ```ts
  export async function acknowledgeNote(
    note: Note,
    deps: {
      projectPath: string | null
      sessionExists: (id: string) => boolean
      today: string
    },
    env?: NodeJS.ProcessEnv,
  ): Promise<Note>
  ```
  Returns the note as written, carrying its new `verified` block.

- [ ] **Step 1: Write the failing test**

Create `core/tests/verify-acknowledge.test.ts`:

```ts
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { parseNote } from '../src/note/parse.js'
import { serializeNote } from '../src/note/serialize.js'
import { writeNote } from '../src/note/store.js'
import { rebuildFromDisk } from '../src/rebuild.js'
import { acknowledgeNote } from '../src/verify/acknowledge.js'
import { verifyNote } from '../src/verify/note.js'

let home: string
let project: string
let env: NodeJS.ProcessEnv
const never = () => false

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'hb-ack-home-'))
  project = await mkdtemp(join(tmpdir(), 'hb-ack-proj-'))
  env = { HOUNTYBUNTER_HOME: home } as NodeJS.ProcessEnv
})

function note() {
  return parseNote(
    `---\nid: n1\ntitle: t\nproject: proj-a\nkind: decision\nstatus: standing\n` +
      `question: q?\nchosen: c\n` +
      `evidence:\n  - {kind: file, ref: a.ts}\n  - {kind: url, ref: https://e.invalid}\n---\n\nbody\n`,
    join(home, 'notes', 'proj-a', 'n1.md'),
  )
}

const deps = () => ({ projectPath: project, sessionExists: never, today: '2026-09-02' })

describe('acknowledgeNote', () => {
  it('records a baseline for the file it can hash, and only for that', async () => {
    // A commit or a session has no prior value worth writing down, and a url is
    // never checked at all.
    await writeFile(join(project, 'a.ts'), 'x\n')
    const acked = await acknowledgeNote(note(), deps(), env)

    expect(acked.verified!.on).toBe('2026-09-02')
    expect(acked.verified!.refs.map((r) => r.ref)).toEqual(['a.ts'])
    expect(acked.verified!.refs[0]!.hash).toMatch(/^sha256:[0-9a-f]{64}$/)
  })

  it('clears the staleness it was answering', async () => {
    await writeFile(join(project, 'a.ts'), 'x\n')
    const acked = await acknowledgeNote(note(), deps(), env)
    const after = await verifyNote(acked, deps())

    expect(after.stale).toBe(false)
    expect(after.refs.find((r) => r.ref === 'a.ts')!.state).toBe('verified')
  })

  it('writes a file that reads back as the same note', async () => {
    await writeFile(join(project, 'a.ts'), 'x\n')
    const acked = await acknowledgeNote(note(), deps(), env)

    const onDisk = await readFile(join(home, 'notes', 'proj-a', 'n1.md'), 'utf8')
    expect(onDisk).toBe(serializeNote(acked))
    expect(parseNote(onDisk, acked.sourcePath)).toEqual(acked)
  })

  it('leaves a baseline that survives the index being thrown away', async () => {
    // The point of putting it in the file: rebuildFromDisk clears the tables.
    await writeFile(join(project, 'a.ts'), 'x\n')
    await writeNote(note(), env)
    const acked = await acknowledgeNote(note(), deps(), env)

    const report = await rebuildFromDisk(env)
    expect(report.errors).toEqual([])
    const reread = parseNote(
      await readFile(join(home, 'notes', 'proj-a', 'n1.md'), 'utf8'),
      acked.sourcePath,
    )
    expect(reread.verified).toEqual(acked.verified)
  })

  it('records nothing for a file it could not read, rather than a hash of nothing', async () => {
    const acked = await acknowledgeNote(note(), deps(), env)
    expect(acked.verified!.refs).toEqual([])
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run core/tests/verify-acknowledge.test.ts`
Expected: FAIL — cannot resolve `../src/verify/acknowledge.js`.

- [ ] **Step 3: Implement**

Create `core/src/verify/acknowledge.ts`:

```ts
import { writeNote } from '../note/store.js'
import type { Note, VerifiedRef } from '../types.js'
import { verifyNote } from './note.js'

/**
 * Re-baseline a note against what is on disk right now, and write it.
 *
 * The only path that writes a `verified` block. `hb ingest` and a plain
 * `hb verify` deliberately do not: `verified.on` claims a human looked, and a
 * command nobody pointed at a note is not entitled to claim that.
 */
export async function acknowledgeNote(
  note: Note,
  deps: {
    projectPath: string | null
    sessionExists: (id: string) => boolean
    today: string
  },
  env: NodeJS.ProcessEnv = process.env,
): Promise<Note> {
  const verdict = await verifyNote(note, deps)

  // Only what was actually read. A ref with no hash is a file that could not be
  // opened, a commit, a session, or a url — none has a prior value, and
  // inventing one would make the next run compare against a fiction.
  const refs: VerifiedRef[] = verdict.refs.flatMap((r) =>
    r.hash ? [{ ref: r.ref, hash: r.hash }] : [],
  )

  const acked: Note = { ...note, verified: { on: deps.today, refs } }
  await writeNote(acked, env)
  return acked
}
```

Add to `core/src/index.ts`: `export * from './verify/acknowledge.js'`.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run core/tests/verify-acknowledge.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(core): a human can say a note still holds, and be believed once"
```

---

### Task 6: `hb verify`

**Files:**
- Modify: `surfaces/cli/src/bin.ts` (`USAGE`, the `case`, `cmdVerify`, `verifyAll`, `projectPathResolver`, the tail of `cmdIngest`)
- Test: `surfaces/cli/tests/verify.test.ts`

**Interfaces:**
- Consumes: `verifyNote`, `acknowledgeNote`, `recordVerification`, `indexNote`, `readAllNotes`, `openDb`, `resolveTimeZone`, `calendarDate`, `nowIso`, `type Note` — all from `@hountybunter/core`.
- Produces: nothing later tasks depend on.

A note's project path and session predicate are resolved in `bin.ts`. Task 7 needs the same two lines in the web route. **Duplicate them there deliberately** — the CLI and the server do not import each other today, and adding that edge to share a five-line helper is the worse trade.

- [ ] **Step 1: Write the failing test**

Create `surfaces/cli/tests/verify.test.ts`. Match the `Io` capture shape the other CLI tests in `surfaces/cli/tests/` already use; read one of them first.

```ts
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { openDb, parseNote, writeNote } from '@hountybunter/core'
import { main } from '../src/bin.js'

let home: string
let project: string
let out: string[]
let err: string[]
let io: { out(l: string): void; err(l: string): void; env: NodeJS.ProcessEnv; cwd: string }

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'hb-cli-verify-'))
  project = await mkdtemp(join(tmpdir(), 'hb-cli-proj-'))
  out = []
  err = []
  io = {
    out: (l) => out.push(l),
    err: (l) => err.push(l),
    env: { HOUNTYBUNTER_HOME: home, HOUNTYBUNTER_TZ: 'UTC' } as NodeJS.ProcessEnv,
    cwd: project,
  }

  await writeFile(join(project, 'a.ts'), 'x\n')
  const note = parseNote(
    `---\nid: n1\ntitle: t\nproject: proj-a\nkind: decision\nstatus: standing\n` +
      `question: q?\nchosen: c\nevidence:\n  - {kind: file, ref: a.ts}\n---\n\nbody\n`,
    join(home, 'notes', 'proj-a', 'n1.md'),
  )
  await writeNote({ ...note, project_path: project }, io.env)
  openDb(io.env).close()
})

const notePath = () => join(home, 'notes', 'proj-a', 'n1.md')

describe('hb verify', () => {
  it('says how many notes have no baseline, and names the command that sets one', async () => {
    // Day one is every note. It has to be a prompt, not a wall of false alarms.
    expect(await main(['verify'], io)).toBe(0)
    expect(out.join('\n')).toMatch(/no baseline/i)
    expect(out.join('\n')).toContain('hb verify --ack --all')
  })

  it('does not touch a single note file', async () => {
    const before = await readFile(notePath(), 'utf8')
    await main(['verify'], io)

    expect(await readFile(notePath(), 'utf8')).toBe(before)
  })

  it('sets a baseline for every note when asked to', async () => {
    expect(await main(['verify', '--ack', '--all'], io)).toBe(0)
    const after = await readFile(notePath(), 'utf8')

    expect(after).toContain('verified:')
    expect(after).toMatch(/hash: sha256:[0-9a-f]{64}/)
  })

  it('reports a file that changed after it was confirmed', async () => {
    await main(['verify', '--ack', '--all'], io)
    await writeFile(join(project, 'a.ts'), 'y\n')
    out.length = 0

    expect(await main(['verify'], io)).toBe(0)
    expect(out.join('\n')).toMatch(/n1/)
    expect(out.join('\n')).toMatch(/changed/)
  })

  it('goes quiet again once the change is acknowledged', async () => {
    await main(['verify', '--ack', '--all'], io)
    await writeFile(join(project, 'a.ts'), 'y\n')
    await main(['verify', '--ack', 'n1'], io)
    out.length = 0

    await main(['verify'], io)
    expect(out.join('\n')).not.toMatch(/changed/)
  })

  it('names a note id it does not have rather than acknowledging nothing', async () => {
    expect(await main(['verify', '--ack', 'nope'], io)).toBe(1)
    expect(err.join('\n')).toContain('nope')
  })

  it('refuses --ack with no target rather than confirming the whole store', async () => {
    expect(await main(['verify', '--ack'], io)).toBe(1)
    expect(err.join('\n')).toMatch(/--all/)
  })
})

describe('hb ingest', () => {
  it('verifies at the end without writing a baseline', async () => {
    const before = await readFile(notePath(), 'utf8')
    await main(['ingest'], io)

    expect(await readFile(notePath(), 'utf8')).toBe(before)
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run surfaces/cli/tests/verify.test.ts`
Expected: FAIL — `hb verify` falls to the `default:` branch and returns 1.

- [ ] **Step 3: Implement**

In `surfaces/cli/src/bin.ts`, add `case 'verify': return await cmdVerify(rest, io)` beside the other cases, a `verify` line in `USAGE` matching the surrounding format, and:

```ts
/**
 * Where a note's project lives. The note's own `project_path` is what its
 * author saw; the `projects` row is a fallback for notes written before that
 * field existed.
 */
function projectPathResolver(db: ReturnType<typeof openDb>): (note: Note) => string | null {
  const bySlug = db.prepare('SELECT path FROM projects WHERE slug = ?')
  return (note) => {
    if (note.project_path) return note.project_path
    return (bySlug.get(note.project) as { path: string } | undefined)?.path ?? null
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
  const projectPath = projectPathResolver(db)
  const hasSession = db.prepare('SELECT 1 FROM sessions WHERE id = ?')
  const sessionExists = (id: string) => hasSession.get(id) !== undefined
  const today = calendarDate(nowIso(), resolveTimeZone(io.env))
  const at = nowIso()

  let stale = 0
  let unbaselined = 0
  for (const note of notes) {
    const verdict = await verifyNote(note, { projectPath: projectPath(note), sessionExists, today })
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
  const named = args.find((a) => !a.startsWith('-'))

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
      const projectPath = projectPathResolver(db)
      const hasSession = db.prepare('SELECT 1 FROM sessions WHERE id = ?')
      const today = calendarDate(nowIso(), resolveTimeZone(io.env))
      for (const note of targets) {
        const acked = await acknowledgeNote(
          note,
          {
            projectPath: projectPath(note),
            sessionExists: (id: string) => hasSession.get(id) !== undefined,
            today,
          },
          io.env,
        )
        indexNote(db, acked)
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
```

Add to the existing `@hountybunter/core` import list in `bin.ts`: `acknowledgeNote`, `calendarDate`, `indexNote`, `nowIso`, `readAllNotes`, `recordVerification`, `resolveTimeZone`, `verifyNote`, `type Note`.

- [ ] **Step 4: Fold verification into `cmdIngest`**

At the end of `cmdIngest`, before its `return`:

```ts
    // The command people already run. Verification that needs its own command
    // to be remembered is verification that does not happen.
    const { notes } = await readAllNotes(io.env)
    const checked = await verifyAll(notes, db, io)
    if (checked.stale > 0) io.out(`${checked.stale} notes look stale — run \`hb verify\``)
```

- [ ] **Step 5: Run the tests**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(cli): hb verify, and an ingest that notices"
```

---

### Task 7: The API carries the state

**Files:**
- Modify: `surfaces/web/src/server/routes.ts`
- Test: `surfaces/web/tests/routes.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 3–5, plus `staleNoteIds` from Task 4.
- Produces:
  - `GET /api/notes` — each hit gains `stale: boolean`
  - `GET /api/notes/:id` — the note's `evidence` entries gain `state`, and the note gains `stale`
  - `POST /api/notes/:id/verified` — acknowledges; 200 with `{ note }`, 404 for an unknown id
  - `GET /api/regions` — each region gains `stale: number` (delivered by Task 4)

Before writing this, check the exact name and signature of the single-note reader already used by `GET /api/notes/:id` — it is `getNote` in the `routes.ts` import list, defined under `core/src/note/`. Reuse it; do not add a second reader.

- [ ] **Step 1: Write the failing test**

In `surfaces/web/tests/routes.test.ts`, first give the `beforeEach` fixture note some evidence to move — change its frontmatter to include:

```
evidence:\n  - {kind: file, ref: a.ts}\n
```

Then add:

```ts
describe('staleness over the API', () => {
  it('marks a note in the list whose evidence was found changed', async () => {
    const db = openDb(env)
    try {
      db.prepare(`UPDATE note_evidence SET state = 'changed'`).run()
    } finally {
      db.close()
    }

    const res = await handle('GET', '/api/notes', null, env)
    expect(res.body.notes[0].stale).toBe(true)
  })

  it('gives each reference its own state, not one verdict for all of them', async () => {
    // One verdict for the whole note would hide which reference moved.
    const res = await handle('GET', '/api/notes/n1', null, env)
    expect(res.body.note.evidence[0]).toMatchObject({ ref: 'a.ts', state: 'unknown' })
  })

  it('acknowledges a note and writes the baseline to its file', async () => {
    const res = await handle('POST', '/api/notes/n1/verified', {}, env)

    expect(res.status).toBe(200)
    expect(res.body.note.verified.on).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('404s an acknowledgement for a note that is not in the store', async () => {
    expect((await handle('POST', '/api/notes/nope/verified', {}, env)).status).toBe(404)
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run surfaces/web/tests/routes.test.ts`
Expected: FAIL — `stale` is undefined and the POST route 404s for `n1` too.

- [ ] **Step 3: Implement**

In the `/api/notes` list branch, after fetching:

```ts
      const stale = staleNoteIds(db)
      const rows = listNotes(db, { limit, offset }).map((n) => ({ ...n, stale: stale.has(n.id) }))
```

Do the same in the search branch.

In the note detail branch, attach the stored state to each entry:

```ts
      const states = new Map(
        (
          db
            .prepare('SELECT kind, ref, state FROM note_evidence WHERE note_id = ?')
            .all(id) as { kind: string; ref: string; state: string }[]
        ).map((r) => [`${r.kind}:${r.ref}`, r.state]),
      )
      const evidence = note.evidence.map((e) => ({
        ...e,
        state: states.get(`${e.kind}:${e.ref}`) ?? 'unknown',
      }))
      return {
        status: 200,
        body: { note: { ...note, evidence, stale: staleNoteIds(db).has(id) } },
      }
```

Add the route beside `POST /api/notes`, before the `method !== 'GET'` guard:

```ts
  const ack = path.match(/^\/api\/notes\/(.+)\/verified$/)
  if (method === 'POST' && ack) return await acknowledge(decodeURIComponent(ack[1]!), env)
```

and the handler:

```ts
/** The web half of `hb verify --ack`: same core call, same file written. */
async function acknowledge(id: string, env: NodeJS.ProcessEnv): Promise<Response> {
  const db = openDb(env)
  try {
    const note = await getNote(db, id)
    if (!note) return { status: 404, body: { error: `no note ${id}` } }

    const hasSession = db.prepare('SELECT 1 FROM sessions WHERE id = ?')
    const bySlug = db.prepare('SELECT path FROM projects WHERE slug = ?')
    const projectPath =
      note.project_path ?? (bySlug.get(note.project) as { path: string } | undefined)?.path ?? null

    const acked = await acknowledgeNote(
      note,
      {
        projectPath,
        sessionExists: (sid: string) => hasSession.get(sid) !== undefined,
        today: calendarDate(nowIso(), resolveTimeZone(env)),
      },
      env,
    )
    indexNote(db, acked)
    return { status: 200, body: { note: acked } }
  } finally {
    db.close()
  }
}
```

Add `acknowledgeNote`, `calendarDate`, `nowIso`, `resolveTimeZone` and `staleNoteIds` to the `@hountybunter/core` import list in `routes.ts`.

- [ ] **Step 4: Run the tests**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(web): the API says which notes stopped matching the code"
```

---

### Task 8: Saying it on screen

**Files:**
- Modify: `surfaces/web/src/client/api.ts`
- Modify: `surfaces/web/src/client/views/Notes.tsx`
- Modify: `surfaces/web/src/client/views/Regions.tsx`
- Test: `surfaces/web/tests/client/Notes.test.tsx`

**Interfaces:**
- Consumes: the API shapes from Task 7.
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Write the failing test**

In `surfaces/web/tests/client/Notes.test.tsx`, inside `describe('Notes', ...)`:

```ts
  it('marks a note whose evidence no longer matches', async () => {
    stub(() => ({ notes: [{ ...LIST.notes[0], stale: true }], total: 1 }))
    await act(async () => { render(<Notes />) })

    expect(screen.getByText(/stale/i)).toBeTruthy()
  })

  it('says what each piece of evidence was found to be', async () => {
    // One verdict for the whole note would hide which reference moved.
    stub((url) =>
      url.includes('/api/notes/')
        ? {
            note: {
              ...DETAIL.note,
              stale: true,
              evidence: [
                { kind: 'file', ref: 'src/a.ts', state: 'changed' },
                { kind: 'url', ref: 'https://e.invalid', state: 'unknown' },
              ],
            },
          }
        : LIST,
    )
    await act(async () => { render(<Notes />) })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Which basemap/ }))
    })

    expect(screen.getByText(/changed since you confirmed it/i)).toBeTruthy()
    expect(screen.getByText(/not checked/i)).toBeTruthy()
  })

  it('can say a stale note still holds', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn((url: string, init?: { method?: string }) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`)
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve(
            String(url).includes('/api/notes/')
              ? {
                  note: {
                    ...DETAIL.note,
                    stale: true,
                    evidence: [{ kind: 'file', ref: 'src/a.ts', state: 'changed' }],
                  },
                }
              : LIST,
          ),
      })
    }))
    await act(async () => { render(<Notes />) })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Which basemap/ }))
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /still true/i }))
    })

    expect(calls.some((c) => c.startsWith('POST') && c.endsWith('/verified'))).toBe(true)
  })
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run surfaces/web/tests/client/Notes.test.tsx`
Expected: FAIL — no badge, no state text, no button.

- [ ] **Step 3: Extend the client API**

In `surfaces/web/src/client/api.ts`: add `stale: boolean` to `NoteHit`; add `stale: number` to `RegionRow`; on `Note`, replace the `evidence` field with

```ts
  stale: boolean
  evidence: {
    kind: string
    ref: string
    state: 'verified' | 'changed' | 'missing' | 'unknown'
  }[]
```

and add the call:

```ts
  /** Records that a human looked and the note still holds. Rewrites its file. */
  acknowledgeNote: (id: string) =>
    post<{ note: Note }>(`/api/notes/${encodeURIComponent(id)}/verified`, {}),
```

- [ ] **Step 4: Show it**

In `Notes.tsx`, in the list row beside the status:

```tsx
              {hit.stale ? <span className={BADGE}>stale</span> : null}
```

Above `Detail`, one map so the four states cannot drift apart in wording:

```tsx
/** What each state means, said to a reader rather than to a database. */
const EVIDENCE_SAYS: Record<string, string> = {
  verified: 'unchanged since you confirmed it',
  changed: 'changed since you confirmed it',
  missing: 'no longer there',
  unknown: 'not checked',
}
```

Replace the evidence list in `Detail`, and add the button:

```tsx
      <ul className={`m-0 mt-3 list-none p-0 text-[13px] ${MUTED}`}>
        {note.evidence.map((item) => (
          <li key={`${item.kind}:${item.ref}`} className="flex items-baseline gap-2 py-0.5">
            <span className="truncate">
              {item.kind}:{item.ref}
            </span>
            <span className={item.state === 'verified' ? MUTED : 'text-warn'}>
              {EVIDENCE_SAYS[item.state]}
            </span>
          </li>
        ))}
      </ul>

      {note.stale ? (
        <button type="button" className={`${BACK} mt-3`} onClick={() => onStillTrue(note.id)}>
          Still true
        </button>
      ) : null}
```

`Detail` takes a new prop `onStillTrue: (id: string) => void`; `Notes` passes
`(id) => { void api.acknowledgeNote(id).then((d) => setOpen(d.note)) }`.

In `Regions.tsx`, under the existing tally:

```tsx
          {region.stale > 0 ? (
            <span className="text-[13px] text-warn">{region.stale} stale</span>
          ) : null}
```

- [ ] **Step 5: Run the tests and build**

Run: `npm test && npm run typecheck && npm run build:web`
Expected: PASS, and a clean build.

- [ ] **Step 6: Verify against the real store, by hand**

```bash
npm run hb -- verify
npm run hb -- verify --ack --all
npm run hb -- verify
```

Expected: the first run reports notes with no baseline; the second confirms them; the third reports 0 stale. Then edit a file cited by a note and run `hb verify` again — it should name that note and say `changed`.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(web): a note says which of its evidence stopped matching"
```

---

## Self-review notes

**Spec coverage.** §3 four states → Task 2. §4 verdict → Task 3. §5 per-kind rules and the `url` decision → Task 2. §6 baseline shape and location → Tasks 1 and 5; the no-baseline rule → Tasks 2, 3, 6. §7 acknowledge → Tasks 5, 6, 7. §8 module layout → Tasks 2, 3, 5. §9 CLI → Task 6; web → Tasks 7 and 8. §10 error handling → Task 2, where every failure resolves to a state and none raises. §11 schema → Task 4. §12 testing → distributed; the rebuild-survival test is Task 5, Step 1.

**Deliberate gap.** Spec §9 asks for a badge and a region count, not a filter that shows only stale notes. Not built. With six notes it would be furniture, and it is a short addition once there are two hundred.

**Watch during execution.** Task 4 bumps `SCHEMA_VERSION`, so an existing `~/.hountybunter/index.db` throws `SchemaVersionError` until `hb rebuild` runs. Task 4 Step 7 does it. Do not skip it, or Task 6 will look broken for the wrong reason.

**One thing this cannot prove.** The six notes in the real store cite sessions and urls, not files, so `hb verify` will honestly report almost nothing on day one. That is the feature working, not failing. Its value grows as notes start citing files.
