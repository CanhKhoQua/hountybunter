import type Database from 'better-sqlite3'
import { projectSlug } from '../paths.js'
import { rememberProject } from '../db/write.js'

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

    // The hook owns exactly two things: that this session exists, and that its
    // identity is known rather than inferred.
    //
    // It deliberately does NOT set started_at. Hook events live in the index,
    // and the index is deletable — so any column a hook filled in would come
    // back different after a rebuild, and the final state would depend on
    // whether the hook or the transcript happened to arrive first. Timestamps
    // belong to the transcript, which a rebuild reproduces exactly.
    db.prepare(
      `INSERT INTO sessions (id, project, correlation, harness)
       VALUES (@id, @project, 'exact', 'claude-code')
       ON CONFLICT(id) DO UPDATE SET
         correlation = 'exact',
         project     = COALESCE(sessions.project, excluded.project)`,
    ).run({
      id: sessionId,
      project: cwd ? projectSlug(cwd) : 'unknown',
    })

    // The directory itself, not only its slug. A hook is the only thing that
    // reports one while the session is still running, and the slug is one-way,
    // so a project first seen through a hook could otherwise be named and
    // never opened. No timestamp is passed: a hook payload has none, and a
    // rebuild takes that answer from the transcript.
    if (cwd) rememberProject(db, cwd)
  })()

  return { ok: true, unknownKind: !KNOWN_KINDS.has(kind) }
}
