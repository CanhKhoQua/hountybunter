import { calendarDate, resolveTimeZone } from '../time.js'
import type { Evidence, Note, NoteOrigin, RejectedOption } from '../types.js'
import { makeNoteId, writeNote } from './store.js'

export interface DecisionInput {
  project: string
  /** When the decision happened, ISO 8601 UTC — not when it was written up. */
  instant: string
  question: string
  chosen: string
  /**
   * Which write path this came through. Required, and deliberately not
   * defaulted: a caller that has not said whether a person or an agent produced
   * the reasoning should not be able to claim quietly that a person did.
   */
  origin: NoteOrigin
  title?: string
  rejected?: RejectedOption[]
  evidence?: Evidence[]
  /** Ids of the notes this one replaces. */
  supersedes?: string[]
  body?: string
}

export interface RecordOpts {
  env?: NodeJS.ProcessEnv
  timeZone?: string
}

/**
 * Build and write a decision record. Shared by `hb promote` and the web
 * surface so a note recorded in a browser and one recorded at the prompt are
 * the same file, built by the same code.
 */
export async function recordDecision(input: DecisionInput, opts: RecordOpts = {}): Promise<Note> {
  const question = input.question.trim()
  if (!question) throw new Error('a decision record requires a question')
  const chosen = input.chosen.trim()
  if (!chosen) throw new Error('a decision record requires chosen')

  const env = opts.env ?? process.env
  const timeZone = opts.timeZone ?? resolveTimeZone(env)
  const title = input.title?.trim() || question

  const note: Note = {
    id: makeNoteId(title, input.instant, timeZone),
    title,
    project: input.project,
    kind: 'decision',
    status: 'standing',
    decided_on: calendarDate(input.instant, timeZone),
    question,
    chosen,
    rejected: input.rejected ?? [],
    evidence: input.evidence ?? [],
    confidence: null,
    review_after: null,
    origin: input.origin,
    supersedes: input.supersedes ?? [],
    body: input.body ?? '',
    extra: {},
    sourcePath: '',
  }

  note.sourcePath = await writeNote(note, env)
  return note
}
