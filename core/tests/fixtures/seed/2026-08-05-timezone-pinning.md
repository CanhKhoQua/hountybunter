---
id: 2026-08-05-timezone-pinning
title: Timezone for server-side date calculations
project: tnm-dms-000000
kind: decision
status: standing
decided_on: 2026-08-05
question: Which timezone do server-side date calculations use?
chosen: Pin UTC+7 explicitly; local-time getters are banned
rejected:
  - option: Rely on the server's local timezone
    why_not: >-
      The development machine and the users are eleven to fourteen hours apart,
      so the bug is invisible to the people who would notice it and appears only
      on the developer's machine.
confidence: high
---

Tests must run under more than one TZ, or the ban is unenforced.
