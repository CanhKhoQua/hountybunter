import { readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { transcriptsDir } from '@hountybunter/core'

export interface TranscriptFile {
  path: string
  sessionId: string
  projectDir: string
}

/** Every `.jsonl` under `root`, as paths relative to it. */
async function walk(root: string, prefix = ''): Promise<string[]> {
  let entries
  try {
    entries = await readdir(join(root, prefix), { withFileTypes: true })
  } catch {
    return []
  }
  const found: string[] = []
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) found.push(...(await walk(root, relative)))
    else if (entry.name.endsWith('.jsonl')) found.push(relative)
  }
  return found
}

/** Where the agent writes its transcripts, and deletes them again after 30 days. */
export function transcriptRoot(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.HOUNTYBUNTER_TRANSCRIPTS
  if (override) return override
  return join(env.HOME ?? homedir(), '.claude', 'projects')
}

/**
 * Transcripts to ingest. Read from the store's archive, never from the agent's
 * directory: a session must stay ingestable after the agent has dropped it.
 * `syncArchive` is what puts them there.
 */
export async function findTranscripts(
  env: NodeJS.ProcessEnv = process.env,
): Promise<TranscriptFile[]> {
  const root = transcriptsDir(env)
  let projectDirs: string[]
  try {
    const entries = await readdir(root, { withFileTypes: true })
    projectDirs = entries.filter((e) => e.isDirectory()).map((e) => e.name)
  } catch {
    return []
  }

  const files: TranscriptFile[] = []
  for (const projectDir of projectDirs.sort()) {
    // Recursive: a Task-tool run lands in <project>/<sessionId>/subagents/, a
    // level below an ordinary session. `projectDir` stays the top-level
    // directory either way, because that is what names the project.
    for (const relative of await walk(join(root, projectDir))) {
      files.push({
        path: join(root, projectDir, relative),
        sessionId: relative.slice(relative.lastIndexOf('/') + 1).replace(/\.jsonl$/, ''),
        projectDir,
      })
    }
  }
  return files
}
