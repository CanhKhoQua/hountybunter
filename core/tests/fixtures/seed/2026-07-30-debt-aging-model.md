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
