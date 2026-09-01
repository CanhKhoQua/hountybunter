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
