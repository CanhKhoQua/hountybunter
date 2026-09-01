import { readFile, writeFile } from 'node:fs/promises'
import type Database from 'better-sqlite3'
import { spoolFile } from '../paths.js'
import { receiveHookEvent } from './receive.js'

export interface SpoolReport {
  replayed: number
  skipped: number
}

/**
 * Bring in events a hook parked while nothing was listening.
 *
 * Safe to run at any time: `receiveHookEvent` is idempotent on the whole
 * payload, so an event that was also delivered live is absorbed rather than
 * counted twice. The spool is only truncated after the rows are committed, so
 * a crash mid-replay costs a duplicate attempt, never an event.
 */
export async function replaySpool(
  db: Database.Database,
  env: NodeJS.ProcessEnv = process.env,
): Promise<SpoolReport> {
  const path = spoolFile(env)

  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch {
    // No spool is the normal state, not a problem to report.
    return { replayed: 0, skipped: 0 }
  }

  const report: SpoolReport = { replayed: 0, skipped: 0 }

  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue

    let payload: Record<string, unknown>
    try {
      payload = JSON.parse(trimmed)
    } catch {
      // One truncated line — a crash mid-write — must not cost the rest.
      report.skipped += 1
      continue
    }

    if (receiveHookEvent(db, payload).ok) report.replayed += 1
    else report.skipped += 1
  }

  await writeFile(path, '', 'utf8')
  return report
}
