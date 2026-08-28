import matter from 'gray-matter'
import { basename } from 'node:path'
import {
  CONFIDENCES,
  EVIDENCE_KINDS,
  NOTE_KINDS,
  NOTE_STATUSES,
  type Confidence,
  type Evidence,
  type Note,
  type NoteKind,
  type NoteStatus,
  type RejectedOption,
} from '../types.js'

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
  'id', 'title', 'project', 'kind', 'status', 'decided_on', 'question',
  'chosen', 'rejected', 'evidence', 'confidence', 'review_after', 'supersedes',
])

function str(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value)
}

/**
 * Frontmatter dates need care. YAML 1.1 parses an unquoted `2026-08-12` into a
 * Date anchored at UTC midnight, and String(date) would render it in the
 * machine's local zone — shifting the calendar day west of UTC. Take the UTC
 * date components, which are exactly the day the file's author wrote.
 */
function dateStr(value: unknown): string {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? '' : value.toISOString().slice(0, 10)
  }
  return str(value)
}

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
    kind: oneOf<NoteKind>(data.kind, NOTE_KINDS, 'kind', sourcePath, 'decision')!,
    status: oneOf<NoteStatus>(data.status, NOTE_STATUSES, 'status', sourcePath, 'standing')!,
    decided_on: dateStr(data.decided_on) || null,
    question,
    chosen,
    rejected: parseRejected(data.rejected),
    evidence: parseEvidence(data.evidence),
    confidence: oneOf<Confidence>(data.confidence, CONFIDENCES, 'confidence', sourcePath, null),
    review_after: dateStr(data.review_after) || null,
    supersedes: parseStringList(data.supersedes),
    body: parsed.content,
    extra,
    sourcePath,
  }
}
