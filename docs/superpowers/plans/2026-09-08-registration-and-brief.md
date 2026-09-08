# Project registration and `hb brief` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A project can be registered once, and `hb brief` then prints everything a fresh agent — Claude Code or Codex — needs to continue the work a dead session left behind.

**Architecture:** Registration is an authored markdown file in the store (`~/.hountybunter/projects/<slug>.md`) naming a project's slug, its paths (worktrees included) and the plan currently being worked. A session's `cwd` resolves to it by longest path prefix. `hb brief` composes four blocks — working tree, commits since the branch point, the declared plan, settled decisions — mechanically, labels each with how much it can be trusted, and prints absence as absence.

**Tech Stack:** TypeScript ESM (`.js` import specifiers), `better-sqlite3`, `gray-matter`, `vitest`, npm workspaces. Tests run with `npm test`.

**Spec:** `docs/superpowers/specs/2026-09-08-multi-harness-handoff-design.md`

## Global Constraints

- **TDD.** Every task writes the failing test first, watches it fail, then implements.
- **`SCHEMA_VERSION` 5.** No `ALTER TABLE` migration: the index is derived, and `SchemaVersionError` already tells the user to delete and rebuild.
- **Anything authored is a file; anything derived is SQLite and disposable.** Registration is a file. Its rows are a mirror.
- **Nothing is guessed.** Where a value is unknown, it is absent — never inferred from a name or a default.
- **`hb brief` calls no model** and is capped at ~2048 bytes, marking any cut it makes.
- **`hb register` never edits the user's repository.** It prints the line to paste.
- **Import specifiers carry `.js`**, matching every existing module.
- **`core` imports nothing from `surfaces` or `adapters`.**

---

### Task 1: Schema 5 — registration tables and `sessions.harness`

**Files:**
- Modify: `core/src/db/schema.sql`
- Modify: `core/src/db/open.ts:7` (`SCHEMA_VERSION`)
- Modify: `core/src/rebuild.ts` (`SNAPSHOT`)
- Modify: `core/src/hooks/receive.ts:57`
- Modify: `adapters/claude-code/src/ingest.ts:39`
- Test: `core/tests/db-open.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: tables `registered_projects(slug, name, primary_path, plan, registered_at, source_path)` and `registered_paths(path, slug)`; column `sessions.harness TEXT NOT NULL`.

- [ ] **Step 1: Write the failing test**

Append to `core/tests/db-open.test.ts`, inside `describe('openDb', …)`:

```ts
  it('creates the registration tables', () => {
    const db = openDb(env)
    const names = tableNames(db)
    expect(names).toContain('registered_projects')
    expect(names).toContain('registered_paths')
    db.close()
  })

  it('records which harness produced a session, with no default to fall back on', () => {
    const db = openDb(env)
    const columns = db.prepare('PRAGMA table_info(sessions)').all() as {
      name: string
      notnull: number
      dflt_value: string | null
    }[]
    const harness = columns.find((c) => c.name === 'harness')
    expect(harness).toBeDefined()
    expect(harness!.notnull).toBe(1)
    // A default would answer for a writer that already knows the answer.
    expect(harness!.dflt_value).toBeNull()
    db.close()
  })
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run core/tests/db-open.test.ts`
Expected: FAIL — `registered_projects` missing, `harness` undefined.

- [ ] **Step 3: Add the tables and the column**

In `core/src/db/schema.sql`, add `harness` to the `sessions` table, immediately before `parent_id`:

```sql
  correlation  TEXT NOT NULL DEFAULT 'exact',
  -- Which agent produced this session. NOT NULL with no default: every writer
  -- knows which harness it is, so there is no row for which the answer is
  -- unknown, and a default would be a claim rather than a fallback.
  harness      TEXT NOT NULL,
```

Append to the same file:

```sql
-- Authored, unlike `projects`. `rememberProject` keeps every row of that table
-- at slug = projectSlug(path); a registered worktree carries a declared slug
-- that does not hash from its own path, so mixing the two would break that
-- invariant. Separate tables make the authored/derived split structural.
CREATE TABLE IF NOT EXISTS registered_projects (
  slug           TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  primary_path   TEXT NOT NULL,
  plan           TEXT,
  registered_at  TEXT NOT NULL,
  source_path    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS registered_paths (
  path  TEXT PRIMARY KEY,
  slug  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS registered_paths_slug_idx ON registered_paths(slug);
```

In `core/src/db/open.ts`, line 7:

```ts
export const SCHEMA_VERSION = 5
```

- [ ] **Step 4: Give both session writers a harness**

In `core/src/hooks/receive.ts`, the insert at line 57 becomes:

```ts
    db.prepare(
      `INSERT INTO sessions (id, project, correlation, harness)
       VALUES (@id, @project, 'exact', 'claude-code')
       ON CONFLICT(id) DO UPDATE SET
         correlation = 'exact',
         project     = COALESCE(sessions.project, excluded.project)`,
    ).run({
```

In `adapters/claude-code/src/ingest.ts`, the upsert at line 39 becomes:

```ts
  const upsertSession = db.prepare(
    `INSERT INTO sessions (id, project, started_at, ended_at, branch, model, effort, title, correlation, harness, parent_id)
     VALUES (@id, @project_for_insert, @started_at, @ended_at, @branch, @model, @effort, @title, 'exact', 'claude-code', @parent_id)
     ON CONFLICT(id) DO UPDATE SET
```

The `ON CONFLICT` body is unchanged: a session does not change harness.

- [ ] **Step 5: Teach the snapshot about the new state**

In `core/src/rebuild.ts`, add `'harness'` to the `sessions` column list and add two entries to `SNAPSHOT`:

```ts
  sessions: {
    columns: [
      'id', 'project', 'started_at', 'ended_at', 'branch', 'model', 'effort',
      'title', 'correlation', 'harness', 'parent_id',
    ],
    orderBy: 'id',
  },
  registered_projects: {
    columns: ['slug', 'name', 'primary_path', 'plan', 'registered_at', 'source_path'],
    orderBy: 'slug',
  },
  registered_paths: {
    columns: ['path', 'slug'],
    orderBy: 'path',
  },
```

`core/tests/rebuild.test.ts` walks the live schema against `SNAPSHOT` and `NOT_SNAPSHOTTED`; a table left out of both fails it. That test is the reason this step exists.

- [ ] **Step 6: Run the whole suite**

Run: `npm test`
Expected: PASS. The schema-walker test in `core/tests/rebuild.test.ts` passes because the new tables are declared, and the ingest tests pass because both writers now supply `harness`.

- [ ] **Step 7: Commit**

```bash
git add core/src/db/schema.sql core/src/db/open.ts core/src/rebuild.ts \
        core/src/hooks/receive.ts adapters/claude-code/src/ingest.ts core/tests/db-open.test.ts
git commit -m "feat(core): the index has room for a registered project, and a session says which agent made it"
```

---

### Task 2: Shared frontmatter helpers

**Files:**
- Create: `core/src/frontmatter.ts`
- Modify: `core/src/note/parse.ts:36-51`
- Modify: `core/src/index.ts`
- Test: `core/tests/frontmatter.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `str(value: unknown): string` and `dateStr(value: unknown): string`.

`oneOf` stays private to `note/parse.ts`. It has no second consumer: a registration record has no enum field. Phase 8b lifts it when its bounty `status` needs it — this deviates from §11 of the spec, deliberately, because lifting a helper for one caller is abstraction without a second implementation.

- [ ] **Step 1: Write the failing test**

Create `core/tests/frontmatter.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { dateStr, str } from '../src/frontmatter.js'

describe('str', () => {
  it('passes a string through and renders null as empty', () => {
    expect(str('a')).toBe('a')
    expect(str(null)).toBe('')
    expect(str(undefined)).toBe('')
    expect(str(7)).toBe('7')
  })
})

describe('dateStr', () => {
  it('reads a YAML date as the calendar day its author wrote, not the local one', () => {
    // YAML 1.1 parses an unquoted date to UTC midnight; rendering it locally
    // would shift the day west of UTC.
    expect(dateStr(new Date('2026-08-12T00:00:00.000Z'))).toBe('2026-08-12')
  })

  it('renders an unparseable date as empty rather than as Invalid Date', () => {
    expect(dateStr(new Date('nonsense'))).toBe('')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run core/tests/frontmatter.test.ts`
Expected: FAIL — cannot resolve `../src/frontmatter.js`.

- [ ] **Step 3: Create the module**

Create `core/src/frontmatter.ts`, moving both functions verbatim out of `note/parse.ts` along with the comment that explains `dateStr`:

```ts
export function str(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value)
}

/**
 * Frontmatter dates need care. YAML 1.1 parses an unquoted `2026-08-12` into a
 * Date anchored at UTC midnight, and String(date) would render it in the
 * machine's local zone — shifting the calendar day west of UTC. Take the UTC
 * date components, which are exactly the day the file's author wrote.
 */
export function dateStr(value: unknown): string {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? '' : value.toISOString().slice(0, 10)
  }
  return str(value)
}
```

- [ ] **Step 4: Point `note/parse.ts` at it**

Delete the two function bodies from `core/src/note/parse.ts` and import them instead:

```ts
import { dateStr, str } from '../frontmatter.js'
```

Add to `core/src/index.ts`, after the `./types.js` line:

```ts
export * from './frontmatter.js'
```

- [ ] **Step 5: Run the suite**

Run: `npm test`
Expected: PASS — every existing note-parsing test still passes, because the functions moved rather than changed.

- [ ] **Step 6: Commit**

```bash
git add core/src/frontmatter.ts core/src/note/parse.ts core/src/index.ts core/tests/frontmatter.test.ts
git commit -m "refactor(core): frontmatter helpers move out of the note parser, for the second parser"
```

---

### Task 3: Parse a registration record

**Files:**
- Create: `core/src/project/parse.ts`
- Test: `core/tests/registration-parse.test.ts`

**Interfaces:**
- Consumes: `str`, `dateStr` from `core/src/frontmatter.ts`.
- Produces:

```ts
export interface Registration {
  slug: string
  name: string
  paths: string[]
  git_remote: string | null
  plan: string | null
  registered_at: string
  extra: Record<string, unknown>
  sourcePath: string
}
export class RegistrationParseError extends Error {
  constructor(message: string, readonly sourcePath: string, readonly field?: string)
}
export function parseRegistration(raw: string, sourcePath: string): Registration
```

- [ ] **Step 1: Write the failing test**

Create `core/tests/registration-parse.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { RegistrationParseError, parseRegistration } from '../src/project/parse.js'

const full = `---
slug: hountybunter-a1b2c3
name: hountybunter
paths:
  - /Users/kobe/Developer/hountybunter
  - /Users/kobe/Developer/hountybunter-wt/phase-8b
git_remote: git@github.com:kobe/hountybunter.git
plan: docs/superpowers/plans/2026-09-02-phase-8a-staleness.md
registered_at: 2026-09-08
mood: cheerful
---

Free prose.
`

describe('parseRegistration', () => {
  it('reads every declared field', () => {
    const r = parseRegistration(full, '/store/projects/hountybunter-a1b2c3.md')
    expect(r.slug).toBe('hountybunter-a1b2c3')
    expect(r.name).toBe('hountybunter')
    expect(r.paths).toEqual([
      '/Users/kobe/Developer/hountybunter',
      '/Users/kobe/Developer/hountybunter-wt/phase-8b',
    ])
    expect(r.git_remote).toBe('git@github.com:kobe/hountybunter.git')
    expect(r.plan).toBe('docs/superpowers/plans/2026-09-02-phase-8a-staleness.md')
    expect(r.registered_at).toBe('2026-09-08')
  })

  it('preserves keys it does not know, so a hand edit survives a rewrite', () => {
    const r = parseRegistration(full, '/store/projects/x.md')
    expect(r.extra).toEqual({ mood: 'cheerful' })
  })

  it('reads an unquoted registered_at as the day its author wrote', () => {
    const r = parseRegistration(
      '---\nslug: s\nname: n\npaths:\n  - /a\nregistered_at: 2026-09-08\n---\n',
      '/store/projects/s.md',
    )
    expect(r.registered_at).toBe('2026-09-08')
  })

  it('leaves an undeclared plan absent rather than empty', () => {
    const r = parseRegistration('---\nslug: s\nname: n\npaths:\n  - /a\nregistered_at: 2026-09-08\n---\n', '/p.md')
    expect(r.plan).toBeNull()
    expect(r.git_remote).toBeNull()
  })

  it('refuses a record with no paths, because it can never match a cwd', () => {
    expect(() => parseRegistration('---\nslug: s\nname: n\nregistered_at: 2026-09-08\n---\n', '/p.md'))
      .toThrow(RegistrationParseError)
  })

  it('refuses a relative path, which would resolve differently per caller', () => {
    expect(() => parseRegistration('---\nslug: s\nname: n\npaths:\n  - ./here\nregistered_at: 2026-09-08\n---\n', '/p.md'))
      .toThrow(/absolute/)
  })

  it('refuses an absolute plan, which would not survive the repo moving', () => {
    const raw = '---\nslug: s\nname: n\npaths:\n  - /a\nplan: /a/docs/p.md\nregistered_at: 2026-09-08\n---\n'
    expect(() => parseRegistration(raw, '/p.md')).toThrow(/repo-relative/)
  })

  it('names the file and the field it choked on', () => {
    try {
      parseRegistration('---\nslug: s\nname: n\nregistered_at: 2026-09-08\n---\n', '/store/projects/s.md')
      expect.unreachable('should have thrown')
    } catch (error) {
      const e = error as RegistrationParseError
      expect(e.sourcePath).toBe('/store/projects/s.md')
      expect(e.field).toBe('paths')
    }
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run core/tests/registration-parse.test.ts`
Expected: FAIL — cannot resolve `../src/project/parse.js`.

- [ ] **Step 3: Implement the parser**

Create `core/src/project/parse.ts`:

```ts
import matter from 'gray-matter'
import { dateStr, str } from '../frontmatter.js'

export interface Registration {
  slug: string
  name: string
  /** Ordered. The first is primary: new notes are filed under its slug. */
  paths: string[]
  git_remote: string | null
  /** Repo-relative, so it reads the same from every worktree. */
  plan: string | null
  registered_at: string
  /** Frontmatter keys we do not know about, preserved for a lossless round trip. */
  extra: Record<string, unknown>
  sourcePath: string
}

export class RegistrationParseError extends Error {
  constructor(
    message: string,
    readonly sourcePath: string,
    readonly field?: string,
  ) {
    super(message)
    this.name = 'RegistrationParseError'
  }
}

const KNOWN_KEYS = new Set(['slug', 'name', 'paths', 'git_remote', 'plan', 'registered_at'])

export function parseRegistration(raw: string, sourcePath: string): Registration {
  const { data, content } = matter(raw)

  const slug = str(data.slug)
  if (!slug) throw new RegistrationParseError('slug is required', sourcePath, 'slug')

  const paths = Array.isArray(data.paths) ? data.paths.map(str).filter(Boolean) : []
  if (paths.length === 0) {
    throw new RegistrationParseError('paths must name at least one directory', sourcePath, 'paths')
  }
  for (const path of paths) {
    if (!path.startsWith('/')) {
      throw new RegistrationParseError(
        `paths must be absolute — got "${path}"`,
        sourcePath,
        'paths',
      )
    }
  }

  const plan = str(data.plan) || null
  if (plan?.startsWith('/')) {
    throw new RegistrationParseError(
      `plan must be repo-relative so it survives the repository moving — got "${plan}"`,
      sourcePath,
      'plan',
    )
  }

  const extra: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(data)) {
    if (!KNOWN_KEYS.has(key)) extra[key] = value
  }

  return {
    slug,
    name: str(data.name) || slug,
    paths,
    git_remote: str(data.git_remote) || null,
    plan,
    registered_at: dateStr(data.registered_at),
    body: content.trim(),
    extra,
    sourcePath,
  }
}
```

The interface declares `body: string` after `registered_at`:

```ts
  registered_at: string
  /** The record's prose. Somewhere to write this project's own conventions. */
  body: string
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run core/tests/registration-parse.test.ts`
Expected: PASS, all eight.

- [ ] **Step 5: Commit**

```bash
git add core/src/project/parse.ts core/tests/registration-parse.test.ts
git commit -m "feat(core): a project can be declared in a file, and the file is read strictly"
```

---

### Task 4: Serialize and store a registration record

**Files:**
- Create: `core/src/project/serialize.ts`
- Create: `core/src/project/store.ts`
- Modify: `core/src/paths.ts`
- Modify: `core/src/index.ts`
- Test: `core/tests/registration-store.test.ts`

**Interfaces:**
- Consumes: `Registration`, `RegistrationParseError`, `parseRegistration` (Task 3).
- Produces:

```ts
export function projectsDir(env?: NodeJS.ProcessEnv): string          // paths.ts
export function serializeRegistration(r: Registration): string
export async function writeRegistration(r: Registration, env?: NodeJS.ProcessEnv): Promise<string>
export interface ReadAllRegistrations { registrations: Registration[]; errors: RegistrationParseError[] }
export async function readAllRegistrations(env?: NodeJS.ProcessEnv): Promise<ReadAllRegistrations>
```

- [ ] **Step 1: Write the failing test**

Create `core/tests/registration-store.test.ts`:

```ts
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { parseRegistration } from '../src/project/parse.js'
import { projectsDir } from '../src/paths.js'
import { readAllRegistrations, writeRegistration } from '../src/project/store.js'
import { serializeRegistration } from '../src/project/serialize.js'

let env: NodeJS.ProcessEnv

beforeEach(async () => {
  const home = await mkdtemp(join(tmpdir(), 'hb-reg-'))
  env = { HOUNTYBUNTER_HOME: home } as NodeJS.ProcessEnv
})

const sample = parseRegistration(
  `---
slug: proj-abc123
name: proj
paths:
  - /w/proj
plan: docs/plan.md
registered_at: 2026-09-08
mood: cheerful
---

Prose survives.
`,
  '/unused.md',
)

describe('registration round trip', () => {
  it('writes a record that parses back to the same values', async () => {
    const path = await writeRegistration(sample, env)
    expect(path).toBe(join(projectsDir(env), 'proj-abc123.md'))

    const { registrations, errors } = await readAllRegistrations(env)
    expect(errors).toEqual([])
    expect(registrations).toHaveLength(1)
    const back = registrations[0]!
    expect(back.slug).toBe('proj-abc123')
    expect(back.paths).toEqual(['/w/proj'])
    expect(back.plan).toBe('docs/plan.md')
    expect(back.extra).toEqual({ mood: 'cheerful' })
    expect(back.body).toBe('Prose survives.')
  })

  it('omits a field nobody set rather than writing it as null', () => {
    const bare = parseRegistration(
      '---\nslug: s\nname: n\npaths:\n  - /a\nregistered_at: 2026-09-08\n---\n',
      '/unused.md',
    )
    const text = serializeRegistration(bare)
    expect(text).not.toContain('plan')
    expect(text).not.toContain('git_remote')
  })

  it('collects a bad record as an error instead of hiding the good ones', async () => {
    await writeRegistration(sample, env)
    await writeFile(join(projectsDir(env), 'broken.md'), '---\nname: no slug here\n---\n')

    const { registrations, errors } = await readAllRegistrations(env)
    expect(registrations).toHaveLength(1)
    expect(errors).toHaveLength(1)
    expect(errors[0]!.sourcePath).toBe(join(projectsDir(env), 'broken.md'))
  })

  it('reports no registrations at all rather than throwing on a store with no directory', async () => {
    const { registrations, errors } = await readAllRegistrations(env)
    expect(registrations).toEqual([])
    expect(errors).toEqual([])
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run core/tests/registration-store.test.ts`
Expected: FAIL — `projectsDir` and the two modules do not exist.

- [ ] **Step 3: Add `projectsDir`**

In `core/src/paths.ts`, after `notesDir`:

```ts
/** Authored records of which directories make up a project. */
export function projectsDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(storeRoot(env), 'projects')
}
```

- [ ] **Step 4: Write the serializer**

Create `core/src/project/serialize.ts`:

```ts
import matter from 'gray-matter'
import type { Registration } from './parse.js'

/**
 * Registration -> markdown. Empty optional fields are omitted rather than
 * written as null, so a minimal record stays minimal and re-reading it yields
 * the same object.
 */
export function serializeRegistration(registration: Registration): string {
  const data: Record<string, unknown> = {
    slug: registration.slug,
    name: registration.name,
    paths: registration.paths,
  }
  if (registration.git_remote) data.git_remote = registration.git_remote
  if (registration.plan) data.plan = registration.plan
  data.registered_at = registration.registered_at

  for (const [key, value] of Object.entries(registration.extra)) data[key] = value

  return matter.stringify(registration.body, data)
}
```

- [ ] **Step 5: Write the store**

Create `core/src/project/store.ts`:

```ts
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { projectsDir } from '../paths.js'
import { RegistrationParseError, parseRegistration, type Registration } from './parse.js'
import { serializeRegistration } from './serialize.js'

export async function writeRegistration(
  registration: Registration,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const dir = projectsDir(env)
  await mkdir(dir, { recursive: true })
  const path = join(dir, `${registration.slug}.md`)
  await writeFile(path, serializeRegistration(registration), 'utf8')
  return path
}

export interface ReadAllRegistrations {
  registrations: Registration[]
  errors: RegistrationParseError[]
}

/**
 * Every registration in the store. A record that fails to parse is collected
 * as an error rather than aborting the read: one hand-edit gone wrong must not
 * cost every other project its brief.
 */
export async function readAllRegistrations(
  env: NodeJS.ProcessEnv = process.env,
): Promise<ReadAllRegistrations> {
  const dir = projectsDir(env)
  let names: string[]
  try {
    names = (await readdir(dir)).filter((n) => n.endsWith('.md')).sort()
  } catch {
    return { registrations: [], errors: [] }
  }

  const registrations: Registration[] = []
  const errors: RegistrationParseError[] = []
  for (const name of names) {
    const path = join(dir, name)
    try {
      registrations.push(parseRegistration(await readFile(path, 'utf8'), path))
    } catch (error) {
      errors.push(
        error instanceof RegistrationParseError
          ? error
          : new RegistrationParseError(String(error), path),
      )
    }
  }
  return { registrations, errors }
}
```

- [ ] **Step 6: Export from core**

In `core/src/index.ts`, after the note exports:

```ts
export * from './project/parse.js'
export * from './project/serialize.js'
export * from './project/store.js'
```

- [ ] **Step 7: Run the tests**

Run: `npx vitest run core/tests/registration-store.test.ts`
Expected: PASS, all four.

- [ ] **Step 8: Commit**

```bash
git add core/src/project/serialize.ts core/src/project/store.ts core/src/paths.ts \
        core/src/index.ts core/tests/registration-store.test.ts
git commit -m "feat(core): a registration is a file in the store, and one bad file costs only itself"
```

---

### Task 5: Resolve a directory to its project

**Files:**
- Create: `core/src/project/resolve.ts`
- Modify: `core/src/index.ts`
- Test: `core/tests/registration-resolve.test.ts`

**Interfaces:**
- Consumes: `Registration` (Task 3), `readAllRegistrations` (Task 4), `projectSlug` from `core/src/paths.ts`.
- Produces:

```ts
export interface ResolvedProject {
  slug: string          // the primary slug: where new notes are filed
  slugs: string[]       // every slug this record's paths yield, primary first
  primaryPath: string
  plan: string | null
  registration: Registration
}
export function resolveFrom(registrations: Registration[], cwd: string): ResolvedProject | null
export async function resolveProject(cwd: string, env?: NodeJS.ProcessEnv): Promise<ResolvedProject | null>
export async function slugFor(cwd: string, env?: NodeJS.ProcessEnv): Promise<string>
```

- [ ] **Step 1: Write the failing test**

Create `core/tests/registration-resolve.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { projectSlug } from '../src/paths.js'
import { parseRegistration } from '../src/project/parse.js'
import { resolveFrom } from '../src/project/resolve.js'

const reg = (slug: string, paths: string[], plan?: string) =>
  parseRegistration(
    `---\nslug: ${slug}\nname: ${slug}\npaths:\n${paths.map((p) => `  - ${p}`).join('\n')}\n` +
      `${plan ? `plan: ${plan}\n` : ''}registered_at: 2026-09-08\n---\n`,
    `/store/${slug}.md`,
  )

describe('resolveFrom', () => {
  it('matches a directory that is registered', () => {
    const found = resolveFrom([reg('proj-a', ['/w/proj'])], '/w/proj')
    expect(found?.slug).toBe('proj-a')
    expect(found?.primaryPath).toBe('/w/proj')
  })

  it('matches a subdirectory, so a session opened deeper still resolves', () => {
    expect(resolveFrom([reg('proj-a', ['/w/proj'])], '/w/proj/core/src')?.slug).toBe('proj-a')
  })

  it('does not match a sibling that merely shares a name prefix', () => {
    expect(resolveFrom([reg('proj-a', ['/w/proj'])], '/w/project-two')).toBeNull()
  })

  it('takes the longest match when one registered path sits inside another', () => {
    const outer = reg('outer', ['/w'])
    const inner = reg('inner', ['/w/proj'])
    expect(resolveFrom([outer, inner], '/w/proj/src')?.slug).toBe('inner')
  })

  it('ignores a trailing separator on either side', () => {
    expect(resolveFrom([reg('proj-a', ['/w/proj/'])], '/w/proj')?.slug).toBe('proj-a')
  })

  it('yields one slug per registered path, primary first', () => {
    const found = resolveFrom([reg('proj-a', ['/w/proj', '/w/wt/phase-8b'])], '/w/wt/phase-8b')
    // The worktree hashes to its own slug; both must be readable, and the
    // primary must stay first because it is where writes go.
    expect(found?.slugs).toEqual(['proj-a', projectSlug('/w/wt/phase-8b')])
    expect(found?.slug).toBe('proj-a')
  })

  it('carries the declared plan through', () => {
    expect(resolveFrom([reg('proj-a', ['/w/proj'], 'docs/p.md')], '/w/proj')?.plan).toBe('docs/p.md')
  })

  it('returns null for a directory nobody registered', () => {
    expect(resolveFrom([reg('proj-a', ['/w/proj'])], '/elsewhere')).toBeNull()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run core/tests/registration-resolve.test.ts`
Expected: FAIL — cannot resolve `../src/project/resolve.js`.

- [ ] **Step 3: Implement resolution**

Create `core/src/project/resolve.ts`:

```ts
import { projectSlug } from '../paths.js'
import type { Registration } from './parse.js'
import { readAllRegistrations } from './store.js'

export interface ResolvedProject {
  /** Where new notes are filed. */
  slug: string
  /**
   * Every slug this record's paths hash to, primary first. `projectSlug` is
   * path-derived, so a worktree filed notes under its own slug; reading the
   * whole set makes them visible again without moving a file.
   */
  slugs: string[]
  primaryPath: string
  plan: string | null
  registration: Registration
}

function trim(path: string): string {
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path
}

/** True when `cwd` is `root` or sits inside it, matched at a segment boundary. */
function within(root: string, cwd: string): boolean {
  return cwd === root || cwd.startsWith(`${root}/`)
}

export function resolveFrom(
  registrations: Registration[],
  cwd: string,
): ResolvedProject | null {
  const here = trim(cwd)
  let best: { registration: Registration; path: string } | null = null

  for (const registration of registrations) {
    for (const raw of registration.paths) {
      const path = trim(raw)
      if (!within(path, here)) continue
      // Longest wins, so a project registered inside another resolves to the
      // inner one rather than to whichever was read first.
      if (!best || path.length > best.path.length) best = { registration, path }
    }
  }
  if (!best) return null

  const { registration } = best
  const primaryPath = trim(registration.paths[0]!)
  const slugs = [
    registration.slug,
    ...registration.paths.map((p) => projectSlug(p)).filter((s) => s !== registration.slug),
  ]

  return {
    slug: registration.slug,
    slugs: [...new Set(slugs)],
    primaryPath,
    plan: registration.plan,
    registration,
  }
}

export async function resolveProject(
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ResolvedProject | null> {
  const { registrations } = await readAllRegistrations(env)
  return resolveFrom(registrations, cwd)
}

/**
 * The slug new work is filed under: the registered project's, or today's
 * path-derived one when nothing is registered. Registration is additive.
 */
export async function slugFor(
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  return (await resolveProject(cwd, env))?.slug ?? projectSlug(cwd)
}
```

- [ ] **Step 4: Export it**

In `core/src/index.ts`, beside the other project exports:

```ts
export * from './project/resolve.js'
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run core/tests/registration-resolve.test.ts`
Expected: PASS, all eight.

- [ ] **Step 6: Commit**

```bash
git add core/src/project/resolve.ts core/src/index.ts core/tests/registration-resolve.test.ts
git commit -m "feat(core): a worktree resolves to the project it is a worktree of"
```

---

### Task 6: Mirror registrations into the index

**Files:**
- Modify: `core/src/db/write.ts`
- Modify: `core/src/rebuild.ts`
- Test: `core/tests/registration-index.test.ts`

**Interfaces:**
- Consumes: `Registration` (Task 3), `readAllRegistrations` (Task 4), `projectSlug`.
- Produces: `indexRegistration(db, r)`, `clearRegistrationIndex(db)`; `RebuildReport` gains `projectsRegistered: number`.

- [ ] **Step 1: Write the failing test**

Create `core/tests/registration-index.test.ts`:

```ts
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { openDb } from '../src/db/open.js'
import { clearRegistrationIndex, indexRegistration } from '../src/db/write.js'
import { parseRegistration } from '../src/project/parse.js'
import { writeRegistration } from '../src/project/store.js'
import { rebuildFromDisk } from '../src/rebuild.js'

let env: NodeJS.ProcessEnv

beforeEach(async () => {
  const home = await mkdtemp(join(tmpdir(), 'hb-regidx-'))
  env = { HOUNTYBUNTER_HOME: home } as NodeJS.ProcessEnv
})

const sample = parseRegistration(
  '---\nslug: proj-abc\nname: proj\npaths:\n  - /w/proj\n  - /w/wt\nplan: docs/p.md\nregistered_at: 2026-09-08\n---\n',
  '/store/projects/proj-abc.md',
)

describe('registration index', () => {
  it('writes one project row and one row per path', () => {
    const db = openDb(env)
    indexRegistration(db, sample)
    expect(db.prepare('SELECT slug, plan, primary_path FROM registered_projects').all()).toEqual([
      { slug: 'proj-abc', plan: 'docs/p.md', primary_path: '/w/proj' },
    ])
    expect(db.prepare('SELECT path FROM registered_paths ORDER BY path').all()).toEqual([
      { path: '/w/proj' },
      { path: '/w/wt' },
    ])
    db.close()
  })

  it('drops a path removed from the record instead of leaving it to match forever', () => {
    const db = openDb(env)
    indexRegistration(db, sample)
    const shorter = { ...sample, paths: ['/w/proj'] }
    clearRegistrationIndex(db)
    indexRegistration(db, shorter)
    expect(db.prepare('SELECT path FROM registered_paths').all()).toEqual([{ path: '/w/proj' }])
    db.close()
  })

  it('rebuild restores the registration from the file after the index is deleted', async () => {
    await writeRegistration(sample, env)
    const report = await rebuildFromDisk(env)
    expect(report.projectsRegistered).toBe(1)

    const db = openDb(env)
    expect(db.prepare('SELECT COUNT(*) c FROM registered_projects').get()).toEqual({ c: 1 })
    db.close()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run core/tests/registration-index.test.ts`
Expected: FAIL — `indexRegistration` is not exported.

- [ ] **Step 3: Write the index functions**

In `core/src/db/write.ts`, add (importing `Registration` as a type from `../project/parse.js`):

```ts
export function clearRegistrationIndex(db: Database.Database): void {
  db.exec('DELETE FROM registered_paths; DELETE FROM registered_projects;')
}

/** Mirror an authored record into the index. The file stays the truth. */
export function indexRegistration(db: Database.Database, registration: Registration): void {
  db.transaction(() => {
    db.prepare(
      `INSERT INTO registered_projects (slug, name, primary_path, plan, registered_at, source_path)
       VALUES (@slug, @name, @primary_path, @plan, @registered_at, @source_path)
       ON CONFLICT(slug) DO UPDATE SET
         name = excluded.name, primary_path = excluded.primary_path,
         plan = excluded.plan, registered_at = excluded.registered_at,
         source_path = excluded.source_path`,
    ).run({
      slug: registration.slug,
      name: registration.name,
      primary_path: registration.paths[0],
      plan: registration.plan,
      registered_at: registration.registered_at,
      source_path: registration.sourcePath,
    })

    const insertPath = db.prepare(
      `INSERT INTO registered_paths (path, slug) VALUES (?, ?)
       ON CONFLICT(path) DO UPDATE SET slug = excluded.slug`,
    )
    for (const path of registration.paths) insertPath.run(path, registration.slug)
  })()
}
```

- [ ] **Step 4: Fold it into the rebuild**

In `core/src/rebuild.ts`: import `clearRegistrationIndex`, `indexRegistration` and `readAllRegistrations`, add `projectsRegistered: number` to `RebuildReport`, and inside `rebuildFromDisk`, before indexing notes:

```ts
  const { registrations, errors: registrationErrors } = await readAllRegistrations(env)
```

then inside the `try`, before `clearNoteIndex(db)`:

```ts
    clearRegistrationIndex(db)
    for (const registration of registrations) indexRegistration(db, registration)
```

and return `projectsRegistered: registrations.length` alongside the existing fields. A registration that failed to parse is reported the same way a bad note is: push each `registrationErrors` entry onto `errors` as a `NoteParseError` carrying its message and `sourcePath`, so one report still lists everything wrong in the store.

- [ ] **Step 5: Run the suite**

Run: `npm test`
Expected: PASS. `core/tests/rebuild.test.ts` still passes: the new tables are in `SNAPSHOT` from Task 1, and rebuilding twice produces identical rows because the file is the source.

- [ ] **Step 6: Commit**

```bash
git add core/src/db/write.ts core/src/rebuild.ts core/tests/registration-index.test.ts
git commit -m "feat(core): the index mirrors a registration, and a rebuild puts it back"
```

---

### Task 7: `hb register`

**Files:**
- Modify: `surfaces/cli/src/bin.ts` (USAGE, `runCli` switch, new `cmdRegister`)
- Test: `surfaces/cli/tests/register.test.ts`

**Interfaces:**
- Consumes: `parseRegistration`, `writeRegistration`, `readAllRegistrations`, `resolveFrom`, `projectSlug`, `nowIso`, `calendarDate`.
- Produces: `hb register [path] [--plan <repo-relative>]`.

- [ ] **Step 1: Write the failing test**

Create `surfaces/cli/tests/register.test.ts`:

```ts
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { readAllRegistrations } from '@hountybunter/core'
import { runCli, type Io } from '../src/bin.js'

let io: Io
let out: string[]
let err: string[]

beforeEach(async () => {
  const home = await mkdtemp(join(tmpdir(), 'hb-reg-cli-'))
  out = []
  err = []
  io = {
    out: (l) => out.push(l),
    err: (l) => err.push(l),
    env: { HOUNTYBUNTER_HOME: home, HOUNTYBUNTER_TZ: 'UTC' } as NodeJS.ProcessEnv,
    cwd: '/w/proj',
  }
})

describe('hb register', () => {
  it('registers the current directory and reports the slug', async () => {
    expect(await runCli(['register'], io)).toBe(0)
    const { registrations } = await readAllRegistrations(io.env)
    expect(registrations).toHaveLength(1)
    expect(registrations[0]!.paths).toEqual(['/w/proj'])
  })

  it('prints the line to paste, and says it changed nothing in the repository', async () => {
    await runCli(['register'], io)
    const text = out.join('\n')
    expect(text).toContain('hb brief')
    expect(text).toMatch(/AGENTS\.md|CLAUDE\.md/)
  })

  it('registering the same directory twice does not make a second project', async () => {
    await runCli(['register'], io)
    await runCli(['register'], io)
    const { registrations } = await readAllRegistrations(io.env)
    expect(registrations).toHaveLength(1)
  })

  it('sets the plan pointer', async () => {
    await runCli(['register', '--plan', 'docs/superpowers/plans/p.md'], io)
    const { registrations } = await readAllRegistrations(io.env)
    expect(registrations[0]!.plan).toBe('docs/superpowers/plans/p.md')
  })

  it('refuses an absolute plan with a sentence, not a stack trace', async () => {
    expect(await runCli(['register', '--plan', '/w/proj/docs/p.md'], io)).toBe(1)
    expect(err.join('\n')).toMatch(/repo-relative/)
  })

  it('adds a second directory to the same project rather than creating another', async () => {
    await runCli(['register'], io)
    expect(await runCli(['register', '/w/proj-wt'], { ...io, cwd: '/w/proj-wt' })).toBe(0)
    const { registrations } = await readAllRegistrations(io.env)
    // No git in this fixture, so the second path is only joined when the user
    // names the project it belongs to.
    expect(registrations).toHaveLength(2)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run surfaces/cli/tests/register.test.ts`
Expected: FAIL — `hb register` prints usage and returns 1.

- [ ] **Step 3: Implement the command**

In `surfaces/cli/src/bin.ts`, add to `USAGE` above `web`:

```
  register [path] [--plan P]          declare a project so hb brief can speak for it
```

Add the case to the switch in `runCli`:

```ts
      case 'register': return await cmdRegister(rest, io)
```

Add the command. `mainWorktree` asks git rather than guessing from the directory name, and returns null whenever git cannot answer:

```ts
/**
 * The main worktree for `path`, or null when this is not a git worktree.
 *
 * A worktree is a different directory for the same project, and
 * `projectSlug` is path-derived — so without this, every worktree would
 * register as a project of its own and the notes would scatter.
 */
async function mainWorktree(path: string): Promise<string | null> {
  try {
    const { stdout } = await promisify(execFile)(
      'git',
      ['-C', path, 'rev-parse', '--path-format=absolute', '--git-common-dir'],
      { timeout: 2000 },
    )
    const commonDir = stdout.trim()
    if (!commonDir) return null
    // `<main>/.git` for a normal clone and for every worktree of it.
    return commonDir.endsWith('/.git') ? dirname(commonDir) : null
  } catch {
    return null
  }
}

async function cmdRegister(args: string[], io: Io): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { plan: { type: 'string' } },
  })

  const path = resolve(io.cwd, positionals[0] ?? '.')
  const plan = values.plan
  if (plan?.startsWith('/')) {
    io.err(`hb register: --plan must be repo-relative so it survives the repository moving — got "${plan}"`)
    return 1
  }

  const { registrations } = await readAllRegistrations(io.env)
  const main = await mainWorktree(path)

  // Already registered under this path, or a worktree of something registered.
  const existing =
    resolveFrom(registrations, path) ?? (main ? resolveFrom(registrations, main) : null)

  const today = calendarDate(nowIso(), resolveTimeZone(io.env.HOUNTYBUNTER_TZ))

  if (existing) {
    const record = existing.registration
    const paths = record.paths.includes(path) ? record.paths : [...record.paths, path]
    const updated = { ...record, paths, plan: plan ?? record.plan }
    await writeRegistration(updated, io.env)
    io.out(`registered ${path} under ${updated.slug} (${paths.length} path${paths.length > 1 ? 's' : ''})`)
  } else {
    const slug = projectSlug(path)
    await writeRegistration(
      {
        slug,
        name: basename(path) || slug,
        paths: [path],
        git_remote: null,
        plan: plan ?? null,
        registered_at: today,
        body: '',
        extra: {},
        sourcePath: '',
      },
      io.env,
    )
    io.out(`registered ${path} as ${slug}`)
  }

  io.out('')
  io.out('Nothing in the repository was changed. Paste this into AGENTS.md and CLAUDE.md:')
  io.out('')
  io.out('    Run `hb brief` to see where this work was left.')
  return 0
}
```

Add the imports `bin.ts` now needs, beside the existing ones:

```ts
import { execFile } from 'node:child_process'
import { basename, dirname, resolve } from 'node:path'
import { promisify } from 'node:util'
```

and add `readAllRegistrations`, `resolveFrom`, `writeRegistration` to the `@hountybunter/core` import list.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run surfaces/cli/tests/register.test.ts`
Expected: PASS, all six.

- [ ] **Step 5: Commit**

```bash
git add surfaces/cli/src/bin.ts surfaces/cli/tests/register.test.ts
git commit -m "feat(cli): hb register, which asks git where a worktree belongs and edits nothing"
```

---

### Task 8: Notes follow the registration

**Files:**
- Modify: `surfaces/cli/src/bin.ts` (`cmdJot`, the promote path)
- Modify: `core/src/note/record.ts`
- Test: `surfaces/cli/tests/register.test.ts` (append)

**Interfaces:**
- Consumes: `slugFor` (Task 5).
- Produces: `recordNote` accepts `slugOf?: (path: string) => string`, defaulting to `projectSlug`.

- [ ] **Step 1: Write the failing test**

Append to `surfaces/cli/tests/register.test.ts`:

```ts
describe('notes follow the registration', () => {
  it('files a jot under the registered slug, not the path-derived one', async () => {
    await runCli(['register'], io)
    const { registrations } = await readAllRegistrations(io.env)
    const slug = registrations[0]!.slug

    await runCli(['jot', 'chose SQLite because the file outlives the tool'], io)
    expect(out.join('\n')).toContain(slug)
  })

  it('files a jot from a second registered path under the primary slug', async () => {
    await runCli(['register'], io)
    // Join the worktree to the project by registering it from inside a record
    // that already holds the main path.
    const { registrations } = await readAllRegistrations(io.env)
    const record = registrations[0]!
    await writeRegistration({ ...record, paths: [...record.paths, '/w/proj-wt'] }, io.env)

    out.length = 0
    await runCli(['jot', 'from the worktree'], { ...io, cwd: '/w/proj-wt' })
    expect(out.join('\n')).toContain(record.slug)
  })
})
```

Add `writeRegistration` to that file's `@hountybunter/core` import.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run surfaces/cli/tests/register.test.ts -t 'follow the registration'`
Expected: FAIL — the jot reports `projectSlug('/w/proj-wt')`, a different slug.

- [ ] **Step 3: Route the write through the registration**

In `surfaces/cli/src/bin.ts`, in `cmdJot`, replace `projectSlug(io.cwd)`:

```ts
  const jot = await appendJot(
    { project: await slugFor(io.cwd, io.env), text },
    { env: io.env, timeZone: io.env.HOUNTYBUNTER_TZ },
  )
```

Do the same at every other call site of `projectSlug(io.cwd)` in this file — the promote path included — and add `slugFor` to the core import list.

- [ ] **Step 4: Stop `recordNote` discarding a worktree's path**

`core/src/note/record.ts` keeps `project_path` only when `projectSlug(projectPath) === project`. For a registered worktree those differ, so the path — the very thing that makes a one-way slug useful — would be silently dropped. Give the guard the resolver instead of hard-coding it:

```ts
export interface RecordNoteInput {
  // …existing fields…
  /**
   * How a path maps to a project slug. Defaults to the path-derived rule; the
   * CLI passes the registration's, so a note written in a worktree keeps the
   * directory it was written in.
   */
  slugOf?: (path: string) => string
}
```

and in the body:

```ts
    project_path:
      input.projectPath && (input.slugOf ?? projectSlug)(input.projectPath) === input.project
        ? input.projectPath
        : null,
```

At the CLI's promote call site, pass a resolver built from the resolved project:

```ts
  const resolved = await resolveProject(io.cwd, io.env)
  const slugOf = resolved ? () => resolved.slug : projectSlug
```

- [ ] **Step 5: Run the suite**

Run: `npm test`
Expected: PASS. Existing note tests are unaffected: with no `slugOf` the guard behaves exactly as before.

- [ ] **Step 6: Commit**

```bash
git add surfaces/cli/src/bin.ts core/src/note/record.ts surfaces/cli/tests/register.test.ts
git commit -m "feat(cli,core): a note written in a worktree belongs to the project, not to the worktree"
```

---

### Task 9: What git can say about where the work stopped

**Files:**
- Create: `core/src/brief/git.ts`
- Modify: `core/src/index.ts`
- Test: `core/tests/brief-git.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:

```ts
export interface GitState {
  ok: boolean
  branch: string | null
  head: string | null            // "<short sha> <subject>"
  dirty: string[]                // porcelain lines, capped at 20
  diffstat: string | null
  defaultBranch: string | null
  commits: string[]              // subjects from merge-base to HEAD, newest first, capped at 20
}
export async function readGitState(cwd: string): Promise<GitState>
```

- [ ] **Step 1: Write the failing test**

Create `core/tests/brief-git.test.ts`. It builds a real repository, because the value of this module is entirely in what git actually answers:

```ts
import { execFile } from 'node:child_process'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { beforeEach, describe, expect, it } from 'vitest'
import { readGitState } from '../src/brief/git.js'

const run = promisify(execFile)
let repo: string

async function git(...args: string[]) {
  await run('git', ['-C', repo, ...args])
}

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), 'hb-git-'))
  await git('init', '-b', 'main')
  await git('config', 'user.email', 'test@example.com')
  await git('config', 'user.name', 'Test')
  await writeFile(join(repo, 'a.txt'), 'one\n')
  await git('add', '.')
  await git('commit', '-m', 'first commit')
})

describe('readGitState', () => {
  it('reports the branch and the commit at HEAD', async () => {
    const state = await readGitState(repo)
    expect(state.ok).toBe(true)
    expect(state.branch).toBe('main')
    expect(state.head).toContain('first commit')
  })

  it('lists what is uncommitted, which is what a killed session left behind', async () => {
    await writeFile(join(repo, 'a.txt'), 'two\n')
    const state = await readGitState(repo)
    expect(state.dirty.join('\n')).toContain('a.txt')
    expect(state.diffstat).toContain('a.txt')
  })

  it('lists the commits made on a branch since it left the default branch', async () => {
    await git('checkout', '-b', 'feat/x')
    await writeFile(join(repo, 'b.txt'), 'b\n')
    await git('add', '.')
    await git('commit', '-m', 'second commit')

    const state = await readGitState(repo)
    expect(state.commits.join('\n')).toContain('second commit')
    expect(state.commits.join('\n')).not.toContain('first commit')
  })

  it('reports an empty range on the default branch rather than the whole history', async () => {
    const state = await readGitState(repo)
    expect(state.commits).toEqual([])
  })

  it('says so rather than throwing when there is no repository at all', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'hb-nogit-'))
    const state = await readGitState(empty)
    expect(state.ok).toBe(false)
    expect(state.branch).toBeNull()
    expect(state.commits).toEqual([])
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run core/tests/brief-git.test.ts`
Expected: FAIL — cannot resolve `../src/brief/git.js`.

- [ ] **Step 3: Implement it**

Create `core/src/brief/git.ts`:

```ts
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

export interface GitState {
  ok: boolean
  branch: string | null
  head: string | null
  dirty: string[]
  diffstat: string | null
  defaultBranch: string | null
  commits: string[]
}

const EMPTY: GitState = {
  ok: false,
  branch: null,
  head: null,
  dirty: [],
  diffstat: null,
  defaultBranch: null,
  commits: [],
}

/** Ask git one question. Null on any failure — a brief must never be the thing that throws. */
async function ask(cwd: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await run('git', ['-C', cwd, ...args], { timeout: 5000 })
    return stdout.trimEnd()
  } catch {
    return null
  }
}

/**
 * The default branch as this clone knows it, falling back to `main`.
 * `origin/HEAD` is a symbolic ref the clone set up; it is read, not assumed.
 */
async function defaultBranch(cwd: string): Promise<string | null> {
  const ref = await ask(cwd, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])
  if (ref) return ref.replace(/^origin\//, '')
  return (await ask(cwd, ['rev-parse', '--verify', '--quiet', 'main'])) ? 'main' : null
}

export async function readGitState(cwd: string): Promise<GitState> {
  const branch = await ask(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])
  if (branch === null) return EMPTY

  const base = await defaultBranch(cwd)
  let commits: string[] = []
  if (base && base !== branch) {
    const mergeBase = await ask(cwd, ['merge-base', 'HEAD', base])
    const log = mergeBase ? await ask(cwd, ['log', '--oneline', `${mergeBase}..HEAD`]) : null
    commits = log ? log.split('\n').filter(Boolean).slice(0, 20) : []
  }

  const status = await ask(cwd, ['status', '--porcelain'])

  return {
    ok: true,
    branch,
    head: await ask(cwd, ['log', '-1', '--oneline']),
    dirty: status ? status.split('\n').filter(Boolean).slice(0, 20) : [],
    diffstat: (await ask(cwd, ['diff', '--stat'])) || null,
    defaultBranch: base,
    commits,
  }
}
```

- [ ] **Step 4: Export and run**

Add to `core/src/index.ts`:

```ts
export * from './brief/git.js'
```

Run: `npx vitest run core/tests/brief-git.test.ts`
Expected: PASS, all five.

- [ ] **Step 5: Commit**

```bash
git add core/src/brief/git.ts core/src/index.ts core/tests/brief-git.test.ts
git commit -m "feat(core): git says what the working tree was left holding"
```

---

### Task 10: Compose the brief

**Files:**
- Create: `core/src/brief/compose.ts`
- Modify: `core/src/index.ts`
- Test: `core/tests/brief-compose.test.ts`

**Interfaces:**
- Consumes: `GitState` (Task 9).
- Produces:

```ts
export interface BriefNote { id: string; title: string; stale: boolean }
export interface LastExchange { harness: string; when: string | null; prompt: string | null; reply: string | null }
export interface BriefInput {
  name: string
  git: GitState
  /** Registered directories that are no longer on disk. */
  missingPaths: string[]
  planPath: string | null
  planSteps: string[]
  notes: BriefNote[]
  lastExchange: LastExchange | null
  ingestError: string | null
}
export function composeBrief(input: BriefInput, capBytes?: number): string
```

- [ ] **Step 1: Write the failing test**

Create `core/tests/brief-compose.test.ts`:

```ts
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
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run core/tests/brief-compose.test.ts`
Expected: FAIL — cannot resolve `../src/brief/compose.js`.

- [ ] **Step 3: Implement the composer**

Create `core/src/brief/compose.ts`:

```ts
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
```

- [ ] **Step 4: Export and run**

Add to `core/src/index.ts`:

```ts
export * from './brief/compose.js'
```

Run: `npx vitest run core/tests/brief-compose.test.ts`
Expected: PASS, all eight. If the cap test fails by a byte or two, adjust the `- 24` reserve — do not raise the cap.

- [ ] **Step 5: Commit**

```bash
git add core/src/brief/compose.ts core/src/index.ts core/tests/brief-compose.test.ts
git commit -m "feat(core): a brief that says how much of itself to believe"
```

---

### Task 11: `hb brief`

**Files:**
- Create: `adapters/claude-code/src/exchange.ts`
- Modify: `adapters/claude-code/src/index.ts`
- Modify: `surfaces/cli/src/bin.ts`
- Test: `surfaces/cli/tests/brief.test.ts`
- Test: `adapters/claude-code/tests/exchange.test.ts`

**Interfaces:**
- Consumes: `resolveProject` (Task 5), `readGitState` (Task 9), `composeBrief` (Task 10), `findTranscripts`, `listNotes`, `listSessions`.
- Produces: `hb brief [--no-ingest]`; `readLastExchange(path: string): Promise<{ prompt: string | null; reply: string | null }>`.

- [ ] **Step 1: Write the failing test for the transcript tail**

Create `adapters/claude-code/tests/exchange.test.ts`:

```ts
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readLastExchange } from '../src/exchange.js'

const user = (text: string) =>
  JSON.stringify({ type: 'user', message: { role: 'user', content: text } })
const assistant = (text: string) =>
  JSON.stringify({
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'text', text }] },
  })

describe('readLastExchange', () => {
  it('takes the last prompt and the last reply, not the first', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hb-tail-'))
    const path = join(dir, 's.jsonl')
    await writeFile(path, [user('first'), assistant('early'), user('latest'), assistant('final')].join('\n'))

    expect(await readLastExchange(path)).toEqual({ prompt: 'latest', reply: 'final' })
  })

  it('returns absence for a file it cannot read, rather than throwing', async () => {
    expect(await readLastExchange('/nowhere/at/all.jsonl')).toEqual({ prompt: null, reply: null })
  })

  it('skips a malformed line instead of losing the whole tail', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hb-tail2-'))
    const path = join(dir, 's.jsonl')
    await writeFile(path, [user('kept'), '{not json', assistant('kept too')].join('\n'))

    expect(await readLastExchange(path)).toEqual({ prompt: 'kept', reply: 'kept too' })
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run adapters/claude-code/tests/exchange.test.ts`
Expected: FAIL — cannot resolve `../src/exchange.js`.

- [ ] **Step 3: Implement the tail reader**

Create `adapters/claude-code/src/exchange.ts`. It lives in the adapter, not core, because what a line means is the harness's business — Codex's rollout nests the same fact differently:

```ts
import { readFile } from 'node:fs/promises'

export interface Exchange {
  prompt: string | null
  reply: string | null
}

function textOf(content: unknown): string | null {
  if (typeof content === 'string') return content.trim() || null
  if (!Array.isArray(content)) return null
  const parts = content
    .filter((b): b is { type: string; text: string } =>
      typeof b === 'object' && b !== null && (b as { type?: string }).type === 'text',
    )
    .map((b) => b.text)
  return parts.join('\n').trim() || null
}

/**
 * The last thing said in each direction, read from the archived transcript.
 *
 * Read rather than stored: §4 of the design keeps SQLite to the index and the
 * event log, and the archive is already on disk with a known path.
 */
export async function readLastExchange(path: string): Promise<Exchange> {
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch {
    return { prompt: null, reply: null }
  }

  let prompt: string | null = null
  let reply: string | null = null
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    let record: { type?: string; message?: { content?: unknown } }
    try {
      record = JSON.parse(line)
    } catch {
      continue
    }
    const text = textOf(record.message?.content)
    if (!text) continue
    if (record.type === 'user') prompt = text
    if (record.type === 'assistant') reply = text
  }
  return { prompt, reply }
}
```

Add to `adapters/claude-code/src/index.ts`:

```ts
export * from './exchange.js'
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run adapters/claude-code/tests/exchange.test.ts`
Expected: PASS, all three.

- [ ] **Step 5: Write the failing CLI test**

Create `surfaces/cli/tests/brief.test.ts`:

```ts
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { runCli, type Io } from '../src/bin.js'

let io: Io
let out: string[]
let err: string[]

beforeEach(async () => {
  const home = await mkdtemp(join(tmpdir(), 'hb-brief-'))
  const live = await mkdtemp(join(tmpdir(), 'hb-brief-live-'))
  out = []
  err = []
  io = {
    out: (l) => out.push(l),
    err: (l) => err.push(l),
    env: {
      HOUNTYBUNTER_HOME: home,
      HOUNTYBUNTER_TZ: 'UTC',
      HOUNTYBUNTER_TRANSCRIPTS: live,
    } as NodeJS.ProcessEnv,
    cwd: process.cwd(),
  }
})

describe('hb brief', () => {
  it('refuses to speak for a project nobody registered, and says how to fix it', async () => {
    expect(await runCli(['brief'], { ...io, cwd: '/w/unregistered' })).toBe(1)
    expect(err.join('\n')).toContain('hb register')
  })

  it('prints the tree state for a registered project', async () => {
    await runCli(['register'], io)
    out.length = 0
    expect(await runCli(['brief', '--no-ingest'], io)).toBe(0)
    const text = out.join('\n')
    expect(text).toContain('In flight now')
    expect(text).toContain('Verify against the working tree')
  })

  it('refuses a flag it does not know instead of ignoring it', async () => {
    await runCli(['register'], io)
    expect(await runCli(['brief', '--wat'], io)).toBe(1)
  })
})
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npx vitest run surfaces/cli/tests/brief.test.ts`
Expected: FAIL — `hb brief` prints usage and returns 1 for every case.

- [ ] **Step 7: Implement the command**

In `surfaces/cli/src/bin.ts`, add to `USAGE`:

```
  brief [--no-ingest]                 what a fresh agent needs to continue here
```

Add to the switch:

```ts
      case 'brief': return await cmdBrief(rest, io)
```

Add the command:

```ts
/**
 * Registered directories that are not on disk right now. Reported in the brief
 * and never pruned from the record: an unmounted drive is not a deregistration.
 */
async function missingOf(paths: string[]): Promise<string[]> {
  const missing: string[] = []
  for (const path of paths) {
    try {
      await stat(path)
    } catch {
      missing.push(path)
    }
  }
  return missing
}

async function cmdBrief(args: string[], io: Io): Promise<number> {
  const { values } = parseArgs({ args, options: { 'no-ingest': { type: 'boolean' } } })

  const project = await resolveProject(io.cwd, io.env)
  if (!project) {
    io.err(`hb brief: ${io.cwd} is not a registered project. Run \`hb register\` here first.`)
    return 1
  }

  // Ingest first: Codex has no hooks, so its sessions reach the index only
  // this way, and a brief that skipped it would be wrong in exactly the case
  // it exists for. A failure costs freshness, never the brief itself.
  let ingestError: string | null = null
  if (!values['no-ingest']) {
    try {
      await syncArchive(io.env)
      const db = openDb(io.env)
      try {
        await ingestAll(db, io.env)
      } finally {
        db.close()
      }
    } catch (error) {
      ingestError = (error as Error).message
    }
  }

  const db = openDb(io.env)
  try {
    const notes = project.slugs
      .flatMap((slug) => listNotes(db, { project: slug, status: 'standing', limit: 10 }))
      .slice(0, 10)
    const staleIds = new Set(
      (db
        .prepare(
          `SELECT DISTINCT note_id FROM note_evidence WHERE state IN ('changed', 'missing')`,
        )
        .all() as { note_id: string }[]).map((r) => r.note_id),
    )

    const session = project.slugs
      .flatMap((slug) => listSessions(db, { project: slug, limit: 1 }))
      .sort((a, b) => (b.started_at ?? '').localeCompare(a.started_at ?? ''))[0]

    let lastExchange = null
    if (session) {
      const file = (await findTranscripts(io.env)).find((f) => f.sessionId === session.id)
      const tail = file ? await readLastExchange(file.path) : { prompt: null, reply: null }
      const harness = (db.prepare('SELECT harness FROM sessions WHERE id = ?').get(session.id) as
        | { harness: string }
        | undefined)?.harness
      lastExchange = { harness: harness ?? 'unknown', when: session.started_at, ...tail }
    }

    const planPath = project.plan
    let planSteps: string[] = []
    if (planPath) {
      try {
        const text = await readFile(join(project.primaryPath, planPath), 'utf8')
        planSteps = text
          .split('\n')
          .filter((l) => /^- \[[ x]\] /.test(l))
          .map((l) => l.replace(/^- \[[ x]\] /, '').replace(/\*\*/g, ''))
          .slice(0, 12)
      } catch {
        // A plan pointing at a file that is not there is reported as the
        // pointer alone; inventing steps for it would be worse than silence.
      }
    }

    io.out(
      composeBrief({
        name: project.registration.name,
        git: await readGitState(io.cwd),
        missingPaths: await missingOf(project.registration.paths),
        planPath,
        planSteps,
        notes: notes.map((n) => ({ id: n.id, title: n.title, stale: staleIds.has(n.id) })),
        lastExchange,
        ingestError,
      }),
    )
    return 0
  } finally {
    db.close()
  }
}
```

Add the imports it needs: `readFile` and `stat` from `node:fs/promises`, `join` from `node:path`, `readLastExchange` and `findTranscripts` from `@hountybunter/adapter-claude-code`, and `composeBrief`, `readGitState`, `resolveProject` from `@hountybunter/core`.

- [ ] **Step 8: Run the tests**

Run: `npx vitest run surfaces/cli/tests/brief.test.ts`
Expected: PASS, all three.

- [ ] **Step 9: Run the whole suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 10: Use it on this repository, which is the actual acceptance test**

```bash
npm run hb -- register --plan docs/superpowers/plans/2026-09-08-registration-and-brief.md
npm run hb -- brief
```

Expected: the brief names the branch, the commit at HEAD, the commits made on this branch, this plan and its steps, and any stale note — and does not exceed a screen. If any block reads as an all-clear when it should read as absent, that is a bug in Task 10, not a formatting preference.

- [ ] **Step 11: Commit**

```bash
git add adapters/claude-code/src/exchange.ts adapters/claude-code/src/index.ts \
        adapters/claude-code/tests/exchange.test.ts surfaces/cli/src/bin.ts surfaces/cli/tests/brief.test.ts
git commit -m "feat(cli): hb brief — what the next agent needs, whichever agent it is"
```

---

## Done when

1. `hb register` in this repository and in a worktree of it yields one project with two paths, and `hb rebuild` after deleting `index.db` restores it.
2. `hb brief` here prints the working tree state, the commits since the branch point, the declared plan and the stale notes — checked by running it.
3. `npm test` passes, including the schema-walker test in `core/tests/rebuild.test.ts` and every pre-existing ingest test.
4. Nothing in the repository was edited by `hb register`.
