import type Database from 'better-sqlite3'
import { projectSlug, rememberProject } from '@hountybunter/core'
import { readNewLines, saveCursor } from './cursor.js'
import { findTranscripts } from './locate.js'
import { extractToolUses, parseLine } from './parse-line.js'

export interface IngestReport {
  sessions: number
  activities: number
  skippedLines: number
  unknownKinds: Record<string, number>
}

/**
 * Record types observed in real transcripts (143 files, 65,831 lines, 2026-08).
 * Anything outside this set is counted and still gets a row, never dropped — the
 * format is undocumented and will change. The record itself stays in the
 * archive, which is where every record lives now.
 */
const KNOWN_KINDS = new Set([
  'user', 'assistant', 'attachment', 'system',
  'file-history-snapshot', 'file-history-delta', 'queue-operation',
  'last-prompt', 'ai-title', 'mode', 'atis-latch',
  'pr-link', 'permission-mode', 'frame-link',
])

function str(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null
}

export async function ingestAll(
  db: Database.Database,
  env: NodeJS.ProcessEnv = process.env,
  nowIso: string = new Date().toISOString(),
): Promise<IngestReport> {
  const report: IngestReport = { sessions: 0, activities: 0, skippedLines: 0, unknownKinds: {} }

  const upsertSession = db.prepare(
    `INSERT INTO sessions (id, project, started_at, ended_at, branch, model, effort, title, correlation, harness, parent_id)
     VALUES (@id, @project_for_insert, @started_at, @ended_at, @branch, @model, @effort, @title, 'exact', 'claude-code', @parent_id)
     ON CONFLICT(id) DO UPDATE SET
       parent_id  = COALESCE(excluded.parent_id, sessions.parent_id),
       project    = COALESCE(@project_observed, sessions.project),
       started_at = COALESCE(sessions.started_at, excluded.started_at),
       ended_at   = COALESCE(excluded.ended_at, sessions.ended_at),
       branch     = COALESCE(excluded.branch, sessions.branch),
       model      = COALESCE(excluded.model, sessions.model),
       effort     = COALESCE(excluded.effort, sessions.effort),
       title      = COALESCE(excluded.title, sessions.title)`,
  )

  const insertActivity = db.prepare(
    `INSERT INTO activities (session_id, seq, ts, kind, tool_name, attr_skill, attr_plugin)
     VALUES (@session_id, @seq, @ts, @kind, @tool_name, @attr_skill, @attr_plugin)
     ON CONFLICT(session_id, seq) DO NOTHING`,
  )

  const maxSeq = db.prepare('SELECT COALESCE(MAX(seq), 0) AS m FROM activities WHERE session_id = ?')

  for (const file of await findTranscripts(env)) {
    const { lines, to } = await readNewLines(db, file.path)
    if (lines.length === 0) continue

    let seq = (maxSeq.get(file.sessionId) as { m: number }).m
    let project: string | null = null
    let cwdSeen: string | null = null
    let startedAt: string | null = null
    let endedAt: string | null = null
    let branch: string | null = null
    let model: string | null = null
    let effort: string | null = null
    let title: string | null = null
    let parentId: string | null = null
    let added = 0

    db.transaction(() => {
      for (const line of lines) {
        const record = parseLine(line)
        if (!record.ok) {
          report.skippedLines += 1
          continue
        }

        const raw = record.raw
        const cwd = str(raw.cwd)
        if (cwd && !project) project = projectSlug(cwd)
        cwdSeen = cwd ?? cwdSeen
        // Last-wins, matching the upsert's COALESCE(excluded.x, sessions.x). Keeping
        // the first value seen in a run would make incremental ingest converge on the
        // newest and a full re-scan on the oldest, so the index would stop being
        // re-derivable — the design's central claim.
        branch = str(raw.gitBranch) ?? branch
        model = str(raw.model) ?? model
        effort = str(raw.effort) ?? effort
        title = str(raw.aiTitle) ?? title

        // A subagent transcript names its parent in `sessionId` while the file
        // is named for the agent. When the two differ, this run happened inside
        // another session — read from the record, never guessed from the path.
        const declared = str(raw.sessionId)
        if (declared && declared !== file.sessionId) parentId ??= declared

        const ts = str(raw.timestamp)
        if (ts) {
          startedAt ??= ts
          endedAt = ts
        }

        if (!KNOWN_KINDS.has(record.kind)) {
          report.unknownKinds[record.kind] = (report.unknownKinds[record.kind] ?? 0) + 1
        }

        const tools = extractToolUses(raw)
        const common = {
          session_id: file.sessionId,
          ts,
          kind: record.kind,
          attr_skill: str(raw.attributionSkill),
          attr_plugin: str(raw.attributionPlugin),
        }

        seq += 1
        added += insertActivity.run({ ...common, seq, tool_name: tools[0]?.name ?? null }).changes

        // A record can carry more than one tool_use block; each gets its own row.
        for (const tool of tools.slice(1)) {
          seq += 1
          added += insertActivity.run({ ...common, seq, tool_name: tool.name }).changes
        }
      }

      upsertSession.run({
        id: file.sessionId,
        project_for_insert: project ?? projectSlug(file.projectDir),
        project_observed: project,
        started_at: startedAt,
        ended_at: endedAt,
        branch,
        model,
        effort,
        title,
        parent_id: parentId,
      })

      // A subagent run reports the same directory as its parent and would only
      // restate it, so the row is written from the session that owns the cwd.
      if (cwdSeen) rememberProject(db, cwdSeen, endedAt)

      // Last, and inside the transaction: the cursor may only advance if the rows
      // it produced are committed with it.
      saveCursor(db, file.path, to, nowIso)
    })()

    report.sessions += 1
    report.activities += added
  }

  return report
}
