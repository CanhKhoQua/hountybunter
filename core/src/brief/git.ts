import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

export interface GitState {
  ok: boolean
  branch: string | null
  head: string | null
  dirty: string[]
  diffstat: string | null
  defaultBranch: string | null
  commits: string[]
}

const EMPTY: GitState = {
  ok: false,
  branch: null,
  head: null,
  dirty: [],
  diffstat: null,
  defaultBranch: null,
  commits: [],
}

/** Ask git one question. Null on any failure — a brief must never be the thing that throws. */
async function ask(cwd: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await run('git', ['-C', cwd, ...args], { timeout: 5000 })
    return stdout.trimEnd()
  } catch {
    return null
  }
}

/**
 * The default branch as this clone knows it, falling back to `main`.
 * `origin/HEAD` is a symbolic ref the clone set up; it is read, not assumed.
 */
async function defaultBranch(cwd: string): Promise<string | null> {
  const ref = await ask(cwd, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])
  if (ref) return ref.replace(/^origin\//, '')
  return (await ask(cwd, ['rev-parse', '--verify', '--quiet', 'main'])) ? 'main' : null
}

export async function readGitState(cwd: string): Promise<GitState> {
  const branch = await ask(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])
  if (branch === null) return EMPTY

  const base = await defaultBranch(cwd)
  let commits: string[] = []
  if (base && base !== branch) {
    const mergeBase = await ask(cwd, ['merge-base', 'HEAD', base])
    const log = mergeBase ? await ask(cwd, ['log', '--oneline', `${mergeBase}..HEAD`]) : null
    commits = log ? log.split('\n').filter(Boolean).slice(0, 20) : []
  }

  const status = await ask(cwd, ['status', '--porcelain'])

  return {
    ok: true,
    branch,
    head: await ask(cwd, ['log', '-1', '--oneline']),
    dirty: status ? status.split('\n').filter(Boolean).slice(0, 20) : [],
    diffstat: (await ask(cwd, ['diff', '--stat'])) || null,
    defaultBranch: base,
    commits,
  }
}
