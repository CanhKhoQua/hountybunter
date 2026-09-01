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
  opts: { project?: string; limit?: number } = {},
): SessionHit[] {
  const params: unknown[] = []
  if (opts.project) params.push(opts.project)
  params.push(opts.limit ?? 20)

  // SQLite sorts NULL below every value, so DESC already places a session with no
  // observed timestamp last. It is still listed: an absent signal is shown as
  // absent, never as a session that did not happen.
  return db
    .prepare(
      `SELECT s.id, s.project, s.started_at, s.title,
              (SELECT COUNT(*) FROM activities a WHERE a.session_id = s.id) AS activities
       FROM sessions s
       ${opts.project ? 'WHERE s.project = ?' : ''}
       ORDER BY s.started_at DESC, s.id ASC
       LIMIT ?`,
    )
    .all(...params) as SessionHit[]
}
