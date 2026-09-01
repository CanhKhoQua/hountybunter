export const VERSION = '0.0.0'

export const NOTE_KINDS = ['decision', 'gotcha', 'lesson'] as const
export type NoteKind = (typeof NOTE_KINDS)[number]

export const NOTE_STATUSES = ['standing', 'superseded', 'reversed'] as const
export type NoteStatus = (typeof NOTE_STATUSES)[number]

/**
 * How a note came to be written. Stamped by the write path itself, never
 * inferred from the content: a decision a person reasoned out and one an agent
 * drafted for them read alike on the page but do not carry the same weight.
 */
export const NOTE_ORIGINS = ['authored', 'drafted'] as const
export type NoteOrigin = (typeof NOTE_ORIGINS)[number]

export const CONFIDENCES = ['high', 'medium', 'low'] as const
export type Confidence = (typeof CONFIDENCES)[number]

export const EVIDENCE_KINDS = ['file', 'commit', 'session', 'url'] as const
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number]

export interface RejectedOption {
  option: string
  why_not: string
}

export interface Evidence {
  kind: EvidenceKind
  ref: string
}

export interface Note {
  id: string
  title: string
  project: string
  kind: NoteKind
  status: NoteStatus
  decided_on: string | null
  question: string
  chosen: string
  rejected: RejectedOption[]
  evidence: Evidence[]
  confidence: Confidence | null
  review_after: string | null
  /** Null for a note written before the channel was recorded — absent, not assumed. */
  origin: NoteOrigin | null
  supersedes: string[]
  body: string
  /** Frontmatter keys we do not know about, preserved for a lossless round trip. */
  extra: Record<string, unknown>
  sourcePath: string
}
