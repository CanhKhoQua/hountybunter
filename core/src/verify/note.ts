import type { Evidence, Note } from '../types.js'
import { verifyEvidence, type EvidenceState } from './evidence.js'

export interface RefResult {
  kind: Evidence['kind']
  ref: string
  state: EvidenceState
  hash?: string
}

export type StaleReason = 'changed' | 'missing' | 'review-due'

export interface NoteVerdict {
  noteId: string
  refs: RefResult[]
  stale: boolean
  reasons: StaleReason[]
}

export async function verifyNote(
  note: Note,
  deps: {
    projectPath: string | null
    sessionExists: (id: string) => boolean
    today: string
  },
): Promise<NoteVerdict> {
  const baselines = new Map((note.verified?.refs ?? []).map((r) => [r.ref, r.hash]))

  const refs: RefResult[] = []
  for (const evidence of note.evidence) {
    const result = await verifyEvidence(evidence, {
      projectPath: deps.projectPath,
      baseline: baselines.get(evidence.ref),
      sessionExists: deps.sessionExists,
    })
    refs.push({ kind: evidence.kind, ref: evidence.ref, ...result })
  }

  // Ordered and deduplicated, so the interface says the same thing about the
  // same note twice running.
  const reasons: StaleReason[] = []
  if (refs.some((r) => r.state === 'changed')) reasons.push('changed')
  if (refs.some((r) => r.state === 'missing')) reasons.push('missing')
  // Dates are `YYYY-MM-DD`, so a string compare is a date compare.
  if (note.review_after && note.review_after < deps.today) reasons.push('review-due')

  return { noteId: note.id, refs, stale: reasons.length > 0, reasons }
}
