# hountybunter

A bounty board for your AI agents, and a field guide to why you built it that way.

**Status: early. Phases 1-3 and 5 are implemented — the knowledge store, Claude
Code transcript ingest, a CLI, and a local web UI. No pixels and no live
session yet; those are phases 6 and 7.**

## What it does today

    hb jot chose SQLite over Postgres because the file outlives the tool
    hb promote 1 --question "Which database?" --chosen "SQLite" \
        --rejected "Postgres :: a server to run for a single-user tool" \
        --evidence commit:a931e2e
    hb search idempotency
    hb list --status standing
    hb ingest
    hb sessions
    hb rebuild --verify
    hb web                 # the local UI at http://127.0.0.1:4771

Notes are markdown files under `~/.hountybunter/notes/`. The SQLite index is
derived and disposable: delete it, run `hb rebuild`, and nothing is lost.

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
