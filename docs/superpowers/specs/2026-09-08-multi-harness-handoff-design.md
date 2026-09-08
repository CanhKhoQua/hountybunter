# Multi-harness handoff — design

Status: approved 2026-09-08. Supersedes nothing. Builds the `AgentAdapter` seam
§4 of `2026-08-27-hountybunter-design.md` drew but never specified, and adds the
one thing that seam was drawn for: work that survives changing agent mid-task.

## 1. Why this

Claude Code usage runs out mid-task. The next agent to open the repository —
Codex, on this machine, already installed at 0.153.0 — knows the code and knows
nothing about the work: what the goal was, what is done, what was tried and
rejected, what is half-finished on disk.

That is a *content* problem, not a process problem. Launching the other binary
costs a second; recovering the context costs twenty minutes. So this phase does
not spawn Codex, drive Codex, or orchestrate anything. It makes the state a
fresh agent needs live outside any session, in files, and prints it on demand.

Three findings from reading the code and the machine shaped the design more than
any preference did.

**Progress checkboxes are not a progress signal.**
`docs/superpowers/plans/2026-09-02-phase-8a-staleness.md` still carries `- [ ]`
on every step, and 8a merged at `ac3b33f`. Nobody ticks the boxes. Anything
built on them would tell the next agent that nothing has been done, and send it
to redo finished work. Git is the reliable signal: commits happen, and the
messages in this repository are descriptive.

**Branch names do not identify the live plan.** The current branch is
`feat/phase-6-hunt`; the work just finished was 8a staleness and the work next
is 8b. Inferring the plan from the branch would hand the next agent the wrong
plan. The live plan has to be declared, not guessed.

**`projectSlug()` fragments a project across its worktrees.** It is
`basename(path)` plus `sha256(path).slice(0, 6)`, so a worktree resolves to a
different slug, and a note written from a worktree is filed under a project that
is not the one being worked on. This is a live defect, not a hypothetical: this
repository is developed with worktrees.

## 2. Scope

In:

- A project registration record: an authored file naming a project's slug, its
  paths, and the plan currently being worked
- Resolving a session's `cwd` to a registered project, worktrees included
- Recording which harness produced a session
- `hb brief`: everything a fresh agent needs to continue, composed mechanically
- Moving the ingest loop into core behind a `TranscriptSource` seam
- A Codex adapter: locate, read, archive

Out, and each for a reason:

- **Spawning or driving Codex from the web UI.** Codex has no hook system here,
  so correlation would be permanently `guessed` and HP permanently absent. PTY
  parity would buy a worse hunt view.
- **An MCP server.** Both harnesses have a shell and can run `hb`. An MCP
  server is machinery for a solved problem.
- **Session ↔ bounty linking.** Phase 8b's settled scope excludes it, and
  per-project handoff does not need it (§6.1).
- **Machine-written state inside authored files.** Derived state stays in
  SQLite and is rendered at read time (§6.4).
- **Summarising the brief with an LLM.** §9 of the design doc: two mechanisms,
  no magic.
- **Editing the repository's `AGENTS.md` or `CLAUDE.md`.** `hb register` prints
  the line to paste and touches nothing.
- **Migrating notes already filed under a worktree slug.** They stay where they
  are; §5.2 makes them readable anyway without moving a file.

## 3. The registration record

`~/.hountybunter/projects/<slug>.md`, authored, one per project:

```yaml
---
slug: hountybunter-a1b2c3
name: hountybunter
paths:
  - /Users/kobe/Developer/hountybunter
  - /Users/kobe/Developer/hountybunter-wt/phase-8b
git_remote: git@github.com:kobe/hountybunter.git
plan: docs/superpowers/plans/2026-09-02-phase-8a-staleness.md
registered_at: 2026-09-08
---

Free prose. A project's own handoff conventions belong here.
```

- `slug` is `projectSlug()` of the **first** path. Deriving it keeps one naming
  rule in the codebase; declaring it in the file keeps it stable when paths are
  added later.
- `paths` is ordered. The first is primary: new notes are filed under its slug.
- `plan` is **repo-relative**, so it survives the repository moving and reads
  the same from every worktree. Null is a legitimate value: no plan declared,
  and the brief says so rather than guessing one.
- Unknown frontmatter keys round-trip, as notes do.

`hb register [path]` (default `cwd`):

1. If `path` is inside a git worktree, ask git for
   `rev-parse --path-format=absolute --git-common-dir` and derive the main
   worktree. If that path is already registered, **add `path` to that record**
   instead of creating a second project. Not a git repository: register the path
   as given. Nothing here is inferred from names.
2. Write or update the record.
3. Print the one line to paste into `AGENTS.md` / `CLAUDE.md`, and stop. A
   suggestion is not a licence to edit the user's repository.

`hb register --plan <repo-relative-path>` sets or replaces the plan pointer.

A project that was never registered behaves exactly as it does today: ingest
still records it, notes still resolve by `projectSlug(cwd)`. Registration is
additive. What it withholds is the brief.

## 4. Resolving `cwd` to a project

**Longest registered path prefix wins**, so a session opened in a subdirectory
resolves correctly. No match falls back to `projectSlug(cwd)`, today's
behaviour.

Prefix matching is on normalised absolute paths at segment boundaries:
`/a/project-two` must not match a record holding `/a/project`.

## 5. What registration fixes for notes

### 5.1 Writing

New notes are filed under the record's primary slug regardless of which
worktree they were written in. This is the fragmentation fix.

### 5.2 Reading

A record's paths each yield a slug via `projectSlug()`. Reads — the brief, note
lookup, search scoping — use **the whole set**; writes use the primary. Notes
already filed under a worktree slug become visible again without a file being
moved, and no migration is needed. A path removed from a record makes its notes
invisible to the brief again, which is the honest consequence of the user saying
that path is no longer part of the project.

## 6. `hb brief`

Markdown to stdout, capped at ~2 KB. The cap has precedent: §9 of the design
doc caps the `SessionStart` digest at ~10 notes and ~2 KB, with an explicit
anti-goal against bloating an agent's context. A brief that has to be truncated
says so at the cut.

Composed mechanically. No model is called.

### 6.1 Four blocks, most reliable first

1. **In flight now** — branch, last commit, `git status --porcelain`,
   `git diff --stat`. Live, read at brief time, stored nowhere. If a session
   died mid-edit, the working tree is the evidence that survived.
2. **Done so far** — commits from `git merge-base HEAD <default branch>` to
   `HEAD`, default branch read from `origin/HEAD` and falling back to `main`.
   This replaces checkbox state (§1). On the default branch itself the range is
   empty, and the block says so rather than printing the repository's history.
3. **Aiming at** — the declared `plan`, with its step list. The block states
   that checkbox state is unreliable and that block 2 is where completion is
   read from.
4. **Already settled** — standing notes for the project, notes gone stale, and
   the last user prompt plus last assistant message of the most recent session.
   This block is what stops the next agent walking back down a path already
   rejected, which is why `rejected` exists on a note.

Each block names its tier: **declared** (a human wrote it), **observed** (the
tool saw it), or **absent**. Absent is printed as absent. §7.4 of the design doc
sets the precedent — no task list means no bar, not an empty bar.

The brief closes with one instruction: verify against the working tree before
acting. A brief reads as authoritative, and an agent handed something
authoritative will act on it even when it has gone stale.

### 6.2 Per project, not per bounty

Handoff granularity is the project. One `hb register` and every later session in
that directory is attributed with nothing further typed — no per-session
command, which matters because the scenario is a session ending abruptly.

Bounty-level attribution is derived data, so adding it later migrates no
authored file. This is not a one-way door, and it keeps 8b's settled scope
intact.

### 6.3 It ingests first

`hb brief` runs the incremental ingest before printing; `--no-ingest` skips it.
This is a precondition, not a convenience: Codex has no hooks here, so its
rollouts reach the index only through ingest, and a brief that skipped it would
be wrong in exactly the situation it exists for. `ingest_cursors` holds byte
offsets, so the repeat cost is near zero.

If ingest fails, the brief **still prints what the index holds**, with one line
saying ingest failed. Losing the only remaining view of the work is worse than
showing a slightly old one.

### 6.4 The last exchange is read from the archive, not stored

The final prompt and final assistant message come from the tail of the archived
transcript for that session, not from a column. §4 of the design doc restricts
SQLite to "the index and the event log", and the archive is already on disk with
a known path. Reading the tail of one JSONL file is milliseconds.

### 6.5 Where the goal comes from

`hb brief` never composes a next step. If one exists it was written by a human,
in the plan or a note. Nothing written means the block is absent, and the agent
plans as it would have anyway. hountybunter records the plan; it does not make
one.

## 7. The seam

Claude Code's transcript is flat: `ingestAll` reads `raw.cwd`, `raw.gitBranch`,
`raw.aiTitle`, `raw.sessionId` off the record. A Codex rollout is nested —
`{timestamp, type, payload:{…}}` — and `cwd` appears only inside the
`session_meta` payload. One field-reading loop cannot serve both.

What is common is everything around that loop: byte cursors, `seq` numbering,
the session upsert, activity inserts, unknown-kind counting, the transaction.

So:

- **Core owns the loop.** `ingestFrom(db, source, env, now)` in
  `core/src/ingest/`, moved out of `adapters/claude-code/src/ingest.ts`
  substantially unchanged.
- **An adapter owns three things**: where its transcripts are (`liveRoot`,
  `find`), what one of its lines says (`read(line) → LineFacts`), and which
  record kinds it recognises. Each harness has its own known-kind set.

```ts
export type Harness = 'claude-code' | 'codex'

export interface LineFacts {
  ok: boolean            // false counts a skipped line; never throws
  kind: string
  ts: string | null
  cwd: string | null
  branch: string | null
  model: string | null
  title: string | null
  parentId: string | null
  tools: { name: string; attrSkill: string | null; attrPlugin: string | null }[]
}

export interface TranscriptSource {
  readonly harness: Harness
  readonly knownKinds: ReadonlySet<string>
  liveRoot(env: NodeJS.ProcessEnv): string
  find(env: NodeJS.ProcessEnv): Promise<TranscriptFile[]>
  read(line: string): LineFacts
}
```

`TranscriptFile` moves from `adapters/claude-code/src/locate.ts` into core
alongside the interface, since it is now part of the contract rather than one
adapter's detail.

`spawnAgent` and `bindHunt` are untouched and stay Claude Code only. Abstracting
them would add interface methods for a capability nobody ordered.

The verification criterion for this move is exact: **`adapters/claude-code/tests/ingest.test.ts`
passes with no edit.** Needing to change a test means behaviour changed rather
than moved.

## 8. The Codex adapter

Rollouts live at `~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl`.
Line one is `session_meta`, carrying `cwd`, `cli_version`, `originator`, and —
the trap — **`id` is the session's own id while `session_id` is the parent
thread**. Reading the obvious field files every subagent under its parent.

- **Subagents need no schema.** `parent_thread_id` with
  `thread_source: 'subagent'` is the same concept as a Claude Code Task run, and
  `sessions.parent_id` already exists.
- **Correlation is `exact`.** `guessed` exists because a PTY-spawned session has
  to be matched to a transcript. Codex is not spawned here and the id is inside
  the file, so there is nothing to guess. Exact because nothing was inferred,
  not because of confidence.
- **Kind** is the payload's own `type` when present, else the record `type`.
  Unknown kinds are counted and still stored, never dropped (§3.5).
- **Titles** come from `~/.codex/session_index.jsonl` (`thread_name`), not the
  rollout.
- **Archiving is justified for the same reason as Claude Code's 30-day
  cleanup**: `codex archive`, `codex delete` and `migrate-rollouts` all remove
  the original. The archive target is derived from the `cwd` on line one, since
  Codex files are laid out by date rather than by project.

Defensive parsing applies harder than for Claude Code: the format is equally
undocumented and has more record types — `session_meta`, `event_msg`,
`response_item`, `turn_context`, `world_state`, `token_usage_record`,
`inter_agent_communication_metadata` observed so far.

## 9. Error handling

| Failure | Behaviour |
|---|---|
| Registration record malformed | Skipped with a named error; the brief still prints from the index. Same posture as a baseline with no hash being dropped rather than read as empty (`bf70b99`) |
| A registered path no longer exists | Reported in the brief; the record is kept. An unmounted drive is not a deregistration |
| Not a git repository, or git absent | Blocks 1 and 2 are absent; the brief prints the rest |
| No archived transcript for the last session | Block 4's exchange is absent; notes still print |
| Ingest fails during `hb brief` | Print anyway, with one line saying so (§6.3) |
| Codex `session_meta` missing or unparseable | The file is skipped and counted. Without `cwd` there is no project to attribute it to, and guessing one would file work under the wrong project |

## 10. Schema

`SCHEMA_VERSION` 4 → 5. No migration is written: the index is derived, and
`SchemaVersionError` already tells the user to delete and rebuild.

```sql
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

Two tables rather than an `origin` column on `projects`, because `projects`
maintains an invariant that registration breaks: `rememberProject` writes every
row with `slug = projectSlug(path)`, and a registered worktree row would carry a
declared slug that does not match its own path. Keeping the authored rows in
their own table makes the authored/derived split structural instead of a flag,
and leaves `projects` meaning what it means today — paths ingest has seen.

`sessions` gains one column, written into its `CREATE TABLE` in `schema.sql`
rather than added by `ALTER`: SQLite cannot add a `NOT NULL` column without a
default to a populated table, and the rebuild path means it never has to.

```sql
CREATE TABLE IF NOT EXISTS sessions (
  ...
  harness      TEXT NOT NULL,
  parent_id    TEXT
);
```

`NOT NULL` with **no default**. Every writer knows which harness it is, so
there is no row for which the answer is unknown, and a default would be a claim
rather than a fallback. `note_evidence.state` defaults to `unknown` for the
opposite reason: there, not looking is a real state.

## 11. Where the code goes

```
core/src/project/parse.ts        registration record → Registration
core/src/project/store.ts        read/write ~/.hountybunter/projects/*.md
core/src/project/resolve.ts      cwd → slug (longest prefix, then fallback)
core/src/ingest/source.ts        TranscriptSource, LineFacts, Harness
core/src/ingest/run.ts           ingestFrom — the loop, moved from the adapter
core/src/brief/compose.ts        the four blocks, the cap, the tier labels
core/src/brief/git.ts            branch, status, diffstat, commits since fork
adapters/claude-code/src/source.ts   TranscriptSource for flat records
adapters/codex/src/source.ts         TranscriptSource for nested payloads
adapters/codex/src/locate.ts         ~/.codex/sessions walk + session_index
surfaces/cli/src/cli.ts              hb register, hb brief
```

`core/src/frontmatter.ts` — the `str`/`dateStr`/`oneOf` helpers currently
private to `note/parse.ts` — is lifted out here rather than copied, since
registration is the second parser. Phase 8b's design already called for the same
lift; whichever lands first does it.

## 12. Testing

- **Keystone, unchanged and still governing**: delete `index.db`, rebuild,
  identical state. Registration lives in files, so it must survive.
- `hb register` on a repository and on one of its worktrees yields **one** slug
  with two paths, not two projects.
- Prefix matching rejects a sibling directory sharing a name prefix.
- A registration record with an unparseable field is skipped, and the brief
  still prints.
- Reads span every slug a record's paths yield (§5.2); writes go to the primary.
- The Claude Code ingest tests pass unedited after the loop moves.
- Codex fixtures include a malformed line, an unknown record type, and a real
  subagent rollout; the subagent's parent is its `parent_thread_id`, not the
  `session_id` on line one.
- A brief over an empty store reports absence and invents nothing.
- A brief whose exchange exceeds the cap is cut with the cut marked.

## 13. Done when

1. `hb register` run in this repository and in a worktree gives one project with
   two paths, and `hb rebuild` after deleting `index.db` restores it.
2. `hb brief` in this repository prints the working tree state, the commits since
   the branch point, the declared plan, and the stale notes — checked by running
   it, not by reading the code.
3. `adapters/claude-code/tests/ingest.test.ts` passes with no edit.
4. A real Codex rollout ingests with `harness = 'codex'`, its subagent thread
   parented correctly, and appears in the brief labelled as Codex.

## 14. Build order

Four slices, each independently useful, in this order:

| | Slice | Why here |
|---|---|---|
| 1 | Registration, resolution, `sessions.harness`, schema 5 | Everything else reads this |
| 2 | `hb brief` | Already solves the whole scenario: Claude stops, Codex reads the brief and continues. The history it needs is Claude's, and that is already indexed |
| 3 | The `TranscriptSource` seam | Deferred until a second implementation actually exists, rather than refactoring working code on speculation |
| 4 | The Codex adapter | Serves the reverse direction — Codex worked, Claude continues — and the record's completeness |
