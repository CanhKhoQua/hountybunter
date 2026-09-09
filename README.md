# hountybunter

A bounty board for your AI agents, and a field guide to why you built it that way.

Coding agents produce a lot of work and almost no record of *why*. The commit
says what changed; the reasoning was in a session transcript that gets deleted
after thirty days. hountybunter keeps the reasoning.

**Status: early but usable.** The knowledge store, transcript ingest and
archive, a CLI, a local web UI, hooks, and a live agent session in the browser.
A note now says when the evidence it cited stopped matching the code, and a
project can be registered so `hb brief` tells the next agent where the work was
left. No pixel art and no bounties yet.

## What it does today

    hb jot chose SQLite over Postgres because the file outlives the tool
    hb promote 1 --question "Which database?" --chosen "SQLite" \
        --rejected "Postgres :: a server to run for a single-user tool" \
        --evidence commit:a931e2e
    hb search idempotency
    hb list --status standing
    hb verify              # check every note's cited evidence against the code
    hb verify --ack <id>   # you looked, it still holds: record that baseline
    hb ingest              # archive new transcripts, then read them
    hb sessions
    hb rebuild --verify    # rebuild the whole index from the store
    hb register --plan docs/plans/the-one-i-am-working-on.md
    hb brief               # what the next agent needs to continue here
    hb web                 # the local UI at http://127.0.0.1:4771

## Where things live

    ~/.hountybunter/
      notes/<project>/*.md      what you wrote
      projects/<slug>.md        which directories are one project, and its plan
      transcripts/<project>/    verbatim copies of agent sessions
      jots/<date>.md            one-line captures waiting to be promoted
      index.db                  derived, disposable

**Anything you authored is a file. Anything derivable lives in SQLite and can be
thrown away.** Delete `index.db`, run `hb rebuild`, and nothing is lost.

Transcripts are copied into the store because Claude Code deletes its own after
`cleanupPeriodDays` — 30 by default — so `~/.claude/projects` is a rolling
window, not a history. Expect the archive to be the largest thing in the store:
565 transcripts came to 396 MB on the machine this was built on, against 20 MB
of index.

Notes record a decision, and only `question` and `chosen` are required. Every
note also records **how it was written**: `authored` when you typed it,
`drafted` (via `hb promote --drafted`) when an agent worded it and you approved.
A note written before that field existed reads as unknown rather than being
backfilled into a claim nobody made.

A note can cite evidence — a file, a commit, a session, a URL — and evidence
rots. `hb verify` checks each reference and reports one of four states, and the
distinction that matters is between *changed* and *could not be checked*: a
permission error, or a project directory that has since been removed, is
**unknown**, never *missing*. Reporting those as missing would invent staleness,
and a record that cries wolf gets ignored. `hb verify --ack <id>` records that a
human looked and it still holds; the baseline it compares against lives in the
note's own frontmatter, because the index is meant to be deletable.

## Handing work to the next agent

Usage runs out mid-task. The next agent to open the repository — a fresh
session, or a different tool entirely — knows the code and knows nothing about
the work: what the goal was, what is done, what was tried and rejected, what is
half-finished on disk. Launching another agent costs a second; recovering that
context costs twenty minutes.

`hb register` declares, in a file, what a project *is*:

    hb register                                    # this directory
    hb register --plan docs/plans/phase-9.md       # and what you are working on

It writes `~/.hountybunter/projects/<slug>.md` and prints the line to paste into
`AGENTS.md` or `CLAUDE.md`. It does not edit your repository — a suggestion is
not a licence to write in someone else's files.

The record lists every directory that is the same project, which is the point:
project slugs are derived from the path, so a git worktree hashed to a different
slug and notes written from a worktree were filed under a project that was not
the one being worked on. Registering the worktree adds it to the record instead
— `hb register` asks git where the main worktree is rather than guessing from
directory names. Reads then span every directory's slug and writes go to the
first, so notes filed before you registered anything become visible again
without a file moving.

Then, from a cold start:

    hb brief

Four blocks, most reliable first: what is uncommitted right now, the commits on
this branch since it left the default branch, the plan you declared, and the
decisions already settled. Each block says whether a human **declared** it or
the tool **observed** it, and a block with nothing behind it prints as *absent*
rather than as an all-clear. No model is called; nothing is summarised. It
ingests first, and if that fails it still prints what the store holds with one
line saying so — this is the command for when everything else has already gone
wrong.

It is capped at 2 KB, because a brief that floods a fresh agent's context defeats
itself. When it cannot fit, it gives up the most recoverable content first — the
diffstat before the plan's steps, the steps before the commit list, the commits
before the settled decisions, and the uncommitted files last, since those are the
evidence a session dying mid-edit left behind. Every omission says how much was
dropped; nothing is silently trimmed.

Two honest limits. The brief closes by telling you to verify against the working
tree, because it reads as authoritative and will be acted on after it has gone
stale. And its "last exchange" block takes the most recent session, which on a
machine that runs non-interactive agents can be a synthesized prompt rather than
anything a person said.

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
