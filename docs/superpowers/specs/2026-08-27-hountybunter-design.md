# hountybunter — design

> A bounty board for your AI agents, and a field guide to why you built it that way.

**Status:** design approved in conversation, not yet implemented
**Date:** 2026-08-27
**Author:** Loc Nguyen

---

## 1. Purpose

A local-first harness for running and reviewing AI coding agents, where the
durable output is not the agent run but **the recorded reason a technical
decision was made**.

The problem it solves is narrow and personal: six months after choosing a
stack, the reasoning is gone. Git history shows *what* changed. Issues show
*what was asked*. Neither records *which alternatives were weighed and why they
lost* — the question people actually ask in a review, an interview, or a
handover.

Four capabilities, one record underneath them:

| Capability | What it is |
|---|---|
| Knowledge | Decision records: the question, the options rejected, the evidence |
| Work items | Bounties — thin tracking of what is being hunted |
| Progress | What agents are doing now, and what they did before |
| Agent memory | Feeding standing decisions back into new agent sessions |

### Positioning

Multi-agent orchestration is a crowded field (Claude Squad ~5.8k stars,
Conductor, Vibe Kanban, and Agent Teams now built into Claude Code). The
orchestration surface here is deliberately not the differentiator.

**The differentiator is the knowledge layer.** Every design decision below is
resolved in favour of knowledge durability when the two conflict.

---

## 2. Non-goals

| Not building | Why |
|---|---|
| Auth, multi-user, cloud sync | Single local user. Adds an axis of complexity nobody asked for |
| A GitHub Issues replacement | `gh` is the source of truth for anything linked to an issue |
| Vector / embedding search | SQLite FTS5 + grep first. Only add embeddings when FTS5 demonstrably fails |
| A Mem0 / Zep / Letta-style memory layer | Those solve *conversational* memory — recalling facts about a user across sessions — and are benchmarked on LoCoMo and LongMemEval, which "only test conversational memory". This tool needs decision *provenance*: the question, the options rejected, the anchor in the repo. Structure and anchoring, not fuzzy recall |
| Edits or commits to the user's source code | Read-only on source. No auto-edit, no auto-commit, ever. Note files are the one thing written, and only where §6.2 allows |
| A combat minigame | Progress comes from real signals, never from clicking |
| An Electron app or VS Code extension | See §3.2 — avoiding Electron removes a whole class of native-module failure |

---

## 3. Hard constraints

These are external and non-negotiable. They shape the architecture more than
any preference does.

### 3.1 Agent SDK licensing forces two modes

The Agent SDK documentation states that, unless previously approved, Anthropic
does not allow third-party developers to offer claude.ai login or rate limits
for their products, including agents built on the Agent SDK; API key
authentication must be used instead.

Consequence: a published tool that *drives* Claude through the SDK requires
every user to supply an API key and pay API rates. A tool that *observes*
Claude Code and *launches* the real CLI lets users keep their own subscription.

Therefore two modes behind one seam:

| Mode | Mechanism | Auth | Role |
|---|---|---|---|
| **Observe** (default) | Hooks + transcript JSONL; spawns the real `claude` CLI in a PTY | user's own subscription | Daily use. The mode that makes the tool publishable |
| **Drive** (opt-in) | Agent SDK, agent loop in our process | user's own API key | Unattended jobs |

`AgentAdapter` is the only seam between the core and any agent CLI. This
mirrors the `ErpAdapter` inversion used in `open-dms`.

### 3.2 No Electron

`node-pty` pain is specifically about matching Electron's Node ABI. Shipping as
a **local web app** (`npx hountybunter` → localhost, opened in the browser)
leaves only the Node ABI to satisfy.

- Browser: `xterm.js`
- Server: `node-pty`, via `@homebridge/node-pty-prebuilt-multiarch` (prebuilt
  binaries, API-compatible, installs without build tools)

The PTY runs the real `claude` binary, which preserves subscription auth per
§3.1 while still giving a real terminal inside the UI.

### 3.3 Branding

Anthropic does not permit "Claude Code" in a product name, nor visual elements
that mimic Claude Code. "Powered by Claude" is permitted. The name
`hountybunter` and the bounty-hunter theme are unaffected.

### 3.4 Asset licensing: CC0 only

A public repository redistributes its assets. "Free to use" is not "free to
redistribute" — CraftPix's freebie license, for example, forbids passing the
art files to another end user, which a public GitHub repo does.

**Policy: accept CC0 assets only.** One license, no attribution bookkeeping, no
share-alike contamination of an MIT repo.

- Characters/creatures: PixelMotion (itch.io) — CC0 catalogue, ~170 fully
  animated sprites (beasts, monsters, fighters, casters, animals, elementals)
- UI chrome (panels, bars, buttons): Kenney — CC0
- **Avoid** the Universal LPC set: excellent animation coverage but CC-BY-SA
  3.0 / GPL3, requiring `CREDITS.csv` and share-alike on derivative art

Every asset's license file must be verified on download and recorded in
`assets/CREDITS.md`. CC0 governs rights, not price; some CC0 packs are paid.

### 3.5 The transcript format is undocumented

Claude Code's transcript JSONL is not a published contract and can change. This
is the single most likely cause of the tool breaking. See §7.1 for the
defensive-parsing requirement.

---

## 4. Architecture

```
┌─ surfaces (thin; no business logic) ────────────────────┐
│   web (pixel UI)   ·   CLI   ·   Claude Code plugin     │
└────────────────────────┬────────────────────────────────┘
                         │  query + command API
┌────────────────────────▼────────────────────────────────┐
│  core                                                    │
│    domain:  Project · Bounty · Session · Activity · Note │
│    store:   SQLite (index + events)  +  .md on disk      │
└────────────────────────▲────────────────────────────────┘
                         │  AgentAdapter  ← the only seam
┌────────────────────────┴────────────────────────────────┐
│  adapters/claude-code   →  hooks (live) + transcript     │
│  adapters/<future>      →  codex, gemini, cursor…        │
└─────────────────────────────────────────────────────────┘
```

### Layout (npm workspaces)

```
core/            domain + store + query/command API  (imports nothing from surfaces)
adapters/
  claude-code/     hook receiver + transcript reader
surfaces/
  cli/             bin; fast capture and lookup
  web/             pixel UI (React + canvas)
  plugin/          .claude-plugin/ + hooks.json + commands/*.md
assets/            CC0 sprites + CREDITS.md
docs/              this spec, and the project's own decision records
```

### Storage decisions

**`better-sqlite3`**, not `node:sqlite`. Node's built-in module does not
compile FTS5, and FTS5 is the search strategy (§2). better-sqlite3 ships FTS5
by default and is the fastest driver. WAL mode, so CLI and server can both
read.

**Decision text lives in markdown files on disk; SQLite holds only the index
and the event log.** Files are greppable, diffable, editable in any editor, and
survive the tool being abandoned. Knowledge must outlive the tool that reads
it.

**Rule: SQLite is derived and disposable.** Delete the database, re-ingest from
transcripts and markdown, and the state is identical. This is enforced by the
keystone test (§11).

Stated as one line with no exceptions:

> **Anything the user authored is a file. Anything derivable lives in SQLite and
> can be thrown away.**

| Authored → file on disk | Derived → SQLite, disposable |
|---|---|
| Notes (§6.1) | Note index, FTS5 index |
| Bounties (§8) | Sessions, activities (from transcript JSONL) |
| Per-project config | Ingest cursors, evidence-check results |

Bounties are files for exactly this reason: a local-only bounty with no GitHub
issue behind it would otherwise exist *only* in SQLite, and deleting the
database would silently lose work the user typed. One rule with no exceptions is
worth a little extra file I/O.

**UI updates over SSE**, not WebSocket — simpler, and one-directional is all
that is needed for pushing state to the view.

---

## 5. Theme mapping

The theme is not skin. The metaphor determines what the UI can express without
strain.

```
Region / hunting ground →  Project
Monster                 →  Bounty target: a bug, feature, migration
Hunt (the terminal)     →  A Claude Code session. You fight by typing
HP bar                  →  Work remaining, from real signals (§7.4)
Hunter's Notes          →  Decision records  ★ the knowledge core
Gear / loadout          →  Reusable decisions: stack choices earned from past hunts
Companions              →  Subagents
Camp                    →  Project config: repo, branch, defaults
Unexplored region       →  Projects with no notes yet  (fog of war)
Carted / fainted        →  Session failed, blocked, or awaiting approval
```

Two properties of this metaphor are load-bearing:

1. **Hunter's Notes fill in progressively and are never complete** — which is
   the truth about documentation. A half-filled entry is an honest picture of
   partial understanding. The theme therefore *rewards* recording, rather than
   merely displaying records.
2. **Stale knowledge is fog creeping back.** When a note's evidence changes
   (§6, §7.3), the region it documents darkens again. One mechanism serves both
   the game and the product.

Monster Hunter is the reference rather than a generic RPG deliberately: it has
almost no XP or levelling. Progression is gear plus knowledge of the quarry —
the two things this tool tracks. Generic RPG framing would import XP, loot, and
combat, none of which map to real work.

Avoid Capcom trademarks (Palico, "Monster Hunter", specific monster names).
Generic hunting and guild vocabulary is free.

---

## 6. Data model

Five entities. The fifth is the point of the project.

### 6.0 Capture has two tiers, because ceremony is what kills this

The dominant failure mode for decision records is not a bad schema — it is
abandonment. Published experience with ADRs is blunt: almost every team adopts
them and almost none maintain them two years later, and the pattern "has very
little to do with template choice." The named causes are operational: updating
the file is friction, and the decision happened somewhere else. Teams do not
keep records alive when each one feels like a mini whitepaper.

The full note below has twelve frontmatter fields. That *is* a mini whitepaper.
So capture is two-tier:

| Tier | Cost | Shape |
|---|---|---|
| **Jot** | one line, seconds | `<project> · <one sentence>` appended to a dated file. No fields, no ceremony |
| **Note** | minutes | The full record below, written when a jot turns out to matter |

Required fields on a full note are only **`question`** and **`chosen`**.
Everything else — `rejected`, `evidence`, `confidence`, `review_after` — is
optional and can be filled in later. A note with one rejected option is worth
more than a perfect note that was never written.

Promotion is a command, not a migration: a jot keeps its timestamp and becomes
the note's first body paragraph.

### 6.1 Note — the decision record

A markdown file on disk with YAML frontmatter, indexed in SQLite.

```yaml
---
id: 2026-08-12-offline-reads
title: Offline reads for the rep PWA
project: tnm-dms
kind: decision                 # decision | gotcha | lesson
status: standing               # standing | superseded | reversed
decided_on: 2026-08-12
question: "How do reps keep working through 1-3 minute network gaps?"
chosen: "TanStack Query v5 + idb-keyval persister"
rejected:
  - option: "Full offline sync engine with a mutation queue"
    why_not: "Needs idempotency keys and conflict resolution. Field network gaps
              are 1-3 minutes, not hours — the cost is not repaid"
  - option: "Service worker cache only"
    why_not: "Caches responses, not query state; list screens still flash empty"
evidence:
  - {kind: file,    ref: src/lib/query/persister.ts}
  - {kind: commit,  ref: <sha>}
  - {kind: session, ref: <session-uuid>}
confidence: high               # high | medium | low
review_after: 2027-02-01       # optional
supersedes: []
---

Body: the reasoning, in prose.
```

Four schema decisions:

1. **`rejected` is a structured array, not prose.** "Why not the alternative"
   is the highest-value and fastest-lost piece of information, and it is what
   reviewers ask about. Structuring it makes it queryable and makes its absence
   visible.
2. **`status` + `supersedes`.** Decisions get replaced. A knowledge base that
   cannot say "this replaced that" actively misleads its reader later.
3. **`evidence` anchors the note to the repository.** This is what separates
   the tool from a notes app: the harness can detect when a cited file has
   changed or disappeared, and flag the note as possibly stale.
4. **`review_after`** drives a "due for review" surface. Optional.

### 6.2 Where note files live

Default: a central store, **`~/.hountybunter/notes/<project-slug>/*.md`**. This
keeps the tool out of the user's repositories entirely, which is the safe
default and the one that needs no permission.

Opt-in per project: a configured in-repo path, e.g. `docs/decisions/`. Versioned
with the code, visible in pull requests, and it travels when the repo is cloned
— a real gain for a knowledge tool, but it is a write into someone's repository,
so it is never the default and is never inferred.

The read-only rule (§2, §10) is therefore precisely: **the tool never modifies
source code and never commits.** It writes note files, to its own store by
default, or to an explicitly configured repository path.

### 6.3 SQLite schema (index and events only)

```sql
projects(path PK, name, git_remote, last_seen_at)
bounties(id PK, project, title, status, created_at, closed_at, difficulty, ext_ref)
sessions(id PK, project, bounty_id, started_at, ended_at, branch, model, effort,
         correlation)                      -- 'exact' | 'guessed'
activities(id PK, session_id, ts, kind, tool_name, attr_skill, attr_plugin,
           payload_json)
notes(id PK, project, path, title, kind, status, decided_on, confidence,
      review_after, hash)
note_evidence(note_id, kind, ref, last_verified_at, ok)
notes_fts                                  -- FTS5 over title, body, question,
                                           -- chosen, rejected
ingest_cursors(file_path PK, byte_offset, last_seen_at)
```

---

## 7. Ingest and data flow

```
~/.claude/projects/*/*.jsonl ──┐
   (backfill + history)        │
                               ├──► core ingest ──► SQLite ──┐
plugin hooks → POST :port ─────┤     (idempotent)            ├─► SSE ─► UI
   (live, ~0 latency)          │                             │
                               │                notes/*.md ──┘
node-pty spawn `claude` ───────┘
```

### 7.1 Transcript reader

Watches transcript files per project directory, tracking a **byte offset per
file** in `ingest_cursors` so reads are incremental rather than full reparses.

Observed fields worth mapping: `cwd`, `gitBranch`, `effort`, `aiTitle`,
`attributionSkill`, `attributionPlugin`, `attributionMcpTool`,
`attributionMcpServer`; record types including `user`, `assistant`,
`attachment`, `system`, `file-history-snapshot`, `queue-operation`. Session id
is the transcript filename UUID. Tool calls come from `tool_use` content blocks
inside `assistant` records.

**Defensive parsing is a requirement, not a nicety** (§3.5):

- Unknown record types are stored as `kind: 'unknown'` with the raw payload.
  Never dropped, never fatal.
- A malformed JSON line is skipped and counted, and the count is surfaced in a
  health view rather than swallowed.
- Parser behaviour is pinned by fixtures that include malformed lines and
  unknown types (§11).

**First run backfills from all existing transcripts.** The UI opens populated
rather than empty — which matters for daily usefulness and for the repository's
screenshots.

### 7.2 Hook receiver

The plugin ships `hooks.json` posting to `http://127.0.0.1:<port>/hook`. Hooks
provide low-latency signals the transcript cannot give promptly: session start,
pre/post tool use, awaiting permission, stop.

Port discovery: the server binds a fixed default (`4771`) and writes the live
port to `~/.hountybunter/port`. The hook script reads that file; if it is
missing or the connection is refused, the hook spools and exits 0. Hooks are
never configured with a hardcoded port, so a port conflict does not require
editing the user's settings.

**Rule: a hook must never block or slow Claude Code.** Always exit 0, always
time-bounded, fire-and-forget; if the server is down, append to a spool file
for later ingest. A harness that degrades its owner's actual work is worse than
no harness.

### 7.3 Note staleness

For each `note_evidence` row, periodically verify the reference: does the file
still exist, has its content hash changed, does the commit still resolve. On
change, mark `ok = false` and surface the note as stale — the fog-of-war
mechanic in §5.

### 7.4 Session correlation and the HP signal

Correlating a PTY-spawned session to a transcript is the one genuinely
uncertain step. `cwd` plus start time is a heuristic; the **hook payload
carries `session_id`**, which makes it exact.

Resolution order:
1. Spawn `claude` in the PTY.
2. Wait for the first hook whose `cwd` matches → bind `session_id`,
   `correlation = 'exact'`.
3. No hooks installed → fall back to the newest transcript in that project
   directory, `correlation = 'guessed'`. The UI shows guessed correlations as
   guessed; it does not present them as certain.

**HP is a fraction: work remaining over work known.** The bar renders
`remaining / total`, so it empties as work completes and re-fills honestly when
new work is discovered mid-session.

- v1 source: the session's Task tool list (`TaskCreate` / `TaskGet` /
  `TaskUpdate` / `TaskList`, which replaced `TodoWrite`) — `remaining` = open
  items, `total` = all items. A structured progress signal already being
  emitted, so nothing new has to be inferred.
- Later: a bounty may declare its own `checks` (named test commands), with
  `remaining` = checks still failing.
- No task list and no checks → no bar. An absent signal is shown as absent, not
  as a full or empty bar.

---

## 8. Bounties (work items)

Deliberately thin.

- **A bounty is a markdown file**, in the same store as notes (§4, §6.2), with
  frontmatter: `id`, `project`, `title`, `status`, `difficulty`, `ext_ref`,
  `created_at`, `closed_at`. SQLite only indexes it.
- Optional `ext_ref` to a GitHub issue or PR. **If linked, `gh` is the source
  of truth** — no two-way sync.
- Local-only bounties exist for work not worth an issue. Because they are files,
  they survive the database being deleted.
- Status: `open → hunting → (blocked) → felled | abandoned`
- One bounty spans many sessions. One session targets at most one bounty.

---

## 9. Agent memory retrieval

Two mechanisms, no magic.

1. **Explicit lookup** — a `/notes` plugin command running FTS5 + grep and
   printing results. Cheap, predictable, no surprises.
2. **A capped digest on `SessionStart`** — standing decisions for this project,
   plus any note whose evidence has gone stale. **Hard cap** (~10 notes, ~2 KB).

**Anti-goal: never auto-inject on every prompt.** That is how memory systems
bloat context and make models follow stale instructions. Recalled notes are
background context, not instructions, and the digest is worded to say so.

---

## 10. Error handling

| Failure | Behaviour |
|---|---|
| Server down when a hook fires | Hook exits 0; event appended to spool file |
| Unknown transcript record type | Stored as `unknown` with raw payload |
| Malformed JSON line | Skipped, counted, surfaced in health view |
| PTY process dies | Session marked `ended`; history retained |
| SQLite corrupt | Delete and rebuild from transcripts + markdown |
| Cannot correlate a session | Marked `guessed`, displayed as such |
| Any user source file | Never modified, never committed. Note files go to the tool's own store, or to a path the user configured (§6.2) |

---

## 11. Testing

In order of value:

| Test | What it protects |
|---|---|
| **`rebuild-from-scratch`** | **The keystone.** Ingest fixtures twice → identical state. Proves ingest is idempotent and SQLite is genuinely disposable |
| Parser fixtures | Real anonymised transcript lines, including malformed lines and unknown record types |
| Note round-trip | `.md` → index → query → `.md`, lossless |
| Staleness detection | Change a referenced file → note flagged |
| E2E with a fake `claude` binary | A stub in the PTY emitting scripted hook calls. **CI needs no API key** — otherwise E2E will not run in CI, and therefore will not run |
| Multi-timezone | Suite runs under several `TZ` values. Timezone bugs are invisible to a team in one zone and appear only elsewhere |

---

## 12. Repository and OSS presentation

The repository is a portfolio artifact; presentation is part of the work.

- README: banner, screenshot, GIF, badges, honest scope statement
- `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, `CHANGELOG.md`
  (keep-a-changelog)
- `LICENSE`: MIT for code; `assets/CREDITS.md` recording CC0 asset sources
- prettier, eslint, knip (unused code), husky
- **CI's most valuable job: an `npx` smoke test on macOS, Linux, and Windows.**
  `node-pty` is risk number one; CI must prove installation works on all three,
  or "npx and it runs" is only a hope.

---

## 13. Build order

Each phase ends with something usable, so the project survives being paused.

| Phase | Delivers | Done when |
|---|---|---|
| 1 | `core` domain + SQLite schema + note read/write | `rebuild-from-scratch` passes over note files alone (no transcripts yet) |
| 2 | Transcript reader + backfill | All existing local transcripts ingest; parser fixtures pass |
| 3 | CLI: **jot** (one line), promote to note, search, list sessions | Usable daily without any UI. `jot` must be fast enough to use mid-task without breaking flow — that is the acceptance criterion, not a nice-to-have |
| 4 | Hook receiver + plugin | Live events arrive; hooks proven non-blocking |
| 5 | Web UI, non-pixel: projects, sessions, notes | Everything visible in a browser |
| 6 | PTY + `xterm.js` hunt view | A session can be launched and driven from the UI |
| 7 | Pixel layer: sprites, HP bar, fog of war | Screenshot-worthy |
| 8 | Bounties + staleness detection | Work tracking and fog-creep working |
| 9 | Drive mode (Agent SDK, opt-in) | Unattended runs |
| 10 | OSS polish + 3-OS CI | Publishable |

Phase 3 is the first point of real daily value; phase 7 the first point of
demo value. Ordering knowledge before pixels means an abandoned project still
leaves a working knowledge tool.

**Ten phases are too many for one implementation plan.** The first plan covers
**phases 1–3** and ends at the first point of daily value: notes captured,
searched, and rebuilt from disk, driven from a CLI, with no UI and no hooks.
Phases 4+ get their own plans once phase 3 has been used for real.

---

## 14. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| **Nobody keeps writing the notes** | **Highest** | This is the documented cause of death for decision records, and it is behavioural, not architectural. Three defences: two-tier capture so a record costs one line (§6.0); the tool sits inside the session where the decision actually happens, so recording is not a separate errand; and staleness detection (§7.3) surfaces records that have drifted from the code instead of letting them rot unnoticed |
| Transcript format changes | High | Defensive parsing (§7.1); hooks as an independent source |
| `node-pty` install failures | High | Prebuilt multiarch; no Electron; 3-OS CI smoke test |
| Scope: four subsystems in one project | High | Phased build order (§13); each phase independently useful |
| Pixel art consumes the schedule | Medium | CC0 packs, no original art; pixels are phase 7, not phase 1 |
| Reads as a pixel-agents reimplementation | Medium | Knowledge layer is the headline; different theme; different form factor |
| Orchestration space is crowded | Medium | Not competing there (§1) |

---

## 15. Open questions

- npm name `hountybunter` was unregistered as of 2026-08-27 but is not yet
  claimed.
- Whether `bounties` earns its place before phase 8, or whether GitHub Issues
  plus `ext_ref` is sufficient indefinitely.
- Whether to import from the existing `~/.claude/projects/*/memory/` layout on
  first run. Those files already hold real decisions and would seed the store
  usefully, but their frontmatter is a different shape (`type:` rather than
  `kind:`, no `rejected`, no `evidence`), so an import is lossy in one direction
  and would need a mapping decision. §6.2 settles where notes are *written*;
  this is only about seeding.

---

## 16. References

- [Effective context engineering for AI agents (Anthropic)](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) — file-based memory tool, structured note-taking, just-in-time retrieval by file path, "smallest set of high-signal tokens"
- [Architecture Decision Records: lightweight docs that survive team turnover](https://blog.codercops.com/blog/architecture-decision-records-2026) — "Decision Documentation Theater"; why ADRs die, and why template choice is not the cause
- [ADR templates and operational patterns for teams that actually maintain them](https://hidekazu-konishi.com/entry/architecture_decision_records_templates_and_operations.html)
- [State of AI Agent Memory 2026 (Mem0)](https://mem0.ai/blog/state-of-ai-agent-memory-2026) · [Agent memory frameworks compared (Vectorize)](https://vectorize.io/articles/best-ai-agent-memory-systems) — Mem0 / Zep / Letta architectures, LoCoMo and LongMemEval scope
- [Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview) — third-party auth restriction, branding, SDK vs CLI
- [A harness for every task: dynamic workflows in Claude Code](https://claude.com/blog/a-harness-for-every-task-dynamic-workflows-in-claude-code)
- [SQLite driver benchmark](https://sqg.dev/blog/sqlite-driver-benchmark/) · [node:sqlite lacks FTS5](https://github.com/openclaw/openclaw/issues/3776)
- [xterm.js](https://github.com/xtermjs/xterm.js/) · [node-pty](https://www.npmjs.com/package/node-pty) · [Electron/Node ABI conditional rebuild](https://github.com/coder/mux/pull/624)
- [CraftPix file licenses](https://craftpix.net/file-licenses/) — redistribution prohibition
- [PixelMotion CC0 catalogue](https://itch.io/profile/pixelmotion1) · [Kenney Pixel UI Pack](https://kenney.nl/assets/pixel-ui-pack)
- [Universal LPC Spritesheet](https://github.com/liberatedpixelcup/Universal-LPC-Spritesheet-Character-Generator) — CC-BY-SA, why it is excluded
- [pixel-agents](https://github.com/pixel-agents-hq/pixel-agents) — form-factor reference
- Landscape: [Nimbalyst](https://nimbalyst.com/blog/best-multi-agent-coding-tools-2026/) · [Tembo](https://www.tembo.io/blog/claude-code-multi-agent-orchestration)
