# hountybunter Phases 1–3: Core, Transcript Ingest, CLI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A usable command-line knowledge tool: capture a one-line jot in
seconds, promote it to a full decision record, search everything, and rebuild
the entire database from disk without loss.

**Architecture:** An npm-workspaces monorepo. `core` owns the domain, the
markdown note format, and a SQLite index treated as a disposable cache.
`adapters/claude-code` reads Claude Code transcript JSONL defensively.
`surfaces/cli` is a thin dispatcher over `core`. Authored data lives in markdown
files; everything derivable lives in SQLite and can be deleted and rebuilt.

**Tech Stack:** TypeScript 5, Node 22 (`v22.14.0` confirmed on this machine),
npm workspaces, `better-sqlite3` (FTS5 compiled in), `gray-matter`,
`node:util` `parseArgs` (zero-dependency CLI parsing), Vitest.

**Spec:** `docs/superpowers/specs/2026-08-27-hountybunter-design.md`

## Global Constraints

- **Node >= 20.** CI targets Node 22. `engines.node` is `">=20"`.
- **`better-sqlite3`, never `node:sqlite`.** Node's built-in module does not
  compile FTS5, and FTS5 is the search strategy. (Spec §4)
- **SQLite is derived and disposable.** Anything the user authored is a file;
  anything derivable lives in SQLite. No exceptions. (Spec §4)
- **The tool never modifies source code and never commits.** It writes note and
  jot files, to its own store by default. (Spec §2, §10)
- **Note store default:** `~/.hountybunter/notes/<project-slug>/*.md`. Writing
  into a repository is opt-in per project and never inferred. (Spec §6.2)
- **Required note fields are only `question` and `chosen`.** (Spec §6.0)
- **Defensive parsing is mandatory for transcripts.** Unknown record types keep
  their raw payload and are never dropped; a malformed line is skipped and
  counted, never fatal. (Spec §3.5, §7.1)
- **All stored instants are ISO 8601 UTC with a `Z` suffix.** Any calendar date
  used for grouping is computed in an explicit timezone, never an implicit local
  one. Tests run under multiple `TZ` values. (Spec §11)
- **No network calls anywhere in phases 1–3.**
- **Out of scope:** hooks, HTTP server, PTY, web UI, pixels, bounties,
  staleness verification, Agent SDK. Those are phases 4–10.

---

## File Structure

```
package.json                      workspaces root, shared scripts
tsconfig.base.json                shared compiler options
vitest.config.ts
.gitignore
.nvmrc                            22

core/
  package.json
  tsconfig.json
  src/
    types.ts                      domain types; no logic
    paths.ts                      store locations, project slug
    time.ts                       UTC instants, explicit-timezone dates
    note/
      parse.ts                    markdown+frontmatter -> Note, tolerant
      serialize.ts                Note -> markdown, preserving unknown keys
      store.ts                    read/write note files
    jot/
      store.ts                    append-only one-line capture
      promote.ts                  jot -> note
    db/
      schema.sql                  DDL, including FTS5
      open.ts                     open, WAL, apply schema
      index.ts                    write notes into the index
      query.ts                    search and list
    rebuild.ts                    full rebuild from disk
  tests/

adapters/claude-code/
  package.json
  tsconfig.json
  src/
    locate.ts                     find transcript files
    parse-line.ts                 one JSONL line -> record, tolerant
    cursor.ts                     byte-offset incremental reads
    ingest.ts                     records -> sessions and activities
  tests/fixtures/

surfaces/cli/
  package.json
  tsconfig.json
  src/
    bin.ts                        runCli, testable in-process
    cli.ts                        the executable shim
  tests/
```

**Why these boundaries.** `parse` and `serialize` are separate files because
round-trip losslessness is a property *between* them, and is easier to test when
neither can quietly compensate for the other. `db/index.ts` and `db/query.ts`
split write from read so a query change cannot alter what gets stored.
`adapters/claude-code` is a workspace rather than a directory because the spec
requires it to be replaceable without touching `core`.

**Definition of "lossless round-trip"** (Task 5): semantic, not byte-identical.
All known fields, all unknown frontmatter keys, and the body are preserved. YAML
key order and quoting style are not.

---

## Task 1: Repository scaffold

**Files:**
- Create: `package.json`, `tsconfig.base.json`, `vitest.config.ts`, `.gitignore`, `.nvmrc`
- Create: `core/package.json`, `core/tsconfig.json`, `core/src/types.ts`, `core/src/index.ts`
- Test: `core/tests/smoke.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: a working `npm test`; the `@hountybunter/core` workspace name that
  every later task imports from

- [ ] **Step 1: Write the failing test**

Create `core/tests/smoke.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { VERSION } from '../src/types.js'

describe('scaffold', () => {
  it('exposes a version constant', () => {
    expect(VERSION).toBe('0.0.0')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — no `package.json`, or "Cannot find module '../src/types.js'"

- [ ] **Step 3: Write minimal implementation**

`.nvmrc`:

```
22
```

`.gitignore`:

```
node_modules/
dist/
*.tsbuildinfo
.DS_Store
```

`package.json`:

```json
{
  "name": "hountybunter-monorepo",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "workspaces": ["core", "adapters/*", "surfaces/*"],
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc -b"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

`tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "declaration": true,
    "composite": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  }
}
```

`vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['**/tests/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
})
```

`core/package.json`:

```json
{
  "name": "@hountybunter/core",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "files": ["src"]
}
```

`core/tsconfig.json`:

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist" },
  "include": ["src/**/*.ts"]
}
```

`core/src/types.ts`:

```ts
export const VERSION = '0.0.0'
```

`core/src/index.ts`:

```ts
export * from './types.js'
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm install && npm test`
Expected: PASS — 1 test

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: monorepo scaffold with vitest"
```

---

## Task 2: Store paths and project slugs

**Files:**
- Create: `core/src/paths.ts`
- Modify: `core/src/index.ts`
- Test: `core/tests/paths.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `projectSlug(absPath: string): string`
  - `storeRoot(env?: NodeJS.ProcessEnv): string`
  - `notesDir(slug: string, env?: NodeJS.ProcessEnv): string`
  - `jotsDir(env?: NodeJS.ProcessEnv): string`
  - `dbPath(env?: NodeJS.ProcessEnv): string`

Every path function takes an optional `env` so tests redirect the store to a
temporary directory via `HOUNTYBUNTER_HOME` instead of touching the real one.

**Slug design.** `basename` plus the first six hex characters of the SHA-256 of
the absolute path. The hash is unconditional rather than collision-triggered,
because conditional naming needs global state to detect a collision and would
have to rename an existing directory when a second project appeared. This
machine already has two distinct projects whose basename is `tnm-dms`.

- [ ] **Step 1: Write the failing test**

Create `core/tests/paths.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { dbPath, jotsDir, notesDir, projectSlug, storeRoot } from '../src/paths.js'

const ENV = { HOUNTYBUNTER_HOME: '/tmp/hb-test' } as NodeJS.ProcessEnv

describe('projectSlug', () => {
  it('combines basename with a hash of the full path', () => {
    expect(projectSlug('/Users/kobe/Developer/tnm-dms')).toMatch(/^tnm-dms-[0-9a-f]{6}$/)
  })

  it('gives different slugs to same-named projects at different paths', () => {
    expect(projectSlug('/Users/kobe/A/tnm-dms')).not.toBe(projectSlug('/Users/kobe/B/tnm-dms'))
  })

  it('is stable across calls', () => {
    const p = '/Users/kobe/Developer/tnm-dms'
    expect(projectSlug(p)).toBe(projectSlug(p))
  })

  it('ignores a trailing slash', () => {
    expect(projectSlug('/a/b/proj/')).toBe(projectSlug('/a/b/proj'))
  })

  it('sanitises characters unsafe in a directory name', () => {
    expect(projectSlug('/Users/kobe/My Drive/tnm dms')).toMatch(/^tnm-dms-[0-9a-f]{6}$/)
  })
})

describe('store locations', () => {
  it('honours HOUNTYBUNTER_HOME', () => {
    expect(storeRoot(ENV)).toBe('/tmp/hb-test')
    expect(jotsDir(ENV)).toBe('/tmp/hb-test/jots')
    expect(dbPath(ENV)).toBe('/tmp/hb-test/index.db')
    expect(notesDir('proj-abc123', ENV)).toBe('/tmp/hb-test/notes/proj-abc123')
  })

  it('falls back to ~/.hountybunter', () => {
    expect(storeRoot({ HOME: '/home/x' } as NodeJS.ProcessEnv)).toBe('/home/x/.hountybunter')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run core/tests/paths.test.ts`
Expected: FAIL — "Cannot find module '../src/paths.js'"

- [ ] **Step 3: Write minimal implementation**

Create `core/src/paths.ts`:

```ts
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'

/** Strip a trailing separator so `/a/b/` and `/a/b` hash identically. */
function normalise(absPath: string): string {
  return absPath.length > 1 && absPath.endsWith('/') ? absPath.slice(0, -1) : absPath
}

/**
 * Directory-safe, stable, collision-free identifier for a project path.
 * The hash suffix is unconditional: two projects on this machine already share
 * the basename `tnm-dms`, and conditional suffixing would need global state.
 */
export function projectSlug(absPath: string): string {
  const path = normalise(absPath)
  const hash = createHash('sha256').update(path).digest('hex').slice(0, 6)
  const name = basename(path)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `${name || 'project'}-${hash}`
}

export function storeRoot(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.HOUNTYBUNTER_HOME
  if (override) return override
  return join(env.HOME ?? homedir(), '.hountybunter')
}

export function notesDir(slug: string, env: NodeJS.ProcessEnv = process.env): string {
  return join(storeRoot(env), 'notes', slug)
}

export function jotsDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(storeRoot(env), 'jots')
}

export function dbPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(storeRoot(env), 'index.db')
}
```

Append to `core/src/index.ts`:

```ts
export * from './paths.js'
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run core/tests/paths.test.ts`
Expected: PASS — 7 tests

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(core): store paths and collision-free project slugs"
```

---

## Task 3: Time handling with explicit timezones

**Files:**
- Create: `core/src/time.ts`
- Modify: `core/src/index.ts`
- Test: `core/tests/time.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `nowIso(clock?: () => Date): string`
  - `calendarDate(instantIso: string, timeZone: string): string`
  - `resolveTimeZone(env?: NodeJS.ProcessEnv): string`

Grouping jots into daily files needs a calendar date, and a calendar date is
meaningless without a timezone. Making the zone an explicit argument is what
stops a caller silently depending on the machine's zone.

- [ ] **Step 1: Write the failing test**

Create `core/tests/time.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { calendarDate, nowIso, resolveTimeZone } from '../src/time.js'

describe('nowIso', () => {
  it('formats as ISO 8601 UTC with a Z suffix', () => {
    expect(nowIso(() => new Date('2026-08-27T15:04:05.000Z'))).toBe('2026-08-27T15:04:05.000Z')
  })
})

describe('calendarDate', () => {
  it('resolves the date in the given zone, not the machine zone', () => {
    const instant = '2026-08-27T03:30:00.000Z'
    expect(calendarDate(instant, 'UTC')).toBe('2026-08-27')
    expect(calendarDate(instant, 'Asia/Ho_Chi_Minh')).toBe('2026-08-27')
    expect(calendarDate(instant, 'America/New_York')).toBe('2026-08-26')
  })

  it('handles an instant crossing the boundary the other way', () => {
    const late = '2026-08-27T18:00:00.000Z'
    expect(calendarDate(late, 'UTC')).toBe('2026-08-27')
    expect(calendarDate(late, 'Asia/Ho_Chi_Minh')).toBe('2026-08-28')
  })

  it('throws on an unparseable instant rather than guessing', () => {
    expect(() => calendarDate('not-a-date', 'UTC')).toThrow(/invalid instant/i)
  })
})

describe('resolveTimeZone', () => {
  it('prefers an explicit configuration', () => {
    expect(resolveTimeZone({ HOUNTYBUNTER_TZ: 'Asia/Ho_Chi_Minh' } as NodeJS.ProcessEnv))
      .toBe('Asia/Ho_Chi_Minh')
  })

  it('falls back to a resolvable zone', () => {
    expect(resolveTimeZone({} as NodeJS.ProcessEnv)).toMatch(/\w+/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run core/tests/time.test.ts`
Expected: FAIL — "Cannot find module '../src/time.js'"

- [ ] **Step 3: Write minimal implementation**

Create `core/src/time.ts`:

```ts
/** Current instant as ISO 8601 UTC. The clock is injectable so tests are fixed. */
export function nowIso(clock: () => Date = () => new Date()): string {
  return clock().toISOString()
}

/**
 * The calendar date an instant falls on, in an explicit IANA timezone.
 * `en-CA` is used because it formats as YYYY-MM-DD.
 */
export function calendarDate(instantIso: string, timeZone: string): string {
  const date = new Date(instantIso)
  if (Number.isNaN(date.getTime())) throw new Error(`invalid instant: ${instantIso}`)
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

export function resolveTimeZone(env: NodeJS.ProcessEnv = process.env): string {
  return env.HOUNTYBUNTER_TZ ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC'
}
```

Append to `core/src/index.ts`:

```ts
export * from './time.js'
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run core/tests/time.test.ts`
Expected: PASS — 6 tests

Then confirm zone independence:

Run: `TZ=Pacific/Kiritimati npx vitest run core/tests/time.test.ts`
Run: `TZ=Pacific/Niue npx vitest run core/tests/time.test.ts`
Expected: PASS both. These sit on opposite sides of the date line, so a test
that silently depends on the machine zone fails under at least one.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(core): UTC instants and explicit-timezone calendar dates"
```

---

## Task 4: Note parsing

**Files:**
- Modify: `core/src/types.ts` (replace contents)
- Create: `core/src/note/parse.ts`
- Modify: `core/src/index.ts`
- Test: `core/tests/note-parse.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `NOTE_KINDS`, `NOTE_STATUSES`, `CONFIDENCES`, `EVIDENCE_KINDS`
  - `type Note`, `type RejectedOption`, `type Evidence`, `type NoteKind`,
    `type NoteStatus`, `type Confidence`, `type EvidenceKind`
  - `parseNote(raw: string, sourcePath: string): Note`
  - `class NoteParseError extends Error` with `.sourcePath` and `.field`

Only `question` and `chosen` are required. Unknown frontmatter keys go into
`Note.extra` so Task 5 can restore them.

- [ ] **Step 1: Write the failing test**

Create `core/tests/note-parse.test.ts`:

```ts
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
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run core/tests/note-parse.test.ts`
Expected: FAIL — "Cannot find module '../src/note/parse.js'"

- [ ] **Step 3: Write minimal implementation**

```bash
npm install gray-matter -w @hountybunter/core
```

Replace `core/src/types.ts`:

```ts
export const VERSION = '0.0.0'

export const NOTE_KINDS = ['decision', 'gotcha', 'lesson'] as const
export type NoteKind = (typeof NOTE_KINDS)[number]

export const NOTE_STATUSES = ['standing', 'superseded', 'reversed'] as const
export type NoteStatus = (typeof NOTE_STATUSES)[number]

export const CONFIDENCES = ['high', 'medium', 'low'] as const
export type Confidence = (typeof CONFIDENCES)[number]

export const EVIDENCE_KINDS = ['file', 'commit', 'session', 'url'] as const
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number]

export interface RejectedOption {
  option: string
  why_not: string
}

export interface Evidence {
  kind: EvidenceKind
  ref: string
}

export interface Note {
  id: string
  title: string
  project: string
  kind: NoteKind
  status: NoteStatus
  decided_on: string | null
  question: string
  chosen: string
  rejected: RejectedOption[]
  evidence: Evidence[]
  confidence: Confidence | null
  review_after: string | null
  supersedes: string[]
  body: string
  /** Frontmatter keys we do not know about, preserved for a lossless round trip. */
  extra: Record<string, unknown>
  sourcePath: string
}
```

Create `core/src/note/parse.ts`:

```ts
import matter from 'gray-matter'
import { basename } from 'node:path'
import {
  CONFIDENCES,
  EVIDENCE_KINDS,
  NOTE_KINDS,
  NOTE_STATUSES,
  type Confidence,
  type Evidence,
  type Note,
  type NoteKind,
  type NoteStatus,
  type RejectedOption,
} from '../types.js'

export class NoteParseError extends Error {
  constructor(
    message: string,
    readonly sourcePath: string,
    readonly field?: string,
  ) {
    super(message)
    this.name = 'NoteParseError'
  }
}

/** Frontmatter keys the schema knows. Everything else is preserved in `extra`. */
const KNOWN_KEYS = new Set([
  'id', 'title', 'project', 'kind', 'status', 'decided_on', 'question',
  'chosen', 'rejected', 'evidence', 'confidence', 'review_after', 'supersedes',
])

function str(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value)
}

function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string,
  sourcePath: string,
  fallback: T | null,
): T | null {
  if (value == null || value === '') return fallback
  const s = str(value)
  if (!allowed.includes(s as T)) {
    throw new NoteParseError(
      `${field} must be one of ${allowed.join(', ')} — got "${s}"`,
      sourcePath,
      field,
    )
  }
  return s as T
}

function parseRejected(value: unknown): RejectedOption[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (entry == null || typeof entry !== 'object') return []
    const record = entry as Record<string, unknown>
    const option = str(record.option)
    if (!option) return []
    return [{ option, why_not: str(record.why_not) }]
  })
}

function parseEvidence(value: unknown): Evidence[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (entry == null || typeof entry !== 'object') return []
    const record = entry as Record<string, unknown>
    const kind = str(record.kind)
    const ref = str(record.ref)
    if (!ref || !EVIDENCE_KINDS.includes(kind as Evidence['kind'])) return []
    return [{ kind: kind as Evidence['kind'], ref }]
  })
}

function parseStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map(str).filter(Boolean)
}

export function parseNote(raw: string, sourcePath: string): Note {
  const parsed = matter(raw)
  const data = parsed.data as Record<string, unknown>

  const question = str(data.question)
  if (!question) {
    throw new NoteParseError('note is missing required field: question', sourcePath, 'question')
  }
  const chosen = str(data.chosen)
  if (!chosen) {
    throw new NoteParseError('note is missing required field: chosen', sourcePath, 'chosen')
  }

  const extra: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(data)) {
    if (!KNOWN_KEYS.has(key)) extra[key] = value
  }

  return {
    id: str(data.id) || basename(sourcePath).replace(/\.md$/, ''),
    title: str(data.title) || question,
    project: str(data.project),
    kind: oneOf<NoteKind>(data.kind, NOTE_KINDS, 'kind', sourcePath, 'decision')!,
    status: oneOf<NoteStatus>(data.status, NOTE_STATUSES, 'status', sourcePath, 'standing')!,
    decided_on: str(data.decided_on) || null,
    question,
    chosen,
    rejected: parseRejected(data.rejected),
    evidence: parseEvidence(data.evidence),
    confidence: oneOf<Confidence>(data.confidence, CONFIDENCES, 'confidence', sourcePath, null),
    review_after: str(data.review_after) || null,
    supersedes: parseStringList(data.supersedes),
    body: parsed.content,
    extra,
    sourcePath,
  }
}
```

Append to `core/src/index.ts`:

```ts
export * from './note/parse.js'
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run core/tests/note-parse.test.ts`
Expected: PASS — 8 tests

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(core): tolerant note parsing with only question and chosen required"
```

---

## Task 5: Note serialisation and the round trip

**Files:**
- Create: `core/src/note/serialize.ts`
- Modify: `core/src/index.ts`
- Test: `core/tests/note-roundtrip.test.ts`

**Interfaces:**
- Consumes: `parseNote`, `type Note`
- Produces: `serializeNote(note: Note): string`

- [ ] **Step 1: Write the failing test**

Create `core/tests/note-roundtrip.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run core/tests/note-roundtrip.test.ts`
Expected: FAIL — "Cannot find module '../src/note/serialize.js'"

- [ ] **Step 3: Write minimal implementation**

Create `core/src/note/serialize.ts`:

```ts
import matter from 'gray-matter'
import type { Note } from '../types.js'

/**
 * Note -> markdown. Optional fields that are empty are omitted rather than
 * written as null, so a minimal note stays minimal on disk and re-reading it
 * yields the same object.
 */
export function serializeNote(note: Note): string {
  const data: Record<string, unknown> = {
    id: note.id,
    title: note.title,
    project: note.project,
    kind: note.kind,
    status: note.status,
  }

  if (note.decided_on) data.decided_on = note.decided_on
  data.question = note.question
  data.chosen = note.chosen
  if (note.rejected.length > 0) data.rejected = note.rejected
  if (note.evidence.length > 0) data.evidence = note.evidence
  if (note.confidence) data.confidence = note.confidence
  if (note.review_after) data.review_after = note.review_after
  if (note.supersedes.length > 0) data.supersedes = note.supersedes

  for (const [key, value] of Object.entries(note.extra)) data[key] = value

  return matter.stringify(note.body, data)
}
```

Append to `core/src/index.ts`:

```ts
export * from './note/serialize.js'
```

Note for the implementer: `parseNote` defaults `title` to `question` and
`project` to `''` when absent, so serialising a minimal note writes both keys
back explicitly. That is intentional and keeps the round trip stable; the
"omits optional fields" test only asserts on genuinely optional keys.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run core/tests/note-roundtrip.test.ts`
Expected: PASS — 5 tests

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(core): note serialisation with a lossless round trip"
```

---

## Task 6: Note file store

**Files:**
- Create: `core/src/note/store.ts`
- Modify: `core/src/index.ts`
- Test: `core/tests/note-store.test.ts`

**Interfaces:**
- Consumes: `parseNote`, `serializeNote`, `notesDir`, `storeRoot`,
  `calendarDate`, `type Note`, `NoteParseError`
- Produces:
  - `slugifyTitle(title: string): string`
  - `makeNoteId(title: string, dateIso: string, timeZone: string): string`
  - `writeNote(note: Note, env?: NodeJS.ProcessEnv): Promise<string>`
  - `interface ReadAllResult { notes: Note[]; errors: NoteParseError[] }`
  - `readAllNotes(env?: NodeJS.ProcessEnv): Promise<ReadAllResult>`

A malformed note file must not abort the whole read — the same tolerance the
spec requires of the transcript reader.

- [ ] **Step 1: Write the failing test**

Create `core/tests/note-store.test.ts`:

```ts
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { parseNote } from '../src/note/parse.js'
import { makeNoteId, readAllNotes, slugifyTitle, writeNote } from '../src/note/store.js'

let env: NodeJS.ProcessEnv

beforeEach(async () => {
  const home = await mkdtemp(join(tmpdir(), 'hb-'))
  env = { HOUNTYBUNTER_HOME: home } as NodeJS.ProcessEnv
})

const RAW = `---
id: 2026-08-12-pick-db
project: proj-abc123
question: Which database?
chosen: SQLite
---

Because it is a file.
`

describe('slugifyTitle', () => {
  it('lowercases and hyphenates', () => {
    expect(slugifyTitle('Offline reads for the rep PWA')).toBe('offline-reads-for-the-rep-pwa')
  })

  it('strips punctuation and collapses runs', () => {
    expect(slugifyTitle('Which DB?  Postgres vs. SQLite!')).toBe('which-db-postgres-vs-sqlite')
  })

  it('truncates very long titles', () => {
    expect(slugifyTitle('x'.repeat(200)).length).toBeLessThanOrEqual(60)
  })
})

describe('makeNoteId', () => {
  it('prefixes the calendar date in the given zone', () => {
    expect(makeNoteId('Pick a DB', '2026-08-27T03:30:00.000Z', 'America/New_York'))
      .toBe('2026-08-26-pick-a-db')
  })
})

describe('writeNote / readAllNotes', () => {
  it('writes a note and reads it back', async () => {
    const path = await writeNote(parseNote(RAW, '/unused.md'), env)
    expect(path).toMatch(/notes\/proj-abc123\/2026-08-12-pick-db\.md$/)

    const { notes, errors } = await readAllNotes(env)
    expect(errors).toEqual([])
    expect(notes).toHaveLength(1)
    expect(notes[0]?.chosen).toBe('SQLite')
  })

  it('returns an empty result when the store does not exist yet', async () => {
    const { notes, errors } = await readAllNotes(env)
    expect(notes).toEqual([])
    expect(errors).toEqual([])
  })

  it('collects an error for a malformed note without losing the good ones', async () => {
    await writeNote(parseNote(RAW, '/unused.md'), env)
    const dir = join(env.HOUNTYBUNTER_HOME!, 'notes', 'proj-abc123')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'broken.md'), '---\nchosen: only\n---\n\nno question\n')

    const { notes, errors } = await readAllNotes(env)
    expect(notes).toHaveLength(1)
    expect(errors).toHaveLength(1)
    expect(errors[0]?.field).toBe('question')
  })

  it('ignores non-markdown files', async () => {
    const dir = join(env.HOUNTYBUNTER_HOME!, 'notes', 'proj-abc123')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'notes.txt'), 'not a note')
    const { notes, errors } = await readAllNotes(env)
    expect(notes).toEqual([])
    expect(errors).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run core/tests/note-store.test.ts`
Expected: FAIL — "Cannot find module '../src/note/store.js'"

- [ ] **Step 3: Write minimal implementation**

Create `core/src/note/store.ts`:

```ts
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { notesDir, storeRoot } from '../paths.js'
import { calendarDate } from '../time.js'
import type { Note } from '../types.js'
import { NoteParseError, parseNote } from './parse.js'
import { serializeNote } from './serialize.js'

export function slugifyTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '')
}

export function makeNoteId(title: string, dateIso: string, timeZone: string): string {
  return `${calendarDate(dateIso, timeZone)}-${slugifyTitle(title)}`
}

export async function writeNote(
  note: Note,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const dir = notesDir(note.project, env)
  await mkdir(dir, { recursive: true })
  const path = join(dir, `${note.id}.md`)
  await writeFile(path, serializeNote(note), 'utf8')
  return path
}

export interface ReadAllResult {
  notes: Note[]
  errors: NoteParseError[]
}

/**
 * Read every note in the store. A file that fails to parse is collected as an
 * error rather than aborting the read, so one bad file cannot hide the rest.
 */
export async function readAllNotes(
  env: NodeJS.ProcessEnv = process.env,
): Promise<ReadAllResult> {
  const root = join(storeRoot(env), 'notes')
  const notes: Note[] = []
  const errors: NoteParseError[] = []

  let projectDirs: string[]
  try {
    const entries = await readdir(root, { withFileTypes: true })
    projectDirs = entries.filter((e) => e.isDirectory()).map((e) => e.name)
  } catch {
    return { notes, errors }
  }

  for (const slug of projectDirs.sort()) {
    const dir = join(root, slug)
    const files = (await readdir(dir)).filter((f) => f.endsWith('.md')).sort()
    for (const file of files) {
      const path = join(dir, file)
      try {
        notes.push(parseNote(await readFile(path, 'utf8'), path))
      } catch (error) {
        errors.push(
          error instanceof NoteParseError ? error : new NoteParseError(String(error), path),
        )
      }
    }
  }

  notes.sort((a, b) => a.id.localeCompare(b.id))
  return { notes, errors }
}
```

Append to `core/src/index.ts`:

```ts
export * from './note/store.js'
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run core/tests/note-store.test.ts`
Expected: PASS — 8 tests

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(core): note file store that survives a malformed file"
```

---

## Task 7: Database schema and connection

**Files:**
- Create: `core/src/db/schema.sql`, `core/src/db/open.ts`
- Test: `core/tests/db-open.test.ts`

**Interfaces:**
- Consumes: `dbPath`
- Produces: `SCHEMA_VERSION: number`, `openDb(env?): Database.Database`

Only the tables phases 1–3 need are created. `bounties` belongs to phase 8 and
is deliberately absent — an unused table is a claim the code cannot back up.

- [ ] **Step 1: Write the failing test**

Create `core/tests/db-open.test.ts`:

```ts
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { openDb, SCHEMA_VERSION } from '../src/db/open.js'

let env: NodeJS.ProcessEnv

beforeEach(async () => {
  const home = await mkdtemp(join(tmpdir(), 'hb-'))
  env = { HOUNTYBUNTER_HOME: home } as NodeJS.ProcessEnv
})

function tableNames(db: ReturnType<typeof openDb>): string[] {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view') ORDER BY name")
    .all()
    .map((r) => (r as { name: string }).name)
}

describe('openDb', () => {
  it('creates the phase 1-3 tables', () => {
    const db = openDb(env)
    const names = tableNames(db)
    for (const t of ['projects', 'notes', 'note_evidence', 'notes_fts', 'sessions', 'activities', 'ingest_cursors']) {
      expect(names).toContain(t)
    }
    db.close()
  })

  it('does not create tables that belong to later phases', () => {
    const db = openDb(env)
    expect(tableNames(db)).not.toContain('bounties')
    db.close()
  })

  it('enables WAL so the CLI and a reader can coexist', () => {
    const db = openDb(env)
    expect(String(db.pragma('journal_mode', { simple: true })).toLowerCase()).toBe('wal')
    db.close()
  })

  it('records the schema version', () => {
    const db = openDb(env)
    expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION)
    db.close()
  })

  it('is idempotent — opening twice does not throw', () => {
    openDb(env).close()
    const db = openDb(env)
    expect(tableNames(db)).toContain('notes')
    db.close()
  })

  it('supports FTS5', () => {
    const db = openDb(env)
    db.prepare('INSERT INTO notes_fts (note_id, title, question, chosen, rejected, body) VALUES (?,?,?,?,?,?)')
      .run('n1', 'Offline reads', 'How do reps work offline?', 'TanStack Query', '', 'body')
    expect(db.prepare('SELECT note_id FROM notes_fts WHERE notes_fts MATCH ?').all('offline'))
      .toHaveLength(1)
    db.close()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run core/tests/db-open.test.ts`
Expected: FAIL — "Cannot find module '../src/db/open.js'"

- [ ] **Step 3: Write minimal implementation**

```bash
npm install better-sqlite3 -w @hountybunter/core
npm install -D @types/better-sqlite3 -w @hountybunter/core
```

Create `core/src/db/schema.sql`:

```sql
CREATE TABLE IF NOT EXISTS projects (
  path          TEXT PRIMARY KEY,
  slug          TEXT NOT NULL,
  name          TEXT NOT NULL,
  git_remote    TEXT,
  last_seen_at  TEXT
);

CREATE TABLE IF NOT EXISTS notes (
  id            TEXT PRIMARY KEY,
  project       TEXT NOT NULL,
  path          TEXT NOT NULL,
  title         TEXT NOT NULL,
  kind          TEXT NOT NULL,
  status        TEXT NOT NULL,
  decided_on    TEXT,
  confidence    TEXT,
  review_after  TEXT,
  hash          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS notes_project_idx ON notes(project);
CREATE INDEX IF NOT EXISTS notes_status_idx  ON notes(status);

CREATE TABLE IF NOT EXISTS note_evidence (
  note_id           TEXT NOT NULL,
  kind              TEXT NOT NULL,
  ref               TEXT NOT NULL,
  last_verified_at  TEXT,
  ok                INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (note_id, kind, ref)
);

CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
  note_id UNINDEXED,
  title,
  question,
  chosen,
  rejected,
  body,
  tokenize = 'unicode61'
);

CREATE TABLE IF NOT EXISTS sessions (
  id           TEXT PRIMARY KEY,
  project      TEXT NOT NULL,
  started_at   TEXT,
  ended_at     TEXT,
  branch       TEXT,
  model        TEXT,
  effort       TEXT,
  title        TEXT,
  correlation  TEXT NOT NULL DEFAULT 'exact'
);
CREATE INDEX IF NOT EXISTS sessions_project_idx ON sessions(project);

CREATE TABLE IF NOT EXISTS activities (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id   TEXT NOT NULL,
  seq          INTEGER NOT NULL,
  ts           TEXT,
  kind         TEXT NOT NULL,
  tool_name    TEXT,
  attr_skill   TEXT,
  attr_plugin  TEXT,
  payload_json TEXT,
  UNIQUE (session_id, seq)
);
CREATE INDEX IF NOT EXISTS activities_session_idx ON activities(session_id);

CREATE TABLE IF NOT EXISTS ingest_cursors (
  file_path     TEXT PRIMARY KEY,
  byte_offset   INTEGER NOT NULL,
  last_seen_at  TEXT NOT NULL
);
```

`UNIQUE (session_id, seq)` is what makes re-ingesting the same transcript
idempotent, which Task 15 and Task 10 both depend on.

Create `core/src/db/open.ts`:

```ts
import Database from 'better-sqlite3'
import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dbPath } from '../paths.js'

export const SCHEMA_VERSION = 1

const here = dirname(fileURLToPath(import.meta.url))

export function openDb(env: NodeJS.ProcessEnv = process.env): Database.Database {
  const path = dbPath(env)
  mkdirSync(dirname(path), { recursive: true })
  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(readFileSync(join(here, 'schema.sql'), 'utf8'))
  db.pragma(`user_version = ${SCHEMA_VERSION}`)
  return db
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run core/tests/db-open.test.ts`
Expected: PASS — 6 tests

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(core): SQLite schema with FTS5, WAL, and idempotent activity keys"
```

---

## Task 8: Indexing notes into SQLite

**Files:**
- Create: `core/src/db/index.ts`
- Test: `core/tests/db-index.test.ts`

**Interfaces:**
- Consumes: `openDb`, `serializeNote`, `type Note`
- Produces:
  - `noteHash(note: Note): string`
  - `indexNote(db: Database.Database, note: Note): void`
  - `clearNoteIndex(db: Database.Database): void`

- [ ] **Step 1: Write the failing test**

Create `core/tests/db-index.test.ts`:

```ts
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { clearNoteIndex, indexNote, noteHash } from '../src/db/index.js'
import { openDb } from '../src/db/open.js'
import { parseNote } from '../src/note/parse.js'

let env: NodeJS.ProcessEnv

beforeEach(async () => {
  const home = await mkdtemp(join(tmpdir(), 'hb-'))
  env = { HOUNTYBUNTER_HOME: home } as NodeJS.ProcessEnv
})

const RAW = `---
id: 2026-08-12-offline-reads
title: Offline reads
project: proj-abc123
question: How do reps work through network gaps?
chosen: TanStack Query
rejected:
  - option: Full sync engine
    why_not: Needs idempotency keys
evidence:
  - kind: file
    ref: src/lib/persister.ts
---

Prose body about persisters.
`

describe('indexNote', () => {
  it('inserts a row, its evidence, and its search text', () => {
    const db = openDb(env)
    indexNote(db, parseNote(RAW, '/store/a.md'))
    expect(db.prepare('SELECT COUNT(*) c FROM notes').get()).toEqual({ c: 1 })
    expect(db.prepare('SELECT COUNT(*) c FROM note_evidence').get()).toEqual({ c: 1 })
    expect(db.prepare('SELECT COUNT(*) c FROM notes_fts').get()).toEqual({ c: 1 })
    db.close()
  })

  it('is idempotent — indexing twice leaves one row', () => {
    const db = openDb(env)
    const note = parseNote(RAW, '/store/a.md')
    indexNote(db, note)
    indexNote(db, note)
    expect(db.prepare('SELECT COUNT(*) c FROM notes').get()).toEqual({ c: 1 })
    expect(db.prepare('SELECT COUNT(*) c FROM note_evidence').get()).toEqual({ c: 1 })
    expect(db.prepare('SELECT COUNT(*) c FROM notes_fts').get()).toEqual({ c: 1 })
    db.close()
  })

  it('makes the rejected reasoning searchable', () => {
    const db = openDb(env)
    indexNote(db, parseNote(RAW, '/store/a.md'))
    expect(db.prepare('SELECT note_id FROM notes_fts WHERE notes_fts MATCH ?').all('idempotency'))
      .toEqual([{ note_id: '2026-08-12-offline-reads' }])
    db.close()
  })

  it('clearNoteIndex empties note tables only', () => {
    const db = openDb(env)
    indexNote(db, parseNote(RAW, '/store/a.md'))
    db.prepare("INSERT INTO sessions (id, project) VALUES ('s1','p')").run()
    clearNoteIndex(db)
    expect(db.prepare('SELECT COUNT(*) c FROM notes').get()).toEqual({ c: 0 })
    expect(db.prepare('SELECT COUNT(*) c FROM notes_fts').get()).toEqual({ c: 0 })
    expect(db.prepare('SELECT COUNT(*) c FROM sessions').get()).toEqual({ c: 1 })
    db.close()
  })
})

describe('noteHash', () => {
  it('changes when content changes and is stable otherwise', () => {
    const a = parseNote(RAW, '/store/a.md')
    const b = parseNote(RAW.replace('TanStack Query', 'SWR'), '/store/a.md')
    expect(noteHash(a)).toBe(noteHash(a))
    expect(noteHash(a)).not.toBe(noteHash(b))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run core/tests/db-index.test.ts`
Expected: FAIL — "Cannot find module '../src/db/index.js'"

- [ ] **Step 3: Write minimal implementation**

Create `core/src/db/index.ts`:

```ts
import type Database from 'better-sqlite3'
import { createHash } from 'node:crypto'
import { serializeNote } from '../note/serialize.js'
import type { Note } from '../types.js'

/** Content hash of the note as it would be written to disk. */
export function noteHash(note: Note): string {
  return createHash('sha256').update(serializeNote(note)).digest('hex')
}

export function indexNote(db: Database.Database, note: Note): void {
  db.transaction(() => {
    db.prepare(
      `INSERT INTO notes (id, project, path, title, kind, status, decided_on,
                          confidence, review_after, hash)
       VALUES (@id, @project, @path, @title, @kind, @status, @decided_on,
               @confidence, @review_after, @hash)
       ON CONFLICT(id) DO UPDATE SET
         project = excluded.project, path = excluded.path, title = excluded.title,
         kind = excluded.kind, status = excluded.status,
         decided_on = excluded.decided_on, confidence = excluded.confidence,
         review_after = excluded.review_after, hash = excluded.hash`,
    ).run({
      id: note.id,
      project: note.project,
      path: note.sourcePath,
      title: note.title,
      kind: note.kind,
      status: note.status,
      decided_on: note.decided_on,
      confidence: note.confidence,
      review_after: note.review_after,
      hash: noteHash(note),
    })

    db.prepare('DELETE FROM note_evidence WHERE note_id = ?').run(note.id)
    const insertEvidence = db.prepare(
      'INSERT INTO note_evidence (note_id, kind, ref) VALUES (?, ?, ?)',
    )
    for (const e of note.evidence) insertEvidence.run(note.id, e.kind, e.ref)

    // FTS5 has no upsert; delete then insert keeps re-indexing idempotent.
    db.prepare('DELETE FROM notes_fts WHERE note_id = ?').run(note.id)
    db.prepare(
      `INSERT INTO notes_fts (note_id, title, question, chosen, rejected, body)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      note.id,
      note.title,
      note.question,
      note.chosen,
      note.rejected.map((r) => `${r.option} ${r.why_not}`).join('\n'),
      note.body,
    )
  })()
}

export function clearNoteIndex(db: Database.Database): void {
  db.transaction(() => {
    db.prepare('DELETE FROM notes_fts').run()
    db.prepare('DELETE FROM note_evidence').run()
    db.prepare('DELETE FROM notes').run()
  })()
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run core/tests/db-index.test.ts`
Expected: PASS — 5 tests

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(core): idempotent note indexing with searchable rejected reasoning"
```

---

## Task 9: Search and list queries

**Files:**
- Create: `core/src/db/query.ts`
- Modify: `core/src/index.ts`
- Test: `core/tests/db-query.test.ts`

**Interfaces:**
- Consumes: `openDb`, `indexNote`
- Produces:
  - `interface NoteHit { id: string; project: string; title: string; kind: string; status: string; snippet: string }`
  - `escapeFts(query: string): string`
  - `searchNotes(db, query, opts?: { project?: string; limit?: number }): NoteHit[]`
  - `listNotes(db, opts?: { project?: string; status?: string; limit?: number }): NoteHit[]`

User input reaches FTS5, which has its own query syntax. `escapeFts` quotes the
input so `C++` or `a AND b` is treated as text rather than as operators or a
syntax error.

- [ ] **Step 1: Write the failing test**

Create `core/tests/db-query.test.ts`:

```ts
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { indexNote } from '../src/db/index.js'
import { openDb } from '../src/db/open.js'
import { escapeFts, listNotes, searchNotes } from '../src/db/query.js'
import { parseNote } from '../src/note/parse.js'

let db: ReturnType<typeof openDb>

function note(id: string, project: string, question: string, chosen: string, status = 'standing') {
  return parseNote(
    `---\nid: ${id}\ntitle: ${id}\nproject: ${project}\nstatus: ${status}\nquestion: ${question}\nchosen: ${chosen}\n---\n\nbody for ${id}\n`,
    `/store/${id}.md`,
  )
}

beforeEach(async () => {
  const home = await mkdtemp(join(tmpdir(), 'hb-'))
  db = openDb({ HOUNTYBUNTER_HOME: home } as NodeJS.ProcessEnv)
  indexNote(db, note('n1', 'proj-a', 'How do reps work offline?', 'TanStack Query'))
  indexNote(db, note('n2', 'proj-a', 'Which database?', 'SQLite', 'superseded'))
  indexNote(db, note('n3', 'proj-b', 'Which language for the CLI?', 'TypeScript'))
})

describe('searchNotes', () => {
  it('finds a note by a word in its question', () => {
    expect(searchNotes(db, 'offline').map((h) => h.id)).toEqual(['n1'])
  })

  it('finds a note by a word in what was chosen', () => {
    expect(searchNotes(db, 'sqlite').map((h) => h.id)).toEqual(['n2'])
  })

  it('filters by project', () => {
    expect(searchNotes(db, 'which', { project: 'proj-b' }).map((h) => h.id)).toEqual(['n3'])
  })

  it('returns an empty array for no match', () => {
    expect(searchNotes(db, 'kubernetes')).toEqual([])
  })

  it('treats FTS operators in user input as literal text', () => {
    expect(() => searchNotes(db, 'a AND')).not.toThrow()
    expect(() => searchNotes(db, 'C++')).not.toThrow()
    expect(() => searchNotes(db, '"')).not.toThrow()
  })

  it('returns a snippet containing the match', () => {
    expect(searchNotes(db, 'offline')[0]?.snippet.toLowerCase()).toContain('offline')
  })
})

describe('listNotes', () => {
  it('lists every note by default, newest id first', () => {
    expect(listNotes(db).map((h) => h.id)).toEqual(['n3', 'n2', 'n1'])
  })

  it('filters by project', () => {
    expect(listNotes(db, { project: 'proj-a' }).map((h) => h.id)).toEqual(['n2', 'n1'])
  })

  it('filters by status', () => {
    expect(listNotes(db, { status: 'superseded' }).map((h) => h.id)).toEqual(['n2'])
  })

  it('respects a limit', () => {
    expect(listNotes(db, { limit: 1 })).toHaveLength(1)
  })
})

describe('escapeFts', () => {
  it('wraps input in quotes and doubles embedded quotes', () => {
    expect(escapeFts('a AND b')).toBe('"a AND b"')
    expect(escapeFts('say "hi"')).toBe('"say ""hi"""')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run core/tests/db-query.test.ts`
Expected: FAIL — "Cannot find module '../src/db/query.js'"

- [ ] **Step 3: Write minimal implementation**

Create `core/src/db/query.ts`:

```ts
import type Database from 'better-sqlite3'

export interface NoteHit {
  id: string
  project: string
  title: string
  kind: string
  status: string
  snippet: string
}

/**
 * FTS5 has its own query language. Users type prose, not queries, so the whole
 * input is quoted as a single phrase; embedded quotes are doubled per SQLite's
 * string rules.
 */
export function escapeFts(query: string): string {
  return `"${query.replace(/"/g, '""')}"`
}

export function searchNotes(
  db: Database.Database,
  query: string,
  opts: { project?: string; limit?: number } = {},
): NoteHit[] {
  const sql = `
    SELECT n.id, n.project, n.title, n.kind, n.status,
           snippet(notes_fts, -1, '', '', ' … ', 12) AS snippet
    FROM notes_fts
    JOIN notes n ON n.id = notes_fts.note_id
    WHERE notes_fts MATCH ?
      ${opts.project ? 'AND n.project = ?' : ''}
    ORDER BY rank
    LIMIT ?`
  const params: unknown[] = [escapeFts(query)]
  if (opts.project) params.push(opts.project)
  params.push(opts.limit ?? 20)
  return db.prepare(sql).all(...params) as NoteHit[]
}

export function listNotes(
  db: Database.Database,
  opts: { project?: string; status?: string; limit?: number } = {},
): NoteHit[] {
  const where: string[] = []
  const params: unknown[] = []
  if (opts.project) {
    where.push('project = ?')
    params.push(opts.project)
  }
  if (opts.status) {
    where.push('status = ?')
    params.push(opts.status)
  }
  params.push(opts.limit ?? 50)

  return db
    .prepare(
      `SELECT id, project, title, kind, status, '' AS snippet
       FROM notes
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY id DESC
       LIMIT ?`,
    )
    .all(...params) as NoteHit[]
}
```

Append to `core/src/index.ts`:

```ts
export * from './db/open.js'
export * from './db/index.js'
export * from './db/query.js'
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run core/tests/db-query.test.ts`
Expected: PASS — 11 tests

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(core): note search and list with FTS input escaping"
```

---

## Task 10: Rebuild from disk — the keystone test

**Files:**
- Create: `core/src/rebuild.ts`
- Modify: `core/src/index.ts`
- Test: `core/tests/rebuild.test.ts`

**Interfaces:**
- Consumes: `openDb`, `clearNoteIndex`, `indexNote`, `readAllNotes`, `NoteParseError`
- Produces:
  - `interface RebuildReport { notesIndexed: number; errors: NoteParseError[] }`
  - `rebuildFromDisk(env?): Promise<RebuildReport>`
  - `snapshotState(db: Database.Database): string` — **closes the database it is
    given**, so every caller passes a fresh `openDb(env)`

This is the test the whole storage design rests on. If it passes, "SQLite is
disposable" is a fact rather than an intention. `snapshotState` excludes
`activities.id` (an autoincrement rowid) and wall-clock columns, because those
legitimately differ between runs without the state differing.

- [ ] **Step 1: Write the failing test**

Create `core/tests/rebuild.test.ts`:

```ts
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { openDb } from '../src/db/open.js'
import { dbPath } from '../src/paths.js'
import { rebuildFromDisk, snapshotState } from '../src/rebuild.js'

let env: NodeJS.ProcessEnv
let home: string

async function seedNote(id: string, project: string, extra = '') {
  const dir = join(home, 'notes', project)
  await mkdir(dir, { recursive: true })
  await writeFile(
    join(dir, `${id}.md`),
    `---\nid: ${id}\ntitle: ${id}\nproject: ${project}\nquestion: q for ${id}\nchosen: c for ${id}\n${extra}---\n\nbody ${id}\n`,
  )
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'hb-'))
  env = { HOUNTYBUNTER_HOME: home } as NodeJS.ProcessEnv
})

describe('rebuildFromDisk', () => {
  it('indexes every note found on disk', async () => {
    await seedNote('n1', 'proj-a')
    await seedNote('n2', 'proj-a')
    await seedNote('n3', 'proj-b')
    const report = await rebuildFromDisk(env)
    expect(report.notesIndexed).toBe(3)
    expect(report.errors).toEqual([])
  })

  it('reports a malformed note without aborting the rebuild', async () => {
    await seedNote('n1', 'proj-a')
    await writeFile(join(home, 'notes', 'proj-a', 'bad.md'), '---\nchosen: only\n---\n\nx\n')
    const report = await rebuildFromDisk(env)
    expect(report.notesIndexed).toBe(1)
    expect(report.errors).toHaveLength(1)
  })

  // The keystone.
  it('produces identical state after the database is deleted and rebuilt', async () => {
    await seedNote('n1', 'proj-a', 'evidence:\n  - kind: file\n    ref: src/a.ts\n')
    await seedNote('n2', 'proj-b', 'rejected:\n  - option: Redis\n    why_not: overkill\n')

    await rebuildFromDisk(env)
    const first = snapshotState(openDb(env))

    await rm(dbPath(env), { force: true })
    await rm(`${dbPath(env)}-wal`, { force: true })
    await rm(`${dbPath(env)}-shm`, { force: true })

    await rebuildFromDisk(env)
    const second = snapshotState(openDb(env))

    expect(second).toBe(first)
  })

  it('is idempotent when run twice without deleting the database', async () => {
    await seedNote('n1', 'proj-a')
    await rebuildFromDisk(env)
    const first = snapshotState(openDb(env))
    await rebuildFromDisk(env)
    expect(snapshotState(openDb(env))).toBe(first)
  })

  it('drops notes whose files were deleted from disk', async () => {
    await seedNote('n1', 'proj-a')
    await seedNote('n2', 'proj-a')
    await rebuildFromDisk(env)

    await rm(join(home, 'notes', 'proj-a', 'n2.md'))
    const report = await rebuildFromDisk(env)
    expect(report.notesIndexed).toBe(1)

    const db = openDb(env)
    expect(db.prepare('SELECT COUNT(*) c FROM notes').get()).toEqual({ c: 1 })
    db.close()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run core/tests/rebuild.test.ts`
Expected: FAIL — "Cannot find module '../src/rebuild.js'"

- [ ] **Step 3: Write minimal implementation**

Create `core/src/rebuild.ts`:

```ts
import type Database from 'better-sqlite3'
import { clearNoteIndex, indexNote } from './db/index.js'
import { openDb } from './db/open.js'
import type { NoteParseError } from './note/parse.js'
import { readAllNotes } from './note/store.js'

export interface RebuildReport {
  notesIndexed: number
  errors: NoteParseError[]
}

/**
 * Rebuild the note index from the markdown on disk. Clearing first is what
 * makes a deleted file disappear from the index; without it the index would
 * only ever grow.
 */
export async function rebuildFromDisk(
  env: NodeJS.ProcessEnv = process.env,
): Promise<RebuildReport> {
  const { notes, errors } = await readAllNotes(env)
  const db = openDb(env)
  try {
    clearNoteIndex(db)
    for (const note of notes) indexNote(db, note)
    return { notesIndexed: notes.length, errors }
  } finally {
    db.close()
  }
}

/**
 * A canonical projection of durable state, for asserting that two rebuilds
 * agree. Autoincrement rowids and wall-clock columns are excluded: they differ
 * between runs without the state differing.
 *
 * Closes the database it is given.
 */
export function snapshotState(db: Database.Database): string {
  const q = (sql: string) => db.prepare(sql).all()
  const state = {
    notes: q(
      `SELECT id, project, title, kind, status, decided_on, confidence,
              review_after, hash
       FROM notes ORDER BY id`,
    ),
    note_evidence: q(
      'SELECT note_id, kind, ref, ok FROM note_evidence ORDER BY note_id, kind, ref',
    ),
    notes_fts: q(
      'SELECT note_id, title, question, chosen, rejected, body FROM notes_fts ORDER BY note_id',
    ),
    sessions: q(
      `SELECT id, project, started_at, ended_at, branch, model, effort, title, correlation
       FROM sessions ORDER BY id`,
    ),
    activities: q(
      `SELECT session_id, seq, ts, kind, tool_name, attr_skill, attr_plugin, payload_json
       FROM activities ORDER BY session_id, seq`,
    ),
  }
  db.close()
  return JSON.stringify(state, null, 2)
}
```

Append to `core/src/index.ts`:

```ts
export * from './rebuild.js'
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run core/tests/rebuild.test.ts`
Expected: PASS — 5 tests, including "produces identical state after the database
is deleted and rebuilt"

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(core): rebuild from disk, proving the index is disposable"
```

---

## Task 11: Jot capture

**Files:**
- Create: `core/src/jot/store.ts`
- Modify: `core/src/index.ts`
- Test: `core/tests/jot.test.ts`

**Interfaces:**
- Consumes: `jotsDir`, `nowIso`, `calendarDate`, `resolveTimeZone`
- Produces:
  - `interface Jot { instant: string; project: string; text: string; line: number; date: string }`
  - `interface JotOpts { env?: NodeJS.ProcessEnv; clock?: () => Date; timeZone?: string }`
  - `appendJot(input: { project: string; text: string }, opts?: JotOpts): Promise<Jot>`
  - `readJots(opts?: JotOpts): Promise<Jot[]>`

One jot is one line in `jots/YYYY-MM-DD.md`. Append-only, no database write on
the hot path — capture has to be fast enough to use mid-task, which is the
acceptance criterion for phase 3. Line format:

```
2026-08-27T15:04:05.000Z | tnm-dms-a3f9c1 | chose TanStack Query over a sync engine
```

- [ ] **Step 1: Write the failing test**

Create `core/tests/jot.test.ts`:

```ts
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { appendJot, readJots } from '../src/jot/store.js'

let env: NodeJS.ProcessEnv
let home: string
const clock = (iso: string) => () => new Date(iso)

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'hb-'))
  env = { HOUNTYBUNTER_HOME: home } as NodeJS.ProcessEnv
})

describe('appendJot', () => {
  it('writes one line to a file named for the calendar date', async () => {
    const jot = await appendJot(
      { project: 'proj-a', text: 'chose SQLite' },
      { env, clock: clock('2026-08-27T15:04:05.000Z'), timeZone: 'UTC' },
    )
    expect(jot.date).toBe('2026-08-27')
    expect(await readFile(join(home, 'jots', '2026-08-27.md'), 'utf8'))
      .toBe('2026-08-27T15:04:05.000Z | proj-a | chose SQLite\n')
  })

  it('files a jot by the configured zone, not the machine zone', async () => {
    const jot = await appendJot(
      { project: 'proj-a', text: 'late night' },
      { env, clock: clock('2026-08-27T18:00:00.000Z'), timeZone: 'Asia/Ho_Chi_Minh' },
    )
    expect(jot.date).toBe('2026-08-28')
  })

  it('appends rather than overwriting', async () => {
    const opts = { env, clock: clock('2026-08-27T10:00:00.000Z'), timeZone: 'UTC' }
    await appendJot({ project: 'proj-a', text: 'first' }, opts)
    await appendJot({ project: 'proj-a', text: 'second' }, opts)
    const contents = await readFile(join(home, 'jots', '2026-08-27.md'), 'utf8')
    expect(contents.trim().split('\n')).toHaveLength(2)
  })

  it('collapses newlines so one jot is always one line', async () => {
    await appendJot(
      { project: 'proj-a', text: 'line one\nline two' },
      { env, clock: clock('2026-08-27T10:00:00.000Z'), timeZone: 'UTC' },
    )
    const contents = await readFile(join(home, 'jots', '2026-08-27.md'), 'utf8')
    expect(contents.trim().split('\n')).toHaveLength(1)
    expect(contents).toContain('line one line two')
  })

  it('rejects empty text', async () => {
    await expect(appendJot({ project: 'proj-a', text: '   ' }, { env, timeZone: 'UTC' }))
      .rejects.toThrow(/empty/i)
  })
})

describe('readJots', () => {
  it('returns an empty array when nothing has been jotted', async () => {
    expect(await readJots({ env })).toEqual([])
  })

  it('reads jots across days, oldest first', async () => {
    await appendJot({ project: 'p', text: 'day one' },
      { env, clock: clock('2026-08-26T10:00:00.000Z'), timeZone: 'UTC' })
    await appendJot({ project: 'p', text: 'day two' },
      { env, clock: clock('2026-08-27T10:00:00.000Z'), timeZone: 'UTC' })
    const jots = await readJots({ env })
    expect(jots.map((j) => j.text)).toEqual(['day one', 'day two'])
    expect(jots[0]?.line).toBe(1)
  })

  it('skips a malformed line instead of failing the read', async () => {
    await mkdir(join(home, 'jots'), { recursive: true })
    await writeFile(
      join(home, 'jots', '2026-08-27.md'),
      'garbage with no pipes\n2026-08-27T10:00:00.000Z | p | good one\n',
    )
    const jots = await readJots({ env })
    expect(jots).toHaveLength(1)
    expect(jots[0]?.text).toBe('good one')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run core/tests/jot.test.ts`
Expected: FAIL — "Cannot find module '../src/jot/store.js'"

- [ ] **Step 3: Write minimal implementation**

Create `core/src/jot/store.ts`:

```ts
import { appendFile, mkdir, readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { jotsDir } from '../paths.js'
import { calendarDate, nowIso, resolveTimeZone } from '../time.js'

export interface Jot {
  instant: string
  project: string
  text: string
  /** 1-based line number within its day file, for later promotion. */
  line: number
  date: string
}

export interface JotOpts {
  env?: NodeJS.ProcessEnv
  clock?: () => Date
  timeZone?: string
}

const SEPARATOR = ' | '

export async function appendJot(
  input: { project: string; text: string },
  opts: JotOpts = {},
): Promise<Jot> {
  const text = input.text.replace(/\s*\n\s*/g, ' ').trim()
  if (!text) throw new Error('jot text is empty')

  const env = opts.env ?? process.env
  const timeZone = opts.timeZone ?? resolveTimeZone(env)
  const instant = nowIso(opts.clock)
  const date = calendarDate(instant, timeZone)

  const dir = jotsDir(env)
  await mkdir(dir, { recursive: true })
  const file = join(dir, `${date}.md`)

  let line = 1
  try {
    line = (await readFile(file, 'utf8')).split('\n').filter(Boolean).length + 1
  } catch {
    line = 1
  }

  await appendFile(file, `${instant}${SEPARATOR}${input.project}${SEPARATOR}${text}\n`, 'utf8')
  return { instant, project: input.project, text, line, date }
}

export async function readJots(opts: JotOpts = {}): Promise<Jot[]> {
  const dir = jotsDir(opts.env ?? process.env)
  let files: string[]
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith('.md')).sort()
  } catch {
    return []
  }

  const jots: Jot[] = []
  for (const file of files) {
    const date = file.replace(/\.md$/, '')
    const contents = await readFile(join(dir, file), 'utf8')
    let line = 0
    for (const raw of contents.split('\n')) {
      if (!raw.trim()) continue
      line += 1
      const parts = raw.split(SEPARATOR)
      // A line that does not match the format is skipped, not fatal.
      if (parts.length < 3) continue
      const [instant, project, ...rest] = parts
      jots.push({
        instant: instant!,
        project: project!,
        text: rest.join(SEPARATOR),
        line,
        date,
      })
    }
  }
  return jots
}
```

Append to `core/src/index.ts`:

```ts
export * from './jot/store.js'
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run core/tests/jot.test.ts`
Expected: PASS — 8 tests

Run: `TZ=Pacific/Kiritimati npx vitest run core/tests/jot.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(core): append-only jot capture with explicit timezone filing"
```

---

## Task 12: Promoting a jot to a note

**Files:**
- Create: `core/src/jot/promote.ts`
- Modify: `core/src/index.ts`
- Test: `core/tests/promote.test.ts`

**Interfaces:**
- Consumes: `type Jot`, `type JotOpts`, `writeNote`, `makeNoteId`,
  `calendarDate`, `resolveTimeZone`, `type Note`
- Produces:
  - `promoteJot(jot: Jot, input: { question: string; chosen: string; title?: string }, opts?: JotOpts): Promise<Note>`

- [ ] **Step 1: Write the failing test**

Create `core/tests/promote.test.ts`:

```ts
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { promoteJot } from '../src/jot/promote.js'
import { appendJot } from '../src/jot/store.js'

let env: NodeJS.ProcessEnv
let home: string

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'hb-'))
  env = { HOUNTYBUNTER_HOME: home } as NodeJS.ProcessEnv
})

async function jot(text: string) {
  return appendJot(
    { project: 'proj-a', text },
    { env, clock: () => new Date('2026-08-27T15:04:05.000Z'), timeZone: 'UTC' },
  )
}

describe('promoteJot', () => {
  it('creates a note dated from the jot, not from now', async () => {
    const note = await promoteJot(
      await jot('chose SQLite over Postgres'),
      { question: 'Which database?', chosen: 'SQLite' },
      { env, clock: () => new Date('2027-01-01T00:00:00.000Z'), timeZone: 'UTC' },
    )
    expect(note.id.startsWith('2026-08-27-')).toBe(true)
    expect(note.decided_on).toBe('2026-08-27')
  })

  it('keeps the jot text as the first body paragraph', async () => {
    const note = await promoteJot(
      await jot('chose SQLite over Postgres'),
      { question: 'Which database?', chosen: 'SQLite' },
      { env, timeZone: 'UTC' },
    )
    expect(note.body).toContain('chose SQLite over Postgres')
  })

  it('defaults the title to the question', async () => {
    const note = await promoteJot(
      await jot('anything'),
      { question: 'Which database?', chosen: 'SQLite' },
      { env, timeZone: 'UTC' },
    )
    expect(note.title).toBe('Which database?')
  })

  it('uses an explicit title when given', async () => {
    const note = await promoteJot(
      await jot('anything'),
      { question: 'Which database?', chosen: 'SQLite', title: 'Storage engine' },
      { env, timeZone: 'UTC' },
    )
    expect(note.title).toBe('Storage engine')
    expect(note.id).toBe('2026-08-27-storage-engine')
  })

  it('writes the note into the jot project directory', async () => {
    const note = await promoteJot(
      await jot('anything'),
      { question: 'q', chosen: 'c' },
      { env, timeZone: 'UTC' },
    )
    const written = await readFile(join(home, 'notes', 'proj-a', `${note.id}.md`), 'utf8')
    expect(written).toContain('chosen: c')
  })

  it('requires both question and chosen', async () => {
    const j = await jot('anything')
    await expect(promoteJot(j, { question: '', chosen: 'c' }, { env, timeZone: 'UTC' }))
      .rejects.toThrow(/question/)
    await expect(promoteJot(j, { question: 'q', chosen: '' }, { env, timeZone: 'UTC' }))
      .rejects.toThrow(/chosen/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run core/tests/promote.test.ts`
Expected: FAIL — "Cannot find module '../src/jot/promote.js'"

- [ ] **Step 3: Write minimal implementation**

Create `core/src/jot/promote.ts`:

```ts
import { makeNoteId, writeNote } from '../note/store.js'
import { calendarDate, resolveTimeZone } from '../time.js'
import type { Note } from '../types.js'
import type { Jot, JotOpts } from './store.js'

export async function promoteJot(
  jot: Jot,
  input: { question: string; chosen: string; title?: string },
  opts: JotOpts = {},
): Promise<Note> {
  const question = input.question.trim()
  if (!question) throw new Error('promotion requires a question')
  const chosen = input.chosen.trim()
  if (!chosen) throw new Error('promotion requires chosen')

  const env = opts.env ?? process.env
  const timeZone = opts.timeZone ?? resolveTimeZone(env)
  const title = input.title?.trim() || question

  // Dated from the jot's instant, not from now: promotion records when the
  // decision happened, not when it was written up.
  const note: Note = {
    id: makeNoteId(title, jot.instant, timeZone),
    title,
    project: jot.project,
    kind: 'decision',
    status: 'standing',
    decided_on: calendarDate(jot.instant, timeZone),
    question,
    chosen,
    rejected: [],
    evidence: [],
    confidence: null,
    review_after: null,
    supersedes: [],
    body: `${jot.text}\n`,
    extra: {},
    sourcePath: '',
  }

  note.sourcePath = await writeNote(note, env)
  return note
}
```

Append to `core/src/index.ts`:

```ts
export * from './jot/promote.js'
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run core/tests/promote.test.ts`
Expected: PASS — 6 tests

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(core): promote a jot into a note, dated from the jot"
```

---

## Task 13: Transcript line parsing

**Files:**
- Create: `adapters/claude-code/package.json`, `adapters/claude-code/tsconfig.json`
- Create: `adapters/claude-code/src/parse-line.ts`, `adapters/claude-code/src/index.ts`
- Test: `adapters/claude-code/tests/parse-line.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `type TranscriptRecord = { ok: true; kind: string; raw: Record<string, unknown> } | { ok: false; reason: string }`
  - `parseLine(line: string): TranscriptRecord`
  - `extractToolUses(raw: Record<string, unknown>): { name: string }[]`

Field names below were observed in real transcripts on this machine: `cwd`,
`gitBranch`, `effort`, `aiTitle`, `attributionSkill`, `attributionPlugin`,
`attributionMcpTool`, `attributionMcpServer`; record types `user`, `assistant`,
`attachment`, `system`, `file-history-snapshot`, `queue-operation`.

- [ ] **Step 1: Write the failing test**

Create `adapters/claude-code/tests/parse-line.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { extractToolUses, parseLine } from '../src/parse-line.js'

describe('parseLine', () => {
  it('parses a user record', () => {
    const record = parseLine(JSON.stringify({ type: 'user', cwd: '/repo' }))
    expect(record.ok).toBe(true)
    if (record.ok) {
      expect(record.kind).toBe('user')
      expect(record.raw.cwd).toBe('/repo')
    }
  })

  it('keeps an unknown record type instead of dropping it', () => {
    const record = parseLine(JSON.stringify({ type: 'brand-new-thing', payload: 1 }))
    expect(record.ok).toBe(true)
    if (record.ok) {
      expect(record.kind).toBe('brand-new-thing')
      expect(record.raw.payload).toBe(1)
    }
  })

  it('treats a record with no type as unknown rather than failing', () => {
    const record = parseLine(JSON.stringify({ cwd: '/repo' }))
    expect(record.ok).toBe(true)
    if (record.ok) expect(record.kind).toBe('unknown')
  })

  it('reports malformed JSON rather than throwing', () => {
    const record = parseLine('{ not json')
    expect(record.ok).toBe(false)
    if (!record.ok) expect(record.reason).toMatch(/json/i)
  })

  it('reports a non-object line rather than throwing', () => {
    expect(parseLine('42').ok).toBe(false)
    expect(parseLine('"a string"').ok).toBe(false)
    expect(parseLine('null').ok).toBe(false)
  })

  it('reports an empty line', () => {
    expect(parseLine('   ').ok).toBe(false)
  })
})

describe('extractToolUses', () => {
  it('finds tool_use blocks in an assistant record', () => {
    const raw = {
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'hello' },
          { type: 'tool_use', name: 'Bash' },
          { type: 'tool_use', name: 'Write' },
        ],
      },
    }
    expect(extractToolUses(raw)).toEqual([{ name: 'Bash' }, { name: 'Write' }])
  })

  it('returns an empty array when content is missing or the wrong shape', () => {
    expect(extractToolUses({ type: 'assistant' })).toEqual([])
    expect(extractToolUses({ type: 'assistant', message: { content: 'text' } })).toEqual([])
    expect(extractToolUses({ type: 'assistant', message: null })).toEqual([])
  })

  it('skips a tool_use block with no name', () => {
    expect(extractToolUses({ type: 'assistant', message: { content: [{ type: 'tool_use' }] } }))
      .toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run adapters/claude-code/tests/parse-line.test.ts`
Expected: FAIL — workspace does not exist

- [ ] **Step 3: Write minimal implementation**

Create `adapters/claude-code/package.json`:

```json
{
  "name": "@hountybunter/adapter-claude-code",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "dependencies": { "@hountybunter/core": "*" }
}
```

Create `adapters/claude-code/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist" },
  "include": ["src/**/*.ts"]
}
```

Create `adapters/claude-code/src/parse-line.ts`:

```ts
export type TranscriptRecord =
  | { ok: true; kind: string; raw: Record<string, unknown> }
  | { ok: false; reason: string }

/**
 * Parse one JSONL line. The transcript format is undocumented and may change,
 * so nothing here throws and no record type is rejected: an unrecognised type
 * is carried through with its payload intact.
 */
export function parseLine(line: string): TranscriptRecord {
  const trimmed = line.trim()
  if (!trimmed) return { ok: false, reason: 'empty line' }

  let value: unknown
  try {
    value = JSON.parse(trimmed)
  } catch (error) {
    return { ok: false, reason: `invalid JSON: ${(error as Error).message}` }
  }

  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, reason: 'line is not a JSON object' }
  }

  const raw = value as Record<string, unknown>
  const type = raw.type
  return { ok: true, kind: typeof type === 'string' && type ? type : 'unknown', raw }
}

/** Tool calls live in `message.content[]` blocks with `type: "tool_use"`. */
export function extractToolUses(raw: Record<string, unknown>): { name: string }[] {
  const message = raw.message
  if (message === null || typeof message !== 'object') return []
  const content = (message as Record<string, unknown>).content
  if (!Array.isArray(content)) return []

  return content.flatMap((block) => {
    if (block === null || typeof block !== 'object') return []
    const b = block as Record<string, unknown>
    if (b.type !== 'tool_use') return []
    const name = b.name
    if (typeof name !== 'string' || !name) return []
    return [{ name }]
  })
}
```

Create `adapters/claude-code/src/index.ts`:

```ts
export * from './parse-line.js'
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm install && npx vitest run adapters/claude-code/tests/parse-line.test.ts`
Expected: PASS — 9 tests

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(adapter): defensive transcript line parsing"
```

---

## Task 14: Locating transcripts and reading them incrementally

**Files:**
- Create: `adapters/claude-code/src/locate.ts`, `adapters/claude-code/src/cursor.ts`
- Modify: `adapters/claude-code/src/index.ts`
- Test: `adapters/claude-code/tests/locate.test.ts`, `adapters/claude-code/tests/cursor.test.ts`

**Interfaces:**
- Consumes: `openDb` (from `@hountybunter/core`)
- Produces:
  - `interface TranscriptFile { path: string; sessionId: string; projectDir: string }`
  - `transcriptRoot(env?): string`
  - `findTranscripts(env?): Promise<TranscriptFile[]>`
  - `interface ReadResult { lines: string[]; from: number; to: number }`
  - `readNewLines(db, path: string, nowIso: string): Promise<ReadResult>`

- [ ] **Step 1: Write the failing test**

Create `adapters/claude-code/tests/locate.test.ts`:

```ts
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { findTranscripts, transcriptRoot } from '../src/locate.js'

let env: NodeJS.ProcessEnv
let home: string

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'hb-cc-'))
  env = { HOME: home } as NodeJS.ProcessEnv
})

describe('transcriptRoot', () => {
  it('defaults to ~/.claude/projects', () => {
    expect(transcriptRoot({ HOME: '/home/x' } as NodeJS.ProcessEnv))
      .toBe('/home/x/.claude/projects')
  })

  it('honours an override', () => {
    expect(transcriptRoot({ HOUNTYBUNTER_TRANSCRIPTS: '/elsewhere' } as NodeJS.ProcessEnv))
      .toBe('/elsewhere')
  })
})

describe('findTranscripts', () => {
  it('returns an empty array when the root does not exist', async () => {
    expect(await findTranscripts(env)).toEqual([])
  })

  it('finds jsonl files and reads the session id from the filename', async () => {
    const dir = join(home, '.claude', 'projects', '-Users-kobe-proj')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jsonl'), '')

    const found = await findTranscripts(env)
    expect(found).toHaveLength(1)
    expect(found[0]?.sessionId).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')
    expect(found[0]?.projectDir).toBe('-Users-kobe-proj')
  })

  it('ignores non-jsonl files', async () => {
    const dir = join(home, '.claude', 'projects', '-p')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'notes.md'), '')
    expect(await findTranscripts(env)).toEqual([])
  })
})
```

Create `adapters/claude-code/tests/cursor.test.ts`:

```ts
import { appendFile, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { openDb } from '@hountybunter/core'
import { readNewLines } from '../src/cursor.js'

let db: ReturnType<typeof openDb>
let file: string
const NOW = '2026-08-27T00:00:00.000Z'

beforeEach(async () => {
  const home = await mkdtemp(join(tmpdir(), 'hb-'))
  db = openDb({ HOUNTYBUNTER_HOME: home } as NodeJS.ProcessEnv)
  file = join(home, 'transcript.jsonl')
})

describe('readNewLines', () => {
  it('reads everything on the first pass', async () => {
    await writeFile(file, 'a\nb\n')
    const result = await readNewLines(db, file, NOW)
    expect(result.lines).toEqual(['a', 'b'])
    expect(result.from).toBe(0)
  })

  it('reads nothing on a second pass over an unchanged file', async () => {
    await writeFile(file, 'a\nb\n')
    await readNewLines(db, file, NOW)
    expect((await readNewLines(db, file, NOW)).lines).toEqual([])
  })

  it('reads only the appended lines', async () => {
    await writeFile(file, 'a\n')
    await readNewLines(db, file, NOW)
    await appendFile(file, 'b\nc\n')
    expect((await readNewLines(db, file, NOW)).lines).toEqual(['b', 'c'])
  })

  it('restarts from zero if the file shrank', async () => {
    await writeFile(file, 'a\nb\nc\n')
    await readNewLines(db, file, NOW)
    await writeFile(file, 'x\n')
    expect((await readNewLines(db, file, NOW)).lines).toEqual(['x'])
  })

  it('does not consume a trailing partial line', async () => {
    await writeFile(file, 'a\nb\npartial')
    expect((await readNewLines(db, file, NOW)).lines).toEqual(['a', 'b'])
    await appendFile(file, '-now-complete\n')
    expect((await readNewLines(db, file, NOW)).lines).toEqual(['partial-now-complete'])
  })

  it('returns nothing for a file that does not exist', async () => {
    expect((await readNewLines(db, join(file, 'nope'), NOW)).lines).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run adapters/claude-code/tests/locate.test.ts adapters/claude-code/tests/cursor.test.ts`
Expected: FAIL — modules not found

- [ ] **Step 3: Write minimal implementation**

Create `adapters/claude-code/src/locate.ts`:

```ts
import { readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

export interface TranscriptFile {
  path: string
  sessionId: string
  projectDir: string
}

export function transcriptRoot(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.HOUNTYBUNTER_TRANSCRIPTS
  if (override) return override
  return join(env.HOME ?? homedir(), '.claude', 'projects')
}

export async function findTranscripts(
  env: NodeJS.ProcessEnv = process.env,
): Promise<TranscriptFile[]> {
  const root = transcriptRoot(env)
  let projectDirs: string[]
  try {
    const entries = await readdir(root, { withFileTypes: true })
    projectDirs = entries.filter((e) => e.isDirectory()).map((e) => e.name)
  } catch {
    return []
  }

  const files: TranscriptFile[] = []
  for (const projectDir of projectDirs.sort()) {
    let names: string[]
    try {
      names = (await readdir(join(root, projectDir))).filter((n) => n.endsWith('.jsonl'))
    } catch {
      continue
    }
    for (const name of names.sort()) {
      files.push({
        path: join(root, projectDir, name),
        sessionId: name.replace(/\.jsonl$/, ''),
        projectDir,
      })
    }
  }
  return files
}
```

Create `adapters/claude-code/src/cursor.ts`:

```ts
import type Database from 'better-sqlite3'
import { open, stat } from 'node:fs/promises'

export interface ReadResult {
  lines: string[]
  from: number
  to: number
}

/**
 * Read the bytes appended since the last call. A trailing line without a
 * newline is left unconsumed so a half-written record is never parsed; the
 * cursor advances only past complete lines.
 */
export async function readNewLines(
  db: Database.Database,
  path: string,
  nowIso: string,
): Promise<ReadResult> {
  let size: number
  try {
    size = (await stat(path)).size
  } catch {
    return { lines: [], from: 0, to: 0 }
  }

  const row = db
    .prepare('SELECT byte_offset FROM ingest_cursors WHERE file_path = ?')
    .get(path) as { byte_offset: number } | undefined

  // A file that shrank was truncated or replaced; the old offset is meaningless.
  let from = row?.byte_offset ?? 0
  if (from > size) from = 0
  if (from === size) return { lines: [], from, to: size }

  const handle = await open(path, 'r')
  let text: string
  try {
    const buffer = Buffer.alloc(size - from)
    await handle.read(buffer, 0, buffer.length, from)
    text = buffer.toString('utf8')
  } finally {
    await handle.close()
  }

  const lastNewline = text.lastIndexOf('\n')
  const complete = lastNewline === -1 ? '' : text.slice(0, lastNewline)
  const consumed = lastNewline === -1 ? 0 : Buffer.byteLength(complete, 'utf8') + 1
  const to = from + consumed

  db.prepare(
    `INSERT INTO ingest_cursors (file_path, byte_offset, last_seen_at)
     VALUES (?, ?, ?)
     ON CONFLICT(file_path) DO UPDATE SET
       byte_offset = excluded.byte_offset, last_seen_at = excluded.last_seen_at`,
  ).run(path, to, nowIso)

  return { lines: complete.split('\n').filter((l) => l.length > 0), from, to }
}
```

Replace `adapters/claude-code/src/index.ts`:

```ts
export * from './parse-line.js'
export * from './locate.js'
export * from './cursor.js'
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run adapters/claude-code/tests/`
Expected: PASS — 15 tests

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(adapter): locate transcripts and read them incrementally by byte offset"
```

---

## Task 15: Ingesting transcripts into sessions and activities

**Files:**
- Create: `adapters/claude-code/src/ingest.ts`
- Create: `adapters/claude-code/tests/fixtures/session-basic.jsonl`
- Create: `adapters/claude-code/tests/fixtures/session-damaged.jsonl`
- Modify: `adapters/claude-code/src/index.ts`
- Test: `adapters/claude-code/tests/ingest.test.ts`

**Interfaces:**
- Consumes: `findTranscripts`, `readNewLines`, `parseLine`, `extractToolUses`,
  `projectSlug`
- Produces:
  - `interface IngestReport { sessions: number; activities: number; skippedLines: number; unknownKinds: Record<string, number> }`
  - `ingestAll(db, env?, nowIso?): Promise<IngestReport>`

Activities get a per-session `seq`; combined with `UNIQUE (session_id, seq)`
from Task 7 this makes re-ingest idempotent.

- [ ] **Step 1: Write the failing test**

Create `adapters/claude-code/tests/fixtures/session-basic.jsonl`:

```
{"type":"user","cwd":"/Users/x/proj","gitBranch":"main","timestamp":"2026-08-27T10:00:00.000Z"}
{"type":"assistant","cwd":"/Users/x/proj","gitBranch":"main","effort":"high","aiTitle":"Fix the parser","timestamp":"2026-08-27T10:00:05.000Z","message":{"content":[{"type":"tool_use","name":"Bash"}]}}
{"type":"assistant","cwd":"/Users/x/proj","attributionSkill":"superpowers:brainstorming","timestamp":"2026-08-27T10:00:09.000Z","message":{"content":[{"type":"tool_use","name":"Write"}]}}
{"type":"system","cwd":"/Users/x/proj","timestamp":"2026-08-27T10:00:12.000Z"}
```

Create `adapters/claude-code/tests/fixtures/session-damaged.jsonl`:

```
{"type":"user","cwd":"/Users/x/proj","timestamp":"2026-08-27T11:00:00.000Z"}
{ this line is not valid json
{"type":"brand-new-record-type","cwd":"/Users/x/proj","payload":{"a":1}}
42
{"type":"assistant","cwd":"/Users/x/proj","timestamp":"2026-08-27T11:00:03.000Z","message":{"content":[{"type":"tool_use","name":"Read"}]}}
```

Create `adapters/claude-code/tests/ingest.test.ts`:

```ts
import { cp, mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it } from 'vitest'
import { openDb } from '@hountybunter/core'
import { ingestAll } from '../src/ingest.js'

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')
const NOW = '2026-08-27T12:00:00.000Z'

let db: ReturnType<typeof openDb>
let env: NodeJS.ProcessEnv

async function stage(fixture: string, sessionId: string) {
  const dir = join(env.HOUNTYBUNTER_TRANSCRIPTS!, '-Users-x-proj')
  await mkdir(dir, { recursive: true })
  await cp(join(FIXTURES, fixture), join(dir, `${sessionId}.jsonl`))
}

beforeEach(async () => {
  const home = await mkdtemp(join(tmpdir(), 'hb-'))
  env = {
    HOUNTYBUNTER_HOME: home,
    HOUNTYBUNTER_TRANSCRIPTS: join(home, 'transcripts'),
  } as NodeJS.ProcessEnv
  db = openDb(env)
})

describe('ingestAll', () => {
  it('creates a session and its activities', async () => {
    await stage('session-basic.jsonl', 'aaaa-1111')
    const report = await ingestAll(db, env, NOW)

    expect(report.sessions).toBe(1)
    expect(report.activities).toBe(4)
    expect(report.skippedLines).toBe(0)

    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get('aaaa-1111') as Record<string, unknown>
    expect(session.branch).toBe('main')
    expect(session.effort).toBe('high')
    expect(session.title).toBe('Fix the parser')
    expect(session.started_at).toBe('2026-08-27T10:00:00.000Z')
    expect(session.ended_at).toBe('2026-08-27T10:00:12.000Z')
  })

  it('records tool names and skill attribution', async () => {
    await stage('session-basic.jsonl', 'aaaa-1111')
    await ingestAll(db, env, NOW)

    expect(db.prepare('SELECT tool_name FROM activities WHERE tool_name IS NOT NULL ORDER BY seq').all())
      .toEqual([{ tool_name: 'Bash' }, { tool_name: 'Write' }])
    expect(db.prepare('SELECT attr_skill FROM activities WHERE attr_skill IS NOT NULL').get())
      .toEqual({ attr_skill: 'superpowers:brainstorming' })
  })

  it('derives the project from cwd', async () => {
    await stage('session-basic.jsonl', 'aaaa-1111')
    await ingestAll(db, env, NOW)
    const row = db.prepare('SELECT project FROM sessions WHERE id = ?').get('aaaa-1111') as { project: string }
    expect(row.project).toMatch(/^proj-[0-9a-f]{6}$/)
  })

  it('survives malformed lines and keeps unknown record types', async () => {
    await stage('session-damaged.jsonl', 'bbbb-2222')
    const report = await ingestAll(db, env, NOW)

    expect(report.skippedLines).toBe(2)
    expect(report.unknownKinds['brand-new-record-type']).toBe(1)

    const kinds = db
      .prepare('SELECT kind FROM activities WHERE session_id = ? ORDER BY seq')
      .all('bbbb-2222')
      .map((r) => (r as { kind: string }).kind)
    expect(kinds).toContain('brand-new-record-type')

    const payload = db
      .prepare("SELECT payload_json FROM activities WHERE kind = 'brand-new-record-type'")
      .get() as { payload_json: string }
    expect(JSON.parse(payload.payload_json).payload).toEqual({ a: 1 })
  })

  it('is idempotent — a second run adds nothing', async () => {
    await stage('session-basic.jsonl', 'aaaa-1111')
    await ingestAll(db, env, NOW)
    const report = await ingestAll(db, env, NOW)

    expect(report.activities).toBe(0)
    expect(db.prepare('SELECT COUNT(*) c FROM activities').get()).toEqual({ c: 4 })
  })

  it('handles an empty transcript root', async () => {
    expect(await ingestAll(db, env, NOW))
      .toEqual({ sessions: 0, activities: 0, skippedLines: 0, unknownKinds: {} })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run adapters/claude-code/tests/ingest.test.ts`
Expected: FAIL — "Cannot find module '../src/ingest.js'"

- [ ] **Step 3: Write minimal implementation**

Create `adapters/claude-code/src/ingest.ts`:

```ts
import type Database from 'better-sqlite3'
import { projectSlug } from '@hountybunter/core'
import { readNewLines } from './cursor.js'
import { findTranscripts } from './locate.js'
import { extractToolUses, parseLine } from './parse-line.js'

export interface IngestReport {
  sessions: number
  activities: number
  skippedLines: number
  unknownKinds: Record<string, number>
}

/** Record types we recognise. Anything else is kept and counted, not dropped. */
const KNOWN_KINDS = new Set([
  'user', 'assistant', 'attachment', 'system',
  'file-history-snapshot', 'queue-operation',
])

function str(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null
}

export async function ingestAll(
  db: Database.Database,
  env: NodeJS.ProcessEnv = process.env,
  nowIso: string = new Date().toISOString(),
): Promise<IngestReport> {
  const report: IngestReport = { sessions: 0, activities: 0, skippedLines: 0, unknownKinds: {} }

  const upsertSession = db.prepare(
    `INSERT INTO sessions (id, project, started_at, ended_at, branch, model, effort, title, correlation)
     VALUES (@id, @project, @started_at, @ended_at, @branch, @model, @effort, @title, 'exact')
     ON CONFLICT(id) DO UPDATE SET
       project    = COALESCE(excluded.project, sessions.project),
       started_at = COALESCE(sessions.started_at, excluded.started_at),
       ended_at   = COALESCE(excluded.ended_at, sessions.ended_at),
       branch     = COALESCE(excluded.branch, sessions.branch),
       model      = COALESCE(excluded.model, sessions.model),
       effort     = COALESCE(excluded.effort, sessions.effort),
       title      = COALESCE(excluded.title, sessions.title)`,
  )

  const insertActivity = db.prepare(
    `INSERT INTO activities (session_id, seq, ts, kind, tool_name, attr_skill, attr_plugin, payload_json)
     VALUES (@session_id, @seq, @ts, @kind, @tool_name, @attr_skill, @attr_plugin, @payload_json)
     ON CONFLICT(session_id, seq) DO NOTHING`,
  )

  const maxSeq = db.prepare('SELECT COALESCE(MAX(seq), 0) AS m FROM activities WHERE session_id = ?')

  for (const file of await findTranscripts(env)) {
    const { lines } = await readNewLines(db, file.path, nowIso)
    if (lines.length === 0) continue

    let seq = (maxSeq.get(file.sessionId) as { m: number }).m
    let project: string | null = null
    let startedAt: string | null = null
    let endedAt: string | null = null
    let branch: string | null = null
    let model: string | null = null
    let effort: string | null = null
    let title: string | null = null
    let added = 0

    db.transaction(() => {
      for (const line of lines) {
        const record = parseLine(line)
        if (!record.ok) {
          report.skippedLines += 1
          continue
        }

        const raw = record.raw
        const cwd = str(raw.cwd)
        if (cwd && !project) project = projectSlug(cwd)
        branch ??= str(raw.gitBranch)
        model ??= str(raw.model)
        effort ??= str(raw.effort)
        title ??= str(raw.aiTitle)

        const ts = str(raw.timestamp)
        if (ts) {
          startedAt ??= ts
          endedAt = ts
        }

        if (!KNOWN_KINDS.has(record.kind)) {
          report.unknownKinds[record.kind] = (report.unknownKinds[record.kind] ?? 0) + 1
        }

        const tools = extractToolUses(raw)
        const common = {
          session_id: file.sessionId,
          ts,
          kind: record.kind,
          attr_skill: str(raw.attributionSkill),
          attr_plugin: str(raw.attributionPlugin),
          payload_json: JSON.stringify(raw),
        }

        seq += 1
        added += insertActivity.run({ ...common, seq, tool_name: tools[0]?.name ?? null }).changes

        // A record can carry more than one tool_use block; each gets its own row.
        for (const tool of tools.slice(1)) {
          seq += 1
          added += insertActivity.run({ ...common, seq, tool_name: tool.name }).changes
        }
      }

      upsertSession.run({
        id: file.sessionId,
        project: project ?? projectSlug(file.projectDir),
        started_at: startedAt,
        ended_at: endedAt,
        branch,
        model,
        effort,
        title,
      })
    })()

    report.sessions += 1
    report.activities += added
  }

  return report
}
```

Append to `adapters/claude-code/src/index.ts`:

```ts
export * from './ingest.js'
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run adapters/claude-code/tests/ingest.test.ts`
Expected: PASS — 6 tests

Note for the implementer: on the second run the cursor from Task 14 returns zero
new lines, so the loop `continue`s before touching the database. That is why the
idempotency test expects both `report.activities` and `report.sessions` to be
`0` rather than re-counting the file.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(adapter): ingest transcripts into sessions and activities, idempotently"
```

---

## Task 16: The CLI

**Files:**
- Create: `surfaces/cli/package.json`, `surfaces/cli/tsconfig.json`
- Create: `surfaces/cli/src/bin.ts`, `surfaces/cli/src/cli.ts`
- Test: `surfaces/cli/tests/cli.test.ts`

**Interfaces:**
- Consumes: `appendJot`, `readJots`, `promoteJot`, `openDb`, `searchNotes`,
  `listNotes`, `rebuildFromDisk`, `snapshotState`, `projectSlug`, `ingestAll`
- Produces:
  - `interface Io { out(line: string): void; err(line: string): void; env: NodeJS.ProcessEnv; cwd: string }`
  - `runCli(argv: string[], io: Io): Promise<number>` — returns an exit code

`runCli` takes its output channel and environment as arguments so the whole CLI
is testable in-process, with no subprocess spawning and no writes outside a
temporary directory.

- [ ] **Step 1: Write the failing test**

Create `surfaces/cli/tests/cli.test.ts`:

```ts
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { runCli, type Io } from '../src/bin.js'

let out: string[]
let err: string[]
let io: Io

beforeEach(async () => {
  const home = await mkdtemp(join(tmpdir(), 'hb-'))
  out = []
  err = []
  io = {
    out: (l) => out.push(l),
    err: (l) => err.push(l),
    env: { HOUNTYBUNTER_HOME: home, HOUNTYBUNTER_TZ: 'UTC' } as NodeJS.ProcessEnv,
    cwd: '/Users/x/myproject',
  }
})

describe('hb jot', () => {
  it('captures a line and reports where it went', async () => {
    expect(await runCli(['jot', 'chose', 'SQLite', 'over', 'Postgres'], io)).toBe(0)
    expect(out.join('\n')).toMatch(/jotted/i)
  })

  it('fails with a message when given no text', async () => {
    expect(await runCli(['jot'], io)).toBe(1)
    expect(err.join('\n')).toMatch(/text/i)
  })
})

describe('hb promote', () => {
  it('turns jot 1 into a note', async () => {
    await runCli(['jot', 'chose', 'SQLite'], io)
    expect(await runCli(['promote', '1', '--question', 'Which database?', '--chosen', 'SQLite'], io))
      .toBe(0)
    expect(out.join('\n')).toMatch(/which-database/)
  })

  it('rejects a jot number that does not exist', async () => {
    expect(await runCli(['promote', '9', '--question', 'q', '--chosen', 'c'], io)).toBe(1)
    expect(err.join('\n')).toMatch(/no jot/i)
  })

  it('requires --question and --chosen', async () => {
    await runCli(['jot', 'anything'], io)
    expect(await runCli(['promote', '1', '--question', 'q'], io)).toBe(1)
    expect(err.join('\n')).toMatch(/chosen/)
  })
})

describe('hb search and list', () => {
  it('finds a promoted note', async () => {
    await runCli(['jot', 'chose SQLite because it is a file'], io)
    await runCli(['promote', '1', '--question', 'Which database?', '--chosen', 'SQLite'], io)
    await runCli(['rebuild'], io)

    out.length = 0
    expect(await runCli(['search', 'database'], io)).toBe(0)
    expect(out.join('\n')).toMatch(/Which database\?/)
  })

  it('says so plainly when nothing matches', async () => {
    await runCli(['rebuild'], io)
    out.length = 0
    expect(await runCli(['search', 'kubernetes'], io)).toBe(0)
    expect(out.join('\n')).toMatch(/no matches/i)
  })

  it('lists notes', async () => {
    await runCli(['jot', 'anything'], io)
    await runCli(['promote', '1', '--question', 'Which cache?', '--chosen', 'Redis'], io)
    await runCli(['rebuild'], io)

    out.length = 0
    expect(await runCli(['list'], io)).toBe(0)
    expect(out.join('\n')).toMatch(/Which cache\?/)
  })
})

describe('hb rebuild', () => {
  it('reports how many notes were indexed', async () => {
    await runCli(['jot', 'anything'], io)
    await runCli(['promote', '1', '--question', 'q', '--chosen', 'c'], io)
    out.length = 0
    expect(await runCli(['rebuild'], io)).toBe(0)
    expect(out.join('\n')).toMatch(/1 note/)
  })

  it('--verify confirms a second rebuild is identical', async () => {
    await runCli(['jot', 'anything'], io)
    await runCli(['promote', '1', '--question', 'q', '--chosen', 'c'], io)
    out.length = 0
    expect(await runCli(['rebuild', '--verify'], io)).toBe(0)
    expect(out.join('\n')).toMatch(/identical/i)
  })
})

describe('dispatch', () => {
  it('prints usage and exits non-zero for an unknown command', async () => {
    expect(await runCli(['fly'], io)).toBe(1)
    expect(err.join('\n')).toMatch(/usage/i)
  })

  it('prints usage for no arguments', async () => {
    expect(await runCli([], io)).toBe(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run surfaces/cli/tests/cli.test.ts`
Expected: FAIL — workspace does not exist

- [ ] **Step 3: Write minimal implementation**

Create `surfaces/cli/package.json`:

```json
{
  "name": "@hountybunter/cli",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "bin": { "hb": "./src/cli.ts" },
  "dependencies": {
    "@hountybunter/core": "*",
    "@hountybunter/adapter-claude-code": "*"
  }
}
```

Create `surfaces/cli/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist" },
  "include": ["src/**/*.ts"]
}
```

Create `surfaces/cli/src/bin.ts`:

```ts
import { parseArgs } from 'node:util'
import {
  appendJot,
  listNotes,
  openDb,
  projectSlug,
  promoteJot,
  readJots,
  rebuildFromDisk,
  searchNotes,
  snapshotState,
} from '@hountybunter/core'
import { ingestAll } from '@hountybunter/adapter-claude-code'

export interface Io {
  out(line: string): void
  err(line: string): void
  env: NodeJS.ProcessEnv
  cwd: string
}

const USAGE = `usage: hb <command>

  jot <text...>                       capture one line for the current project
  promote <n> --question Q --chosen C [--title T]
  search <query> [--project P] [--limit N]
  list [--project P] [--status S] [--limit N]
  ingest                              read new Claude Code transcript lines
  rebuild [--verify]                  rebuild the index from disk`

export async function runCli(argv: string[], io: Io): Promise<number> {
  const [command, ...rest] = argv
  switch (command) {
    case 'jot': return cmdJot(rest, io)
    case 'promote': return cmdPromote(rest, io)
    case 'search': return cmdSearch(rest, io)
    case 'list': return cmdList(rest, io)
    case 'ingest': return cmdIngest(io)
    case 'rebuild': return cmdRebuild(rest, io)
    default:
      io.err(USAGE)
      return 1
  }
}

async function cmdJot(args: string[], io: Io): Promise<number> {
  const text = args.join(' ').trim()
  if (!text) {
    io.err('hb jot: needs some text')
    return 1
  }
  const jot = await appendJot(
    { project: projectSlug(io.cwd), text },
    { env: io.env, timeZone: io.env.HOUNTYBUNTER_TZ },
  )
  io.out(`jotted #${jot.line} into ${jot.date} for ${jot.project}`)
  return 0
}

async function cmdPromote(args: string[], io: Io): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      question: { type: 'string' },
      chosen: { type: 'string' },
      title: { type: 'string' },
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

  const jots = await readJots({ env: io.env })
  const jot = jots[Number(positionals[0]) - 1]
  if (!jot) {
    io.err(`hb promote: no jot #${positionals[0] ?? ''}`)
    return 1
  }

  const note = await promoteJot(
    jot,
    { question: values.question, chosen: values.chosen, title: values.title },
    { env: io.env, timeZone: io.env.HOUNTYBUNTER_TZ },
  )
  io.out(`wrote ${note.id}`)
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
      limit: values.limit ? Number(values.limit) : undefined,
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
      limit: values.limit ? Number(values.limit) : undefined,
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
    const report = await ingestAll(db, io.env)
    io.out(`ingested ${report.activities} activities from ${report.sessions} sessions`)
    if (report.skippedLines > 0) io.out(`skipped ${report.skippedLines} malformed lines`)
    for (const [kind, count] of Object.entries(report.unknownKinds)) {
      io.out(`unknown record type "${kind}" x${count} (kept with payload)`)
    }
    return 0
  } finally {
    db.close()
  }
}

async function cmdRebuild(args: string[], io: Io): Promise<number> {
  const { values } = parseArgs({ args, options: { verify: { type: 'boolean' } } })

  const report = await rebuildFromDisk(io.env)
  io.out(`indexed ${report.notesIndexed} note${report.notesIndexed === 1 ? '' : 's'}`)
  for (const error of report.errors) {
    io.err(`could not read ${error.sourcePath}: ${error.message}`)
  }

  if (values.verify) {
    const first = snapshotState(openDb(io.env))
    await rebuildFromDisk(io.env)
    const second = snapshotState(openDb(io.env))
    if (first !== second) {
      io.err('rebuild is not deterministic — state differed between runs')
      return 1
    }
    io.out('verified: a second rebuild produced identical state')
  }
  return 0
}
```

Create `surfaces/cli/src/cli.ts`:

```ts
#!/usr/bin/env node
import { runCli } from './bin.js'

const code = await runCli(process.argv.slice(2), {
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
  env: process.env,
  cwd: process.cwd(),
})
process.exit(code)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm install && npx vitest run surfaces/cli/tests/cli.test.ts`
Expected: PASS — 11 tests

Then the whole suite under two opposed timezones:

Run: `npm test`
Run: `TZ=Pacific/Kiritimati npm test`
Run: `TZ=Pacific/Niue npm test`
Expected: PASS all three, identical counts

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(cli): jot, promote, search, list, ingest, rebuild"
```

---

## Task 17: Seed notes, README, and the phase gate

**Files:**
- Create: `core/tests/fixtures/seed/` — five `.md` notes
- Create: `README.md`
- Test: `core/tests/seed.test.ts`

**Interfaces:**
- Consumes: `rebuildFromDisk`, `openDb`, `searchNotes`
- Produces: nothing new; this task proves the phase works on real content

Spec §15 decided against a bulk import from the existing `memory/` files and in
favour of five records rewritten by hand, because the originals lack `rejected`
and `evidence` — the fields that carry the value. These five double as
realistic fixtures.

- [ ] **Step 1: Write the failing test**

Create `core/tests/seed.test.ts`:

```ts
import { cp, mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { openDb } from '../src/db/open.js'
import { searchNotes } from '../src/db/query.js'
import { rebuildFromDisk } from '../src/rebuild.js'

const SEED = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'seed')

describe('seed notes', () => {
  it('all five parse, index, and are searchable by their rejected reasoning', async () => {
    const home = await mkdtemp(join(tmpdir(), 'hb-'))
    const env = { HOUNTYBUNTER_HOME: home } as NodeJS.ProcessEnv
    const dest = join(home, 'notes', 'tnm-dms-000000')
    await mkdir(dest, { recursive: true })
    await cp(SEED, dest, { recursive: true })

    const report = await rebuildFromDisk(env)
    expect(report.errors).toEqual([])
    expect(report.notesIndexed).toBe(5)

    const db = openDb(env)
    // Each word appears only inside a rejected option's why_not.
    expect(searchNotes(db, 'idempotency')).not.toEqual([])
    expect(searchNotes(db, 'grep')).not.toEqual([])
    db.close()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run core/tests/seed.test.ts`
Expected: FAIL — fixtures directory does not exist

- [ ] **Step 3: Write minimal implementation**

`core/tests/fixtures/seed/2026-08-12-offline-reads.md`:

```markdown
---
id: 2026-08-12-offline-reads
title: Offline reads for the field sales PWA
project: tnm-dms-000000
kind: decision
status: standing
decided_on: 2026-08-12
question: How do field sales reps keep working through network gaps?
chosen: TanStack Query v5 with an idb-keyval persister
rejected:
  - option: A full offline sync engine with a mutation queue
    why_not: >-
      Needs idempotency keys and conflict resolution. Field gaps last one to
      three minutes, not hours, so the cost is never repaid.
  - option: Service worker cache only
    why_not: >-
      Caches responses, not query state, so list screens still flash empty on
      reload.
evidence:
  - kind: file
    ref: src/lib/query/persister.ts
confidence: high
---

Reads are cached and persisted; writes still require connectivity. Step one
deliberately skips idempotency because no write is replayed.
```

`core/tests/fixtures/seed/2026-08-20-graph-tool-rejected.md`:

```markdown
---
id: 2026-08-20-graph-tool-rejected
title: Code-graph tooling evaluated and rejected
project: tnm-dms-000000
kind: decision
status: standing
decided_on: 2026-08-20
question: Is a code-graph indexer worth adding to the workflow?
chosen: No indexer; plain grep and ripgrep
rejected:
  - option: A code-graph indexing tool
    why_not: >-
      A short grep reproduced the only output that had value, and the tool
      removed directories without saying so.
confidence: high
---

The valuable output was a list of call sites, which search already produces.
```

`core/tests/fixtures/seed/2026-07-30-debt-aging-model.md`:

```markdown
---
id: 2026-07-30-debt-aging-model
title: How overdue debt is calculated
project: tnm-dms-000000
kind: decision
status: standing
decided_on: 2026-07-30
question: How should overdue receivables be aged?
chosen: Match the accounting system — age by debt key with offsetting applied
rejected:
  - option: FIFO allocation of payments against invoices
    why_not: >-
      It disagreed with the accounting system's own ageing, which made
      reconciliation impossible; two numbers with no way to explain the gap.
confidence: high
---

FIFO still has a use, but as a separate "what to collect" view, not as the
system of record for what is overdue.
```

`core/tests/fixtures/seed/2026-08-05-timezone-pinning.md`:

```markdown
---
id: 2026-08-05-timezone-pinning
title: Timezone for server-side date calculations
project: tnm-dms-000000
kind: decision
status: standing
decided_on: 2026-08-05
question: Which timezone do server-side date calculations use?
chosen: Pin UTC+7 explicitly; local-time getters are banned
rejected:
  - option: Rely on the server's local timezone
    why_not: >-
      The development machine and the users are eleven to fourteen hours apart,
      so the bug is invisible to the people who would notice it and appears only
      on the developer's machine.
confidence: high
---

Tests must run under more than one TZ, or the ban is unenforced.
```

`core/tests/fixtures/seed/2026-08-08-encoded-customer-id.md`:

```markdown
---
id: 2026-08-08-encoded-customer-id
title: Customer ids arrive encoded and must be decoded in the route
project: tnm-dms-000000
kind: gotcha
status: standing
decided_on: 2026-08-08
question: Why did check-in return 500 with no error message?
chosen: Decode the customer id in the route before it reaches SQL
rejected:
  - option: Pass the id through unchanged
    why_not: >-
      The encoded form produced a SQL error that surfaced only as a silent 500,
      with nothing in the response to point at the cause.
confidence: high
---

The failure had no message anywhere in the response, which is why it took so
long to find.
```

Create `README.md`:

```markdown
# hountybunter

A bounty board for your AI agents, and a field guide to why you built it that way.

**Status: early. Phases 1-3 are implemented — the command-line knowledge store
and Claude Code transcript ingest. No UI yet.**

## What it does today

    hb jot chose SQLite over Postgres because the file outlives the tool
    hb promote 1 --question "Which database?" --chosen "SQLite"
    hb search idempotency
    hb list --status standing
    hb ingest
    hb rebuild --verify

Notes are markdown files under `~/.hountybunter/notes/`. The SQLite index is
derived and disposable: delete it, run `hb rebuild`, and nothing is lost.

## Requirements

Node 20 or later.

## Design

See [the design spec](docs/superpowers/specs/2026-08-27-hountybunter-design.md).
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run core/tests/seed.test.ts`
Expected: PASS — 1 test

Then the phase gate:

Run: `npm test && npm run typecheck`
Run: `TZ=Pacific/Kiritimati npm test`
Expected: PASS, all suites

Then confirm it works on this machine's real data:

Run: `node --experimental-strip-types surfaces/cli/src/cli.ts ingest`
Expected: a non-zero activity count from the existing transcripts, with any
malformed lines reported rather than crashing

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: seed notes, README, and phase 1-3 gate"
```

---

## Self-Review

**Spec coverage.** Every phase 1–3 requirement maps to a task: markdown store
and `notes/<slug>/` layout (Tasks 2, 6); required fields limited to `question`
and `chosen` (Task 4); two-tier capture (Tasks 11, 12); `better-sqlite3` with
FTS5 (Task 7); disposable index and `rebuild-from-scratch` (Task 10); defensive
transcript parsing with unknown types kept and malformed lines counted (Tasks
13, 15); byte-offset incremental reads (Task 14); idempotent ingest (Task 15);
CLI (Task 16); multi-timezone runs (Tasks 3, 11, 16); hand-written seed notes
rather than a bulk import (Task 17).

Deliberately not covered, as scoped: hooks, HTTP, PTY, web UI, pixels,
bounties, staleness verification, Agent SDK. `note_evidence` is written in Task
8 but never verified against disk — verification is phase 8.

**Placeholder scan.** None. Every code step contains runnable code, and all
five seed notes in Task 17 are written out in full.

**Type consistency.** `Note`, `RejectedOption`, and `Evidence` are defined once
in Task 4 and unchanged afterwards. `NoteHit` (Task 9) is the single return
shape for both `searchNotes` and `listNotes`. `JotOpts` (Task 11) is reused by
`promoteJot` (Task 12). `openDb` returns `Database.Database` everywhere.
`snapshotState` closes the database it is given, which is why every caller
passes a fresh `openDb(env)` — stated in Task 10's interface block and honoured
in Task 16's `cmdRebuild`.
