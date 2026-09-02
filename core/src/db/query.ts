import type Database from 'better-sqlite3'

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

export function listNotes(
  db: Database.Database,
  opts: { project?: string; status?: string; limit?: number } = {},
): NoteHit[] {
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
  params.push(opts.limit ?? 50)

  return db
    .prepare(
      `SELECT id, project, title, kind, status, '' AS snippet
       FROM notes
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY id DESC
       LIMIT ?`,
    )
    .all(...params) as NoteHit[]
}

export interface SessionHit {
  id: string
  project: string
  started_at: string | null
  title: string | null
  activities: number
}

export function listSessions(
  db: Database.Database,
  opts: { project?: string; limit?: number; parent?: string } = {},
): SessionHit[] {
  const params: unknown[] = []
  const where: string[] = []

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
  params.push(opts.limit ?? 20)

  // SQLite sorts NULL below every value, so DESC already places a session with no
  // observed timestamp last. It is still listed: an absent signal is shown as
  // absent, never as a session that did not happen.
  return db
    .prepare(
      `SELECT s.id, s.project, s.started_at, s.title,
              (SELECT COUNT(*) FROM activities a WHERE a.session_id = s.id) AS activities
       FROM sessions s
       WHERE ${where.join(' AND ')}
       ORDER BY s.started_at DESC, s.id ASC
       LIMIT ?`,
    )
    .all(...params) as SessionHit[]
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
  opts: { limit?: number } = {},
): ActivityRow[] {
  // Ordered by seq, not by id: seq is the transcript's own ordering, and an
  // incremental ingest can insert an earlier session's rows after a later one's.
  return db
    .prepare(
      `SELECT id, seq, ts, kind, tool_name
       FROM activities
       WHERE session_id = ?
       ORDER BY seq ASC
       LIMIT ?`,
    )
    .all(sessionId, opts.limit ?? 500) as ActivityRow[]
}

export interface RegionRow {
  project: string
  sessions: number
  notes: number
  /** The directory sessions here ran in, or null when no transcript placed it. */
  path: string | null
  name: string | null
  lastSeenAt: string | null
}

/**
 * A project and what is known about it. Sessions and notes are unioned rather
 * than joined from sessions alone: a project can hold notes before it has ever
 * been ingested, and dropping it would hide ground the user has already walked.
 */
export function listRegions(db: Database.Database): RegionRow[] {
  return db
    .prepare(
      `SELECT p.project AS project,
              (SELECT COUNT(*) FROM sessions s WHERE s.project = p.project) AS sessions,
              (SELECT COUNT(*) FROM notes n WHERE n.project = p.project) AS notes,
              d.path AS path,
              d.name AS name,
              d.last_seen_at AS lastSeenAt
       FROM (SELECT project FROM sessions UNION SELECT project FROM notes) p
       LEFT JOIN projects d ON d.slug = p.project
       ORDER BY sessions DESC, p.project ASC`,
    )
    .all() as RegionRow[]
}
