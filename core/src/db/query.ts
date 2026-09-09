import { existsSync } from 'node:fs'
import type Database from 'better-sqlite3'
import type { Note } from '../types.js'

export interface NoteHit {
  id: string
  project: string
  title: string
  kind: string
  status: string
  snippet: string
}

/**
 * FTS5 has its own query language. Users type prose, not queries, so the whole
 * input is quoted as a single phrase; embedded quotes are doubled per SQLite's
 * string rules.
 */
export function escapeFts(query: string): string {
  return `"${query.replace(/"/g, '""')}"`
}

export function searchNotes(
  db: Database.Database,
  query: string,
  opts: { project?: string; limit?: number } = {},
): NoteHit[] {
  const sql = `
    SELECT n.id, n.project, n.title, n.kind, n.status,
           snippet(notes_fts, -1, '', '', ' … ', 12) AS snippet
    FROM notes_fts
    JOIN notes n ON n.id = notes_fts.note_id
    WHERE notes_fts MATCH ?
      ${opts.project ? 'AND n.project = ?' : ''}
    ORDER BY rank
    LIMIT ?`
  const params: unknown[] = [escapeFts(query)]
  if (opts.project) params.push(opts.project)
  params.push(opts.limit ?? 20)
  return db.prepare(sql).all(...params) as NoteHit[]
}

/** The filters `listNotes` and `countNotes` must agree on, built once. */
function noteFilter(opts: { project?: string; status?: string }): {
  sql: string
  params: unknown[]
} {
  const where: string[] = []
  const params: unknown[] = []
  if (opts.project) {
    where.push('project = ?')
    params.push(opts.project)
  }
  if (opts.status) {
    where.push('status = ?')
    params.push(opts.status)
  }
  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', params }
}

export function listNotes(
  db: Database.Database,
  opts: { project?: string; status?: string; limit?: number; offset?: number } = {},
): NoteHit[] {
  const filter = noteFilter(opts)

  return db
    .prepare(
      `SELECT id, project, title, kind, status, '' AS snippet
       FROM notes
       ${filter.sql}
       ORDER BY id DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...filter.params, opts.limit ?? 50, opts.offset ?? 0) as NoteHit[]
}

/**
 * How many notes `listNotes` would have to choose from. Kept beside it, and
 * sharing its filter, because a count answering for different rows than the
 * list tells the reader a page is the whole thing when it is not.
 */
export function countNotes(
  db: Database.Database,
  opts: { project?: string; status?: string } = {},
): number {
  const filter = noteFilter(opts)
  return (
    db.prepare(`SELECT COUNT(*) n FROM notes ${filter.sql}`).get(...filter.params) as { n: number }
  ).n
}

export interface SessionHit {
  id: string
  project: string
  started_at: string | null
  title: string | null
  activities: number
}

/** The filters `listSessions` and `countSessions` must agree on, built once. */
function sessionFilter(opts: { project?: string; parent?: string }): {
  sql: string
  params: unknown[]
} {
  const where: string[] = []
  const params: unknown[] = []

  if (opts.parent) {
    where.push('s.parent_id = ?')
    params.push(opts.parent)
  } else {
    // Task-tool runs are their own sessions, but there can be dozens per
    // session and none of them is a thing a person started. They stay out of
    // the list until asked for by parent.
    where.push('s.parent_id IS NULL')
  }
  if (opts.project) {
    where.push('s.project = ?')
    params.push(opts.project)
  }
  return { sql: `WHERE ${where.join(' AND ')}`, params }
}

export function listSessions(
  db: Database.Database,
  opts: { project?: string; limit?: number; offset?: number; parent?: string } = {},
): SessionHit[] {
  const filter = sessionFilter(opts)

  // SQLite sorts NULL below every value, so DESC already places a session with no
  // observed timestamp last. It is still listed: an absent signal is shown as
  // absent, never as a session that did not happen.
  return db
    .prepare(
      `SELECT s.id, s.project, s.started_at, s.title,
              (SELECT COUNT(*) FROM activities a WHERE a.session_id = s.id) AS activities
       FROM sessions s
       ${filter.sql}
       ORDER BY s.started_at DESC, s.id ASC
       LIMIT ? OFFSET ?`,
    )
    .all(...filter.params, opts.limit ?? 20, opts.offset ?? 0) as SessionHit[]
}

/** How many sessions `listSessions` would have to choose from. */
export function countSessions(
  db: Database.Database,
  opts: { project?: string; parent?: string } = {},
): number {
  const filter = sessionFilter(opts)
  return (
    db.prepare(`SELECT COUNT(*) n FROM sessions s ${filter.sql}`).get(...filter.params) as {
      n: number
    }
  ).n
}

export interface SessionDetail extends SessionHit {
  ended_at: string | null
  branch: string | null
  model: string | null
  /** 'exact' when bound by session_id, 'guessed' when inferred from cwd and time. */
  correlation: string
}

export function getSession(db: Database.Database, id: string): SessionDetail | undefined {
  return db
    .prepare(
      `SELECT s.id, s.project, s.started_at, s.ended_at, s.title, s.branch, s.model,
              s.correlation,
              (SELECT COUNT(*) FROM activities a WHERE a.session_id = s.id) AS activities
       FROM sessions s
       WHERE s.id = ?`,
    )
    .get(id) as SessionDetail | undefined
}

export interface ActivityRow {
  id: number
  seq: number
  ts: string | null
  kind: string
  tool_name: string | null
}

export function listActivities(
  db: Database.Database,
  sessionId: string,
  opts: { limit?: number; offset?: number } = {},
): ActivityRow[] {
  // Ordered by seq, not by id: seq is the transcript's own ordering, and an
  // incremental ingest can insert an earlier session's rows after a later one's.
  return db
    .prepare(
      `SELECT id, seq, ts, kind, tool_name
       FROM activities
       WHERE session_id = ?
       ORDER BY seq ASC
       LIMIT ? OFFSET ?`,
    )
    .all(sessionId, opts.limit ?? 500, opts.offset ?? 0) as ActivityRow[]
}

/**
 * How many activities the session holds. The longest transcripts run to
 * thousands of rows, so a page is all a reader ever gets — and without this
 * the page was served silently, directly under a total it contradicted.
 */
export function countActivities(db: Database.Database, sessionId: string): number {
  return (
    db.prepare('SELECT COUNT(*) n FROM activities WHERE session_id = ?').get(sessionId) as {
      n: number
    }
  ).n
}

export interface RegionRow {
  project: string
  sessions: number
  notes: number
  /** The directory sessions here ran in, or null when no transcript placed it. */
  path: string | null
  name: string | null
  lastSeenAt: string | null
  /** Notes in this project with a reference that was checked and found wanting. */
  stale: number
}

/**
 * The notes with a reference that was checked and found wanting, or whose
 * review date has passed.
 *
 * `unknown` is excluded on purpose: a reference nobody could check is not
 * evidence of anything. `review_after` is a `YYYY-MM-DD` string, so a string
 * compare against `today` is a date compare; it is strictly `<` because on
 * the date itself a note is not yet due. The clock is the caller's — this
 * function never reaches for `new Date()` itself.
 */
export function staleNoteIds(db: Database.Database, today: string): Set<string> {
  const rows = db
    .prepare(
      `SELECT note_id FROM note_evidence WHERE state IN ('changed', 'missing')
       UNION
       SELECT id AS note_id FROM notes WHERE review_after IS NOT NULL AND review_after < ?`,
    )
    .all(today) as { note_id: string }[]
  return new Set(rows.map((r) => r.note_id))
}

/**
 * Where a note's project lives.
 *
 * The note's own `project_path` is what its author saw when they wrote it, so
 * it wins; the `projects` row is the fallback for notes written before that
 * field existed. Null when neither answers — which the caller must read as
 * "cannot check", never as "nothing changed".
 *
 * A candidate path is also rejected if it no longer exists — most often a git
 * worktree that has since been removed, which is ordinary. A directory that
 * is not there cannot be checked, so the honest answer is "unknown", not
 * "missing", the same call d8293ed made for an unreadable file. This is why
 * a missing note.project_path does not fall through to the projects row:
 * that row names a different working tree than the one the note's author
 * looked at, and reporting against it would trade a false "stale" for a
 * false "evidence changed".
 */
export function projectPathFor(db: Database.Database, note: Note): string | null {
  if (note.project_path) return existsSync(note.project_path) ? note.project_path : null
  const row = db.prepare('SELECT path FROM projects WHERE slug = ?').get(note.project) as
    | { path: string }
    | undefined
  if (!row?.path) return null
  return existsSync(row.path) ? row.path : null
}

/**
 * A project and what is known about it. Sessions and notes are unioned rather
 * than joined from sessions alone: a project can hold notes before it has ever
 * been ingested, and dropping it would hide ground the user has already walked.
 */
export function listRegions(
  db: Database.Database,
  opts: { limit?: number; offset?: number; today: string },
): RegionRow[] {
  return db
    .prepare(
      `SELECT p.project AS project,
              (SELECT COUNT(*) FROM sessions s WHERE s.project = p.project) AS sessions,
              (SELECT COUNT(*) FROM notes n WHERE n.project = p.project) AS notes,
              d.path AS path,
              d.name AS name,
              d.last_seen_at AS lastSeenAt,
              (SELECT COUNT(DISTINCT n2.id)
                 FROM notes n2 LEFT JOIN note_evidence e ON e.note_id = n2.id
                WHERE n2.project = p.project
                  AND (e.state IN ('changed', 'missing')
                       OR (n2.review_after IS NOT NULL AND n2.review_after < @today))) AS stale
       FROM (SELECT project FROM sessions UNION SELECT project FROM notes) p
       LEFT JOIN projects d ON d.slug = p.project
       ORDER BY sessions DESC, p.project ASC
       LIMIT @limit OFFSET @offset`,
    )
    // Unlimited by default. Both the CLI and the region grid read the whole
    // list, and a cap nobody asked for is the bug this paging exists to end.
    .all({ today: opts.today, limit: opts.limit ?? -1, offset: opts.offset ?? 0 }) as RegionRow[]
}

/**
 * How many regions there are. A row count of either table alone would be
 * wrong: a region is one side or the other of a union, and a project can hold
 * notes before it has ever been ingested.
 */
export function countRegions(db: Database.Database): number {
  return (
    db
      .prepare(
        `SELECT COUNT(*) n
         FROM (SELECT project FROM sessions UNION SELECT project FROM notes)`,
      )
      .get() as { n: number }
  ).n
}
