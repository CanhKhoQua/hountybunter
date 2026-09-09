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

/** One `file` reference and the digest it carried when a human last confirmed it. */
export interface VerifiedRef {
  ref: string
  hash: string
}

/**
 * What the tool measured, as opposed to what the note's author declared.
 *
 * Kept out of `evidence` on purpose: that list is a human record, and folding
 * machine bookkeeping into it erodes the thing that makes a note worth reading.
 * The two are matched on `ref`.
 *
 * Only `file` references appear. A commit either resolves or it does not, and a
 * session either is in the index or is not; neither has a prior value worth
 * writing down. `url` references are never verified at all.
 */
export interface Verified {
  /** The calendar date a human last confirmed the note, `YYYY-MM-DD`. */
  on: string
  refs: VerifiedRef[]
}

export interface Note {
  id: string
  title: string
  project: string
  /**
   * The directory this note was written in, when the writer knew it.
   *
   * `project` is a one-way slug: it says which project a decision belongs to
   * but never where that project is. A note is a file and the index is
   * disposable, so the path belongs here rather than only in a row. Null for a
   * note written before the field existed, or promoted from somewhere other
   * than the project it is about — absent, never guessed.
   */
  project_path: string | null
  kind: NoteKind
  status: NoteStatus
  decided_on: string | null
  question: string
  chosen: string
  rejected: RejectedOption[]
  evidence: Evidence[]
  /** Null for a note nobody has confirmed yet — absent, never assumed fresh. */
  verified: Verified | null
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
