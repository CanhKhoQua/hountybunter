# What the handoff phase left open — the next slice

Status: written 2026-09-09, after registration and `hb brief` landed at `683175f`. Not a plan; the
four items below need a decision or a design before they need code, and one of them is not the
agent's to make.

The handoff design's own later slices — the `TranscriptSource` seam and the Codex adapter — are
deliberately not here. They wait on a second implementation actually existing, per §14 of
`2026-09-08-multi-harness-handoff-design.md`. What follows is what this slice left behind.

## 1. A worktree reads the wrong plan

`hb brief` resolves the plan against `project.primaryPath` while it reads git state from `io.cwd`
(`surfaces/cli/src/bin.ts`). So a session in a worktree checked out on another branch is shown that
branch's commits beside the *main* worktree's copy of the plan — or an absent step list, when the
plan file exists only on the worktree's branch.

This inverts the reason the field is repo-relative at all. Spec §3: `plan` is repo-relative "so it
survives the repository moving and reads the same from every worktree."

The fix is small and the information already exists: `resolveFrom` computes `best.path` — the
longest registered path that matched — and then throws it away. Expose it as `matchedPath` on
`ResolvedProject` and resolve the plan against that. The reason to treat this as design rather than
a one-liner is the question it raises: **is `matchedPath` the right thing for every other consumer
too?** Notes are filed under the primary slug on purpose, so at least one caller must keep using
`primaryPath`. Whatever lands should say which of the two each caller wants and why.

## 2. A note recorded in a worktree points at a directory that will not exist — settled

**Settled 2026-09-09 at `0281621`.** This section originally framed the question as a trade between
accuracy at the moment of writing and durability, and asked the user to choose. That framing was
wrong, and the codebase had already answered it.

The symptom was real: a note promoted from a worktree records that worktree as its `project_path`,
`git worktree remove` is ordinary, and afterwards every `file:` reference under it hit `ENOENT`, was
read as `missing`, and made `hb brief` label the note "stale — its evidence stopped matching". The
evidence had not changed. The directory holding it had gone.

But `core/src/verify/evidence.ts` already draws the distinction that resolves it. Its `hashFile`
comment says: *"Only 'it is not there' is news about the note. Permission denied, a ref that names a
directory, a descriptor limit — none of those is evidence that anything changed, and reporting them
as `missing` invents staleness."* `verifyEvidence` short-circuits to `unknown` when it has no project
path, and `staleNoteIds` excludes `unknown` on purpose — *"a reference nobody could check is not
evidence of anything."* Commit `d8293ed` made exactly this call for a single unreadable file.

A vanished project directory is the same class of fact. So `projectPathFor` now returns `null` when
the path it would otherwise return is not on disk — symmetrically, whether that path came from the
note or from the `projects` row — and everything downstream already does the right thing.

Nothing moved, provenance is kept, and no path was chosen over another.

**Why the `projects` row is deliberately not a fallback.** That row names a different working tree
than the note's author looked at. Measured with a recorded baseline, a removed worktree, and a
primary tree whose copy of the cited file differs — as it would on another branch:

| | state | stale |
|---|---|---|
| worktree alive, acknowledged | `verified` | no |
| what ships: directory gone -> unknown | `unknown` | **no** |
| the old behaviour | `missing` | yes |
| falling back to the `projects` row | `changed` | yes |

The fallback trades a false "stale" for a false "evidence changed", which is worse because it looks
plausible. That is why it is not there.

## 3. `hb register` does not mirror what it wrote

`cmdRegister` writes the record and returns; the `registered_projects` / `registered_paths` rows
stay stale until the next `hb rebuild`. `cmdPromote` ten lines away does the opposite and says why
in a comment: "writing one without the other leaves `hb search` unable to find a note that
demonstrably exists — which is exactly what the README's own sequence did."

Harmless today, because nothing reads those rows outside tests. It stops being harmless the moment
a surface reads registration from the index — which the web UI will, since that is where it reads
everything else.

## 4. The brief names decisions without saying how to read them

Block 4 prints note titles. `BriefNote` carries an `id` that is collected and never rendered, and
nothing in the brief or in the line `hb register` prints mentions `hb list` or `hb search`.

Spec §6.1 calls this block "what stops the next agent walking back down a path already rejected,
which is why `rejected` exists on a note" — but a title is not a rejection. The agent learns that
decisions exist and cannot read one. Printing the id costs nothing; a single line pointing at
`hb list --project <slug>` costs one line of the budget the ladder now manages honestly.

## Also outstanding, smaller

- The committed minimality sweep for `composeBrief` fixes `dirty: []`, so the property is not
  exercised against the last-resort rung. An independent sweep with a non-empty dirty list found no
  violation, so this is coverage rather than a suspected bug.
- `RebuildReport.errors` wraps registration errors in `NoteParseError`, so the type says the wrong
  thing about its contents.
- `hb rebuild` computes `projectsRegistered` and never prints it: a rebuild restores registrations
  and says nothing about them.
- `readLastExchange` reads the whole transcript where spec §6.4 says "reading the tail" — measured
  at 103 ms and 238 MB peak on a 40 MB file. Time is fine; the memory peak is real.

## One thing to know before touching `composeBrief`

It shipped four separate defects across four review rounds, every one arithmetic about its own
output size: an unbudgeted separator newline, a doubled terminator at the call site, a
marker-boundary non-monotonicity, and cross-rung slack that only appeared once minimality was
asserted as a property. Three of the four passed a review that checked "never over cap" and "no bare
markers" — both of which were true in each defective case.

Measure over a **sweep** of caps and assert minimality. A fixture at one cap will pin the symptom
you already found and miss the next one.
