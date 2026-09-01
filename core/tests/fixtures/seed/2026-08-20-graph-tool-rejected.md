---
id: 2026-08-20-graph-tool-rejected
title: Code-graph tooling evaluated and rejected
project: tnm-dms-000000
kind: decision
status: standing
decided_on: 2026-08-20
question: Is a code-graph indexer worth adding to the workflow?
chosen: No indexer; plain grep and ripgrep
rejected:
  - option: A code-graph indexing tool
    why_not: >-
      A short grep reproduced the only output that had value, and the tool
      removed directories without saying so.
confidence: high
---

The valuable output was a list of call sites, which search already produces.
