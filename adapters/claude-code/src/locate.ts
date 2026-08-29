import { readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

export interface TranscriptFile {
  path: string
  sessionId: string
  projectDir: string
}

export function transcriptRoot(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.HOUNTYBUNTER_TRANSCRIPTS
  if (override) return override
  return join(env.HOME ?? homedir(), '.claude', 'projects')
}

export async function findTranscripts(
  env: NodeJS.ProcessEnv = process.env,
): Promise<TranscriptFile[]> {
  const root = transcriptRoot(env)
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
