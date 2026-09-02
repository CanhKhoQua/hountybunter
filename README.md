# hountybunter

A bounty board for your AI agents, and a field guide to why you built it that way.

Coding agents produce a lot of work and almost no record of *why*. The commit
says what changed; the reasoning was in a session transcript that gets deleted
after thirty days. hountybunter keeps the reasoning.

**Status: early but usable. Phases 1-6 are implemented — the knowledge store,
transcript ingest and archive, a CLI, a local web UI, hooks, and a live agent
session in the browser. No pixel art and no bounties yet; those are phases 7
and 8.**

## What it does today

    hb jot chose SQLite over Postgres because the file outlives the tool
    hb promote 1 --question "Which database?" --chosen "SQLite" \
        --rejected "Postgres :: a server to run for a single-user tool" \
        --evidence commit:a931e2e
    hb search idempotency
    hb list --status standing
    hb ingest              # archive new transcripts, then read them
    hb sessions
    hb rebuild --verify    # rebuild the whole index from the store
    hb web                 # the local UI at http://127.0.0.1:4771

## Where things live

    ~/.hountybunter/
      notes/<project>/*.md      what you wrote
      transcripts/<project>/    verbatim copies of agent sessions
      jots/<date>.md            one-line captures waiting to be promoted
      index.db                  derived, disposable

**Anything you authored is a file. Anything derivable lives in SQLite and can be
thrown away.** Delete `index.db`, run `hb rebuild`, and nothing is lost.

Transcripts are copied into the store because Claude Code deletes its own after
`cleanupPeriodDays` — 30 by default — so `~/.claude/projects` is a rolling
window, not a history. Expect the archive to be the largest thing in the store:
254 transcripts came to 240 MB on the machine this was built on, against 13 MB
of index.

Notes record a decision, and only `question` and `chosen` are required. Every
note also records **how it was written**: `authored` when you typed it,
`drafted` (via `hb promote --drafted`) when an agent worded it and you approved.
A note written before that field existed reads as unknown rather than being
backfilled into a claim nobody made.

## The plugin

Optional, and worth it. Without it, a session spawned from the UI is matched to
its transcript by a heuristic and labelled `guessed`. The plugin's hooks carry
the session id, which makes the match exact.

    /plugin marketplace add /path/to/hountybunter
    /plugin install hountybunter

The hooks never block your session: every path exits 0, every network call is
time-bounded, and an event that cannot be delivered is parked in
`~/.hountybunter/spool.jsonl` for the next `hb ingest`.

## What the local port can do

`hb web` binds `127.0.0.1` and has no authentication, deliberately: it is one
person's tool on their own machine. Worth knowing what that means before
running it anywhere less private than a laptop.

- The UI shows **everything in the store** — prompts, tool inputs and outputs,
  file paths, branch names. Anything a session touched is readable.
- `POST /api/hunts` **starts an agent process** in a directory you name. The
  binary is the server's (`HOUNTYBUNTER_AGENT_CMD`, default `claude`) and never
  the request's, so the port cannot be talked into running something else — but
  it can run that one thing.
- `POST /api/browse` **opens a folder dialog on the desktop**, because a
  browser is never told the absolute path of a directory a person picks.

So anything that can reach the port can read your sessions and start an agent.
Do not forward it, and do not bind it where someone else can reach it.

To check whether the observing half is working at all:

    curl -s http://127.0.0.1:$(cat ~/.hountybunter/port)/api/health

`hookEvents` counts events that arrived, `spooled` counts events a hook parked
because nothing was listening, and `hunts` counts agent processes this server
holds. Zero of the first two means the plugin is not installed — not that
nothing happened.

## Requirements

Node 20 or later.

## Install

    npm install
    ln -s "$PWD/bin/hb" ~/.local/bin/hb    # or any directory on your PATH

There is no build step for the CLI: `bin/hb` runs the TypeScript sources through
`tsx` and locates the repository from its own path, so the symlink keeps
working. The web UI is bundled, so `hb web` needs one build first:

    npm run build:web

## Design

See [the design spec](docs/superpowers/specs/2026-08-27-hountybunter-design.md).
