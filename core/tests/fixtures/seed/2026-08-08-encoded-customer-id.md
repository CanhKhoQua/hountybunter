---
id: 2026-08-08-encoded-customer-id
title: Customer ids arrive encoded and must be decoded in the route
project: tnm-dms-000000
kind: gotcha
status: standing
decided_on: 2026-08-08
question: Why did check-in return 500 with no error message?
chosen: Decode the customer id in the route before it reaches SQL
rejected:
  - option: Pass the id through unchanged
    why_not: >-
      The encoded form produced a SQL error that surfaced only as a silent 500,
      with nothing in the response to point at the cause.
confidence: high
---

The failure had no message anywhere in the response, which is why it took so
long to find.
