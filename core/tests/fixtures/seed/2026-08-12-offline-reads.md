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
