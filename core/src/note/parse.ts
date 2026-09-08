import matter from 'gray-matter'
import { basename } from 'node:path'
import {
  CONFIDENCES,
  EVIDENCE_KINDS,
  NOTE_KINDS,
  NOTE_ORIGINS,
  NOTE_STATUSES,
  type Confidence,
  type Evidence,
  type Note,
  type NoteKind,
  type NoteOrigin,
  type NoteStatus,
  type RejectedOption,
  type Verified,
} from '../types.js'
import { dateStr, str } from '../frontmatter.js'

export class NoteParseError extends Error {
  constructor(
    message: string,
    readonly sourcePath: string,
    readonly field?: string,
  ) {
    super(message)
    this.name = 'NoteParseError'
  }
}

/** Frontmatter keys the schema knows. Everything else is preserved in `extra`. */
const KNOWN_KEYS = new Set([
  'id', 'title', 'project', 'project_path', 'kind', 'status', 'decided_on', 'question',
  'chosen', 'rejected', 'evidence', 'verified', 'confidence', 'review_after', 'supersedes', 'origin',
])

function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string,
  sourcePath: string,
  fallback: T | null,
): T | null {
  if (value == null || value === '') return fallback
  const s = str(value)
  if (!allowed.includes(s as T)) {
    throw new NoteParseError(
      `${field} must be one of ${allowed.join(', ')} — got "${s}"`,
      sourcePath,
      field,
    )
  }
  return s as T
}

function parseRejected(value: unknown): RejectedOption[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (entry == null || typeof entry !== 'object') return []
    const record = entry as Record<string, unknown>
    const option = str(record.option)
    if (!option) return []
    return [{ option, why_not: str(record.why_not) }]
  })
}

function parseEvidence(value: unknown): Evidence[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (entry == null || typeof entry !== 'object') return []
    const record = entry as Record<string, unknown>
    const kind = str(record.kind)
    const ref = str(record.ref)
    if (!ref || !EVIDENCE_KINDS.includes(kind as Evidence['kind'])) return []
    return [{ kind: kind as Evidence['kind'], ref }]
  })
}

function parseVerified(value: unknown): Verified | null {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const refs = Array.isArray(record.refs)
    ? record.refs.flatMap((entry) => {
        if (entry == null || typeof entry !== 'object') return []
        const row = entry as Record<string, unknown>
        const ref = str(row.ref)
        // A nameless baseline matches no evidence row, so it can only mislead.
        if (!ref) return []
        const hash = str(row.hash)
        // A hand-edited entry with no hash is not the same as one with an
        // empty-string hash: `''` is not `undefined`, so it would compare
        // unequal to any real hash and read as `changed` — a false stale from
        // exactly the hand-editing this tolerance exists for.
        if (!hash) return []
        return [{ ref, hash }]
      })
    : []
  return { on: dateStr(record.on), refs }
}

function parseStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map(str).filter(Boolean)
}

export function parseNote(raw: string, sourcePath: string): Note {
  const parsed = matter(raw)
  const data = parsed.data as Record<string, unknown>

  const question = str(data.question)
  if (!question) {
    throw new NoteParseError('note is missing required field: question', sourcePath, 'question')
  }
  const chosen = str(data.chosen)
  if (!chosen) {
    throw new NoteParseError('note is missing required field: chosen', sourcePath, 'chosen')
  }

  const extra: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(data)) {
    if (!KNOWN_KEYS.has(key)) extra[key] = value
  }

  return {
    id: str(data.id) || basename(sourcePath).replace(/\.md$/, ''),
    title: str(data.title) || question,
    project: str(data.project),
    project_path: str(data.project_path) || null,
    kind: oneOf<NoteKind>(data.kind, NOTE_KINDS, 'kind', sourcePath, 'decision')!,
    status: oneOf<NoteStatus>(data.status, NOTE_STATUSES, 'status', sourcePath, 'standing')!,
    decided_on: dateStr(data.decided_on) || null,
    question,
    chosen,
    rejected: parseRejected(data.rejected),
    evidence: parseEvidence(data.evidence),
    verified: parseVerified(data.verified),
    confidence: oneOf<Confidence>(data.confidence, CONFIDENCES, 'confidence', sourcePath, null),
    review_after: dateStr(data.review_after) || null,
    supersedes: parseStringList(data.supersedes),
    origin: oneOf<NoteOrigin>(data.origin, NOTE_ORIGINS, 'origin', sourcePath, null),
    body: parsed.content,
    extra,
    sourcePath,
  }
}
