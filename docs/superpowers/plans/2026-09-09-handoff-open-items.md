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

## 2. A note recorded in a worktree points at a directory that will not exist

**This one needs a human decision, not a review.**

After registration, a note promoted from a worktree is filed under the project's primary slug —
correct — but still records the worktree's own directory as `project_path`. `git worktree remove` is
an ordinary part of a worktree's life, and once it happens every `file:` reference on that note
resolves to nothing. `verifyNote` reads that as `missing`, and `hb brief` then labels the note
"stale — its evidence stopped matching", which is false: the evidence did not change, the directory
holding it went away.

Two options, and they trade different things:

- **Record `resolved.primaryPath`.** Durable: the path outlives any worktree. But it is not where
  the note was written, and on a branch where the cited file does not exist it is wrong in a
  different way.
- **Keep the worktree path.** Accurate at the moment of writing, and wrong the moment the worktree
  is removed.

A third possibility worth weighing: let `projectPathFor` fall back to the `projects` row when
`project_path` no longer exists on disk. That keeps the accurate value and degrades to the durable
one, at the cost of a stat on a read path.

Half of this predates the phase — a note has always recorded a path that could vanish. What the
phase added is the *opportunity* to record a durable one and not taking it.

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
