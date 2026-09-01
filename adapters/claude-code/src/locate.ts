import { readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { transcriptsDir } from '@hountybunter/core'

export interface TranscriptFile {
  path: string
  sessionId: string
  projectDir: string
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
    let names: string[]
    try {
      names = (await readdir(join(root, projectDir))).filter((n) => n.endsWith('.jsonl'))
    } catch {
      continue
    }
    for (const name of names.sort()) {
      files.push({
        path: join(root, projectDir, name),
        sessionId: name.replace(/\.jsonl$/, ''),
        projectDir,
      })
    }
  }
  return files
}
