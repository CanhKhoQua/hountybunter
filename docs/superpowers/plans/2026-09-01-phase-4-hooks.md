# hountybunter Phase 4: Hook Receiver and Plugin — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Live events from Claude Code arriving in the store within
milliseconds, and — the reason this phase comes before the hunt view — a
`session_id` known from the outside, so a session can be bound to its
transcript exactly rather than guessed.

**Why now, out of spec order.** Phase 5 was built first and works.

A correction to an earlier reading of §7.4: a session found by transcript
ingest is already `exact`, because its id is the transcript's filename — there
is nothing to guess. Verified against the real store: 162 of 162 sessions read
`exact` with no hooks installed at all. `guessed` arises only in phase 6, where
the UI spawns `claude` itself and has to work out which transcript is its own.

Phase 4 still comes first, for the narrower reason §7.4 actually gives: the
hook payload carries `session_id`, and that is what lets a PTY-spawned session
be bound rather than inferred. The second reason is latency — the transcript is
read on a timer, so without hooks nothing in the UI is live.

**Architecture:** The plugin ships `hooks.json` posting to
`http://127.0.0.1:<port>/hook`. The receiver is one more route in the phase 5
route table — no second server. Events land in `hook_events` and update
`sessions`. The hook script itself is the smallest thing that can post and
exit: it never waits for a reply, and it never fails loudly.

**Tech Stack:** unchanged. `node:http` (already serving), `better-sqlite3`,
Vitest. The hook script is POSIX `sh` with `curl`, so it depends on nothing
this machine does not already have.

**Spec:** `docs/superpowers/specs/2026-08-27-hountybunter-design.md` §7.2, §7.4, §10

**Spike already done (2026-09-01).** `@homebridge/node-pty-prebuilt-multiarch`
installs from prebuilt binaries on darwin arm64 / Node 22.14 with no build
tools and no advisories, and `claude` 2.1.235 runs under a PTY (real tty,
window size propagated, exit 0). §14's highest-rated install risk is therefore
retired for this machine. The dependency is **not** added until phase 6 needs
it.

## Global Constraints

- **A hook must never block or slow Claude Code.** Always exits 0. Always
  time-bounded. Fire-and-forget: it does not read the response body. If the
  server is down or the port file is missing, it appends to a spool file and
  still exits 0. A harness that degrades its owner's actual work is worse than
  no harness. (Spec §7.2)
- **No hardcoded port in the hook config.** The server writes its live port to
  `~/.hountybunter/port`; the hook reads that file. A port conflict must never
  require editing the user's settings. (Spec §7.2)
- **The receiver is idempotent.** The same event delivered twice — a retry, a
  spool replayed after a live delivery — produces one row. (Spec §4)
- **A hook payload is untrusted input.** Unknown event kinds are stored with
  their raw payload and counted, never dropped and never fatal. Malformed JSON
  is answered 400 and counted, not thrown. (Spec §3.5, §10)
- **Correlation is stated, never implied.** A session bound from a hook
  `session_id` is `exact`; one inferred from `cwd` plus time stays `guessed`
  and the UI keeps saying so. (Spec §7.4, §10)
- **Still read-only on source code.** (Spec §2)
- **Out of scope:** the PTY and the hunt view (phase 6), SSE streaming to the
  browser (the UI may poll for now), pixels, bounties, Agent SDK.

---

## File Structure

```
core/
  src/db/schema.sql               + hook_events
  src/hooks/
    receive.ts                    one event -> rows, idempotent
    spool.ts                      read and replay the spool file
  src/paths.ts                    + portFile, spoolFile

surfaces/web/
  src/server/routes.ts            + POST /hook
  src/server/serve.ts             writes the live port file on listen

.claude-plugin/
  plugin.json
  hooks/hooks.json                every hook points at one script
  hooks/post-event.sh             posts and exits 0, always
```

**Why the receiver is a route, not a service.** One process, one port, one
place that knows how to open the database. A second server would need its own
lifecycle, its own port discovery, and its own failure mode for no gain.

---

## Task 1: Port and spool locations

- [ ] **Step 1: Write the failing test** — `portFile` and `spoolFile` sit under
      the store root and follow `HOUNTYBUNTER_HOME`.
- [ ] **Step 2: Run test to verify it fails.**
- [ ] **Step 3: Write minimal implementation** in `core/src/paths.ts`.
- [ ] **Step 4: Run test to verify it passes.**
- [ ] **Step 5: Commit** — `feat(core): locate the port and spool files`

## Task 2: `hook_events`, and receiving one event

- [ ] **Step 1: Write the failing test** — `receiveHookEvent` inserts a row;
      the same event twice yields one row; an event carrying `session_id` and
      `cwd` upserts the session and sets `correlation = 'exact'`; an unknown
      `hook_event_name` is stored with its payload and counted; an event with no
      `session_id` is rejected with a message rather than stored.
- [ ] **Step 2: Run test to verify it fails.**
- [ ] **Step 3: Write minimal implementation** — schema addition plus
      `core/src/hooks/receive.ts`. **Do not bump `SCHEMA_VERSION`.** The schema
      is applied with `CREATE TABLE IF NOT EXISTS`, so a new table appears on
      the next open; bumping would make every existing index throw and force a
      delete-and-rebuild to gain nothing. The guard exists for changes that
      make an old index *wrong*, and adding a table is not one.
- [ ] **Step 4: Run test to verify it passes**, plus a rebuild-from-disk run
      proving `hook_events` is still derived and disposable.
- [ ] **Step 5: Commit** — `feat(core): receive a hook event idempotently`

## Task 3: `POST /hook`

- [ ] **Step 1: Write the failing test** — a valid payload returns 204 with an
      empty body; malformed JSON returns 400 and does not throw; the response
      arrives without waiting on anything slow.
- [ ] **Step 2: Run test to verify it fails.**
- [ ] **Step 3: Write minimal implementation** in `routes.ts`.
- [ ] **Step 4: Run test to verify it passes.**
- [ ] **Step 5: Commit** — `feat(web): accept hook events on POST /hook`

## Task 4: The live port file

- [ ] **Step 1: Write the failing test** — `serve()` writes the bound port to
      `portFile` on listen, including when it was asked for port 0; the file is
      removed on close, so a stale file never points at a dead server.
- [ ] **Step 2: Run test to verify it fails.**
- [ ] **Step 3: Write minimal implementation.**
- [ ] **Step 4: Run test to verify it passes.**
- [ ] **Step 5: Commit** — `feat(web): publish the live port for hooks to find`

## Task 5: The hook script, which must never hurt

- [ ] **Step 1: Write the failing test** — run `post-event.sh` as a process
      against a live receiver and assert the row landed; run it with **no
      server at all** and assert it still exits 0 and appends one line to the
      spool; run it with a **garbage port file** and assert the same; assert it
      returns in under a second when the port is black-holed.
- [ ] **Step 2: Run test to verify it fails.**
- [ ] **Step 3: Write minimal implementation** — `curl` with `--max-time`,
      output discarded, `exit 0` unconditionally.
- [ ] **Step 4: Run test to verify it passes.**
- [ ] **Step 5: Commit** — `feat(plugin): a hook that cannot fail loudly`

## Task 6: Replaying the spool

- [ ] **Step 1: Write the failing test** — replaying a spool inserts the
      events; replaying twice inserts nothing extra; a corrupt line is skipped
      and counted, not fatal; a successful replay truncates the spool.
- [ ] **Step 2: Run test to verify it fails.**
- [ ] **Step 3: Write minimal implementation** — `core/src/hooks/spool.ts`,
      called on `hb ingest` and on server start.
- [ ] **Step 4: Run test to verify it passes.**
- [ ] **Step 5: Commit** — `feat(core): replay events that arrived while down`

## Task 7: The plugin manifest

- [ ] **Step 1: Write the failing test** — `hooks.json` parses, every event
      points at the one script, and no entry contains a literal port.
- [ ] **Step 2: Run test to verify it fails.**
- [ ] **Step 3: Write minimal implementation** — `.claude-plugin/`.
- [ ] **Step 4: Run test to verify it passes.**
- [ ] **Step 5: Commit** — `feat(plugin): ship the hook manifest`

## Task 8: Exact correlation, end to end

- [ ] **Step 1: Write the failing test** — a session created by transcript
      ingest alone reads `guessed`; after a hook for the same `session_id`
      arrives it reads `exact`; the reverse order gives the same result, since
      delivery order is not something a hook can promise.
- [ ] **Step 2: Run test to verify it fails.**
- [ ] **Step 3: Write minimal implementation.**
- [ ] **Step 4: Run test to verify it passes.**
- [ ] **Step 5: Commit** — `feat(core): bind a session exactly once a hook names it`

---

## Done when

Hooks installed, a Claude Code session run in any project shows up in `hb web`
while it is still running, marked `exact` — and stopping the server mid-session
loses nothing, because the events land in the spool and replay.

## Verification that is not a unit test

- Kill the server mid-session, keep working in Claude Code, restart: every
  event is present after replay, exactly once.
- Point the port file at a closed port and confirm Claude Code shows no lag.
- Run with the plugin installed for a full working day before phase 6 begins.
  A hook that harms the session it observes must be found by living with it,
  not by a test.
