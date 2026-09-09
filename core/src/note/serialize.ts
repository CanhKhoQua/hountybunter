import matter from 'gray-matter'
import type { Note } from '../types.js'

/**
 * Note -> markdown. Optional fields that are empty are omitted rather than
 * written as null, so a minimal note stays minimal on disk and re-reading it
 * yields the same object.
 */
export function serializeNote(note: Note): string {
  const data: Record<string, unknown> = {
    id: note.id,
    title: note.title,
    project: note.project,
    // Beside the slug it is the slug of: together they say one thing, and a
    // reader who sees only `hountybunter-a70452` cannot tell where that is.
    ...(note.project_path ? { project_path: note.project_path } : {}),
    kind: note.kind,
    status: note.status,
  }

  if (note.decided_on) data.decided_on = note.decided_on
  data.question = note.question
  data.chosen = note.chosen
  if (note.rejected.length > 0) data.rejected = note.rejected
  if (note.evidence.length > 0) data.evidence = note.evidence
  if (note.verified) data.verified = note.verified
  if (note.confidence) data.confidence = note.confidence
  if (note.review_after) data.review_after = note.review_after
  if (note.supersedes.length > 0) data.supersedes = note.supersedes
  if (note.origin) data.origin = note.origin

  for (const [key, value] of Object.entries(note.extra)) data[key] = value

  return matter.stringify(note.body, data)
}
