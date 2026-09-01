import { recordDecision } from '../note/record.js'
import type { Evidence, Note, RejectedOption } from '../types.js'
import type { Jot, JotOpts } from './store.js'

export async function promoteJot(
  jot: Jot,
  input: {
    question: string
    chosen: string
    title?: string
    rejected?: RejectedOption[]
    evidence?: Evidence[]
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
      // in. Nothing on this path is drafted for them.
      origin: 'authored',
      body: `${jot.text}\n`,
    },
    { env: opts.env, timeZone: opts.timeZone },
  )
}
