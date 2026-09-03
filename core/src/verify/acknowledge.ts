import { writeNote } from '../note/store.js'
import type { Note, VerifiedRef } from '../types.js'
import { verifyNote } from './note.js'

/**
 * Re-baseline a note against what is on disk right now, and write it.
 *
 * The only path that writes a `verified` block. `hb ingest` and a plain
 * `hb verify` deliberately do not: `verified.on` claims a human looked, and a
 * command nobody pointed at a note is not entitled to claim that.
 */
export async function acknowledgeNote(
  note: Note,
  deps: {
    projectPath: string | null
    sessionExists: (id: string) => boolean
    today: string
  },
  env: NodeJS.ProcessEnv = process.env,
): Promise<Note> {
  const verdict = await verifyNote(note, deps)

  // Only what was actually read. A ref with no hash is a file that could not be
  // opened, a commit, a session, or a url — none has a prior value, and
  // inventing one would make the next run compare against a fiction.
  const refs: VerifiedRef[] = verdict.refs.flatMap((r) =>
    r.hash ? [{ ref: r.ref, hash: r.hash }] : [],
  )

  const acked: Note = { ...note, verified: { on: deps.today, refs } }
  await writeNote(acked, env)
  return acked
}
