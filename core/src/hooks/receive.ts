import type Database from 'better-sqlite3'
import { projectSlug } from '../paths.js'

/**
 * Event names seen from Claude Code as of 2026-09. Anything outside this set is
 * kept with its payload and flagged, never dropped: the hook surface is
 * undocumented and will grow.
 */
const KNOWN_KINDS = new Set([
  'SessionStart', 'SessionEnd', 'UserPromptSubmit',
  'PreToolUse', 'PostToolUse', 'Notification', 'Stop', 'SubagentStop',
  'PreCompact',
])

export interface HookResult {
  ok: boolean
  error?: string
  unknownKind?: boolean
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null
}

/**
 * Record one hook event. Idempotent on the whole payload, because a spool
 * replayed after a live delivery must not double-count.
 */
export function receiveHookEvent(
  db: Database.Database,
  payload: Record<string, unknown>,
): HookResult {
  const sessionId = str(payload?.session_id)
  if (!sessionId) return { ok: false, error: 'session_id is required on a hook event' }

  const kind = str(payload?.hook_event_name) ?? 'unknown'
  const ts = str(payload?.timestamp)
  const cwd = str(payload?.cwd)

  db.transaction(() => {
    db.prepare(
      `INSERT INTO hook_events (session_id, kind, ts, payload_json)
       VALUES (?, ?, ?, ?)
       ON CONFLICT DO NOTHING`,
    ).run(sessionId, kind, ts, JSON.stringify(payload))

    // The hook knows the session id, which is what makes the binding exact. It
    // does not know the transcript's content, so every column ingest owns is
    // left alone — COALESCE keeps whatever is already there.
    db.prepare(
      `INSERT INTO sessions (id, project, started_at, correlation)
       VALUES (@id, @project, @ts, 'exact')
       ON CONFLICT(id) DO UPDATE SET
         correlation = 'exact',
         project     = COALESCE(sessions.project, excluded.project),
         started_at  = COALESCE(sessions.started_at, excluded.started_at)`,
    ).run({
      id: sessionId,
      project: cwd ? projectSlug(cwd) : 'unknown',
      ts,
    })
  })()

  return { ok: true, unknownKind: !KNOWN_KINDS.has(kind) }
}
