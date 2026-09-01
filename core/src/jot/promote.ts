import { makeNoteId, writeNote } from '../note/store.js'
import { calendarDate, resolveTimeZone } from '../time.js'
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
  const question = input.question.trim()
  if (!question) throw new Error('promotion requires a question')
  const chosen = input.chosen.trim()
  if (!chosen) throw new Error('promotion requires chosen')

  const env = opts.env ?? process.env
  const timeZone = opts.timeZone ?? resolveTimeZone(env)
  const title = input.title?.trim() || question

  // Dated from the jot's instant, not from now: promotion records when the
  // decision happened, not when it was written up.
  const note: Note = {
    id: makeNoteId(title, jot.instant, timeZone),
    title,
    project: jot.project,
    kind: 'decision',
    status: 'standing',
    decided_on: calendarDate(jot.instant, timeZone),
    question,
    chosen,
    rejected: input.rejected ?? [],
    evidence: input.evidence ?? [],
    confidence: null,
    review_after: null,
    supersedes: [],
    body: `${jot.text}\n`,
    extra: {},
    sourcePath: '',
  }

  note.sourcePath = await writeNote(note, env)
  return note
}
