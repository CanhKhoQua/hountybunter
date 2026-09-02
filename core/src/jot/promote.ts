import { recordDecision } from '../note/record.js'
import type { Evidence, Note, NoteOrigin, RejectedOption } from '../types.js'
import type { Jot, JotOpts } from './store.js'

export async function promoteJot(
  jot: Jot,
  input: {
    question: string
    chosen: string
    title?: string
    rejected?: RejectedOption[]
    evidence?: Evidence[]
    origin?: NoteOrigin
  },
  opts: JotOpts = {},
): Promise<Note> {
  // Dated from the jot's instant, not from now: promotion records when the
  // decision happened, not when it was written up. The jot's text becomes the
  // note's first body paragraph.
  return recordDecision(
    {
      ...input,
      project: jot.project,
      instant: jot.instant,
      // A jot is a line the user typed and a promotion is answers they filled
      // in, so `authored` is the default. A caller says otherwise when an agent
      // did the wording and the user only approved it.
      origin: input.origin ?? 'authored',
      body: `${jot.text}\n`,
    },
    { env: opts.env, timeZone: opts.timeZone },
  )
}
