# Phase 8a — note staleness

Status: approved 2026-09-02. Supersedes nothing; narrows §7.3 of
`2026-08-27-hountybunter-design.md` into something buildable.

## 1. Why this, and why before the pixels

The build order in the design doc puts the pixel layer at phase 7 and bounties
plus staleness at phase 8. Reading the code first turned that order around.

Fog of war is phase 7's one mechanic that carries real information rather than
decoration, and §5 says so plainly: *"Stale knowledge is fog creeping back. One
mechanism serves both the game and the product."* But the mechanism does not
exist. `note_evidence` carries `ok` and `last_verified_at` columns and nothing
has ever written to either. Fog built before staleness would be a shader over a
constant.

Two more findings pushed the same way:

- **The HP bar has no data source.** §7.4 says v1 reads the Task tool's item
  list. `activities` stores `tool_name` and no payload, and `hook_events` — the
  one table with `payload_json` — is empty because hooks are not arriving. HP is
  a capture change, not a drawing change.
- **§7.4 names the wrong tool.** It says `TaskCreate`/`TaskUpdate`/`TaskList`
  "replaced `TodoWrite`". The transcripts on this machine hold 37 `TodoWrite`
  calls, 2 `TaskStop`, and no `TaskCreate`/`TaskUpdate`/`TaskList` at all.
  Whoever implements HP should read the transcripts before trusting §7.4.

Sprites also need CC0 asset packs chosen and license-verified by the repository
owner (§3.4), which is not work this phase can do on its own.

So: staleness first. It makes the notes that already exist more useful on its
own, and it is the input phase 7 needs.

**Bounties are explicitly out of scope.** They are a new file kind, a lifecycle
(`open → hunting → blocked → felled | abandoned`) and a `gh` dependency. That is
its own phase — 8b.

## 2. Scope

In:

- Verifying a note's `evidence` against what is on disk and in git
- A four-state result per evidence reference, and a stale verdict per note
- A way to say "still true" that re-baselines the note
- `hb verify`, and verification folded into `hb ingest`
- Stale surfaced in the web UI: notes list, note detail, region counts

Out:

- Bounties (phase 8b)
- Any drawing (phase 7)
- The HP bar and its capture path
- Verifying `url` evidence — see §5; this is a decision, not an omission

## 3. Four states, not two

`note_evidence.ok INTEGER` cannot hold the answer. It becomes
`state TEXT NOT NULL DEFAULT 'unknown'`:

| state | meaning |
|---|---|
| `verified` | checked, and it matches the baseline |
| `changed` | checked, and the hash differs |
| `missing` | the thing cited no longer exists |
| `unknown` | **could not be checked** — repo absent from this machine, `projects.path` null, git unavailable |

`missing` is separate from `changed` because they differ in kind. An edited file
means the note's conclusion *may* no longer hold; a deleted file means the note
points at nothing. The interface has to be able to say which.

**`unknown` alone never makes a note stale.** This is the load-bearing rule. A
tool that cannot tell "I checked and it changed" from "I could not check"
produces fog that means nothing, and fog that means nothing gets ignored —
taking the honest signal down with it.

## 4. The note-level verdict

A note is stale when **any** of its evidence is `changed` or `missing`, **or**
`review_after` has passed.

`review_after` is already in the note schema (§6.1 of the design doc) and
nothing reads it. It gives staleness a second source that needs no hashing at
all, and it is the only source that works for a note whose evidence is entirely
`url` or entirely unresolvable.

## 5. How each evidence kind is checked

| kind | check | `unknown` when |
|---|---|---|
| `file` | resolve `ref` relative to the `projects.path` for the note's slug; exists? sha256 matches baseline? | no `projects` row, or the path is not on disk |
| `commit` | `git cat-file -e <sha>^{commit}` in the project directory | not a git repo, or git is unavailable |
| `session` | is the id still in `sessions`? | never — always answerable |
| `url` | **not checked** | always |

### `url` is deliberately never verified

A network check would mark every note stale the moment the machine is offline,
which converts fog of war into a mass false alarm and trains the user to
disregard it. An unreachable host and a dead link are also not distinguishable
without a policy about retries and timeouts that this tool has no reason to own.

Recorded here so a later reader finds a decision rather than a gap, and does not
"fix" it.

## 6. Where the baseline lives

In the note file, in a `verified:` block of its own:

```yaml
evidence:
  - {kind: file,   ref: src/lib/persister.ts}
  - {kind: commit, ref: 9f2c1ab}
  - {kind: url,    ref: https://example.invalid/adr}

verified:
  on: 2026-09-02
  refs:
    - {ref: src/lib/persister.ts, hash: sha256:1f3b…}
```

**Only `file` refs appear.** A commit either resolves or it does not, and a
session id either is in the index or is not; neither has a prior value worth
recording, so writing one down would be bookkeeping that can only go stale on
its own. `url` refs are absent for the reason in §5. `verified.on` covers the
whole note: it is the date a human last looked, whatever the evidence kinds.

Two further decisions, both consequential.

**It lives in the note file, not the index.** The index is rebuildable from the
markdown on disk — that is Phase 1's acceptance criterion, and `rebuildFromDisk`
clears the tables to enforce it. A baseline held only in SQLite would be
destroyed by the very operation the project treats as its safety net. So the
baseline survives in the file, or it does not survive.

**It is separate from `evidence:`.** `evidence` is what a person declared; the
`verified` block is what the tool measured. §6.1's whole argument is that the
note is a human record, and folding machine bookkeeping into the human's list
erodes that. The two are matched on `ref`; a `verified` entry with no matching
`evidence` row is ignored rather than being an error, because a person editing
their own note by hand must not be able to break it.

Rejected alternatives:

- *Hash inline in each `evidence` entry.* One list, no matching by `ref`. But it
  changes the schema of the human's record, and every note `hb promote` writes
  would carry machine hashes from birth.
- *A `<note-id>.verified.json` sidecar.* Note files stay pristine, but the store
  gains a second file kind, and a note copied or moved on its own silently loses
  its baseline.

### A note with no baseline yet

Every note that exists today has no `verified:` block, so a `file` ref has
nothing to compare against. That state is **`unknown`**, not `changed`: the tool
has not been told what the note was written against, and guessing would mean
declaring the whole store either stale or fresh on a coin toss.

The alternative — having the first `hb verify` silently stamp a baseline into
every note file — was rejected. It would make an ordinary read-shaped command
rewrite the user's entire store on its first run, and it would record "a human
confirmed this" about notes no human had looked at. `verified.on` means someone
looked; it must not be written by a command nobody pointed at a note.

So verification reports how many notes have no baseline and names the one
command that sets one (§7). Day one is a prompt, not a wall of false alarms.

## 7. Saying "still true"

`hb verify --ack <note-id>` reads what is on disk now and rewrites the note's
`verified:` block from it. The baseline becomes the present, and the note stops
flagging until the next change.

Without this, content-hash staleness is unusable on an active repository: every
commit touching a cited file lights up every note citing it, forever, with no
way to say the conclusion still holds. A signal that cannot be cleared is noise.

The web equivalent is `POST /api/notes/:id/verified`, which writes the same block
through the same code. The tool already writes note files (`POST /api/notes`
records a decision), so this adds no new class of permission.

## 8. Where the code goes

A new `core/src/verify/`:

- `evidence.ts` — verify one reference, return one state. Knows nothing about
  SQLite; takes a project path and a baseline, returns a verdict.
- `note.ts` — verify one note: per-reference results plus the note verdict of §4.
- `acknowledge.ts` — rewrite a note's `verified:` block.

In `core` rather than in a surface, because the CLI and the web server both call
it, and because it is domain logic rather than presentation.

## 9. Surfaces

**CLI**

- `hb verify` — every note, with a report; names how many notes have no baseline
- `hb verify <note-id>` — one note
- `hb verify --ack <note-id>` — re-baseline one note
- `hb verify --ack --all` — re-baseline every note. The one command §6 points a
  first-time user at, and the only way a baseline is ever written to a note the
  user did not name
- `hb ingest` — runs verification at the end, so the common path needs no second
  command anyone has to remember. It never writes a baseline

**Web**

- Notes list: a stale note carries a badge, reusing `BADGE` in warn
- Note detail: the state of each evidence reference, and a **Still true** button
- Regions: a `stale` count alongside `notes`, so fog can thicken with the ratio

## 10. Error handling

One note that cannot be verified must not cost the run — the rule
`rebuildFromDisk` already applies to a note that cannot be parsed. Missing git,
missing repository, permission denied and unreadable file all resolve to
`unknown`. None of them raises.

## 11. Schema

`SCHEMA_VERSION` 3 → 4.

- `note_evidence.ok INTEGER` → `state TEXT NOT NULL DEFAULT 'unknown'`
- `note_evidence.last_verified_at` stays, and starts being written

`SchemaVersionError` already tells the user to rebuild, and the rebuild is safe
precisely because §6 put the baseline in the files.

No `notes.stale` column. It is derived from a join; denormalising it would give
the index a second source of truth to keep honest.

## 12. Testing

- **core** — each kind against each of the four states; a note with mixed
  evidence; a `review_after` in the past; a note with no baseline reading
  `unknown` rather than `changed`; `hb ingest` and a plain `hb verify` leaving
  every note file byte-for-byte untouched; `--ack` writing a file that still
  round-trips byte-identically, which the existing note round-trip test already
  guards
- **rebuild** — a `verified:` block survives `rebuildFromDisk`. This is the
  single test that proves §6; if it fails, the design is wrong rather than the
  code
- **routes** — state reaches the API; the acknowledge endpoint rewrites the file
- **client** — the stale badge, per-evidence state, the Still true button

## 13. Done when

A note whose cited file has been edited says so, a note whose cited file was
deleted says something different, a note nobody could check says neither — and
one command clears any of them once a human has looked.
