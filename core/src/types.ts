export const VERSION = '0.0.0'

export const NOTE_KINDS = ['decision', 'gotcha', 'lesson'] as const
export type NoteKind = (typeof NOTE_KINDS)[number]

export const NOTE_STATUSES = ['standing', 'superseded', 'reversed'] as const
export type NoteStatus = (typeof NOTE_STATUSES)[number]

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
  supersedes: string[]
  body: string
  /** Frontmatter keys we do not know about, preserved for a lossless round trip. */
  extra: Record<string, unknown>
  sourcePath: string
}
