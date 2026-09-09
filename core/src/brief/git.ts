import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

export interface GitState {
  ok: boolean
  branch: string | null
  head: string | null            // "<short sha> <subject>"
  dirty: string[]                // porcelain lines, the first 20
  /** How many paths are uncommitted, of which `dirty` holds the first 20. */
  dirtyTotal: number
  diffstat: string | null
  defaultBranch: string | null
  commits: string[]              // "<short sha> <subject>" lines, newest first, the first 20
  /**
   * How many commits the branch holds since it left the default branch, of
   * which `commits` holds the newest 20. Carried so the brief can say how many
   * it is not showing: a count of only what the composer dropped would report
   * a branch of 76 commits as a branch of 20.
   */
  commitsTotal: number
}

/** Ask git one question. Null on any failure — a brief must never be the thing that throws. */
async function ask(cwd: string, args: string[]): Promise<string | null> {
  try {
    // `maxBuffer` defaults to 1 MB, and a `git log` or `git diff --stat` past
    // that kills the child: the answer would come back null and the block
    // would print as absent, claiming there is nothing where there is a lot.
    const { stdout } = await run('git', ['-C', cwd, ...args], {
      timeout: 5000,
      maxBuffer: 64 * 1024 * 1024,
    })
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
  if (branch === null) {
    return {
      ok: false,
      branch: null,
      head: null,
      dirty: [],
      dirtyTotal: 0,
      diffstat: null,
      defaultBranch: null,
      commits: [],
      commitsTotal: 0,
    }
  }

  const base = await defaultBranch(cwd)
  let commits: string[] = []
  if (base && base !== branch) {
    const mergeBase = await ask(cwd, ['merge-base', 'HEAD', base])
    const log = mergeBase ? await ask(cwd, ['log', '--oneline', `${mergeBase}..HEAD`]) : null
    commits = log ? log.split('\n').filter(Boolean) : []
  }

  const status = await ask(cwd, ['status', '--porcelain'])
  const dirty = status ? status.split('\n').filter(Boolean) : []

  return {
    ok: true,
    branch,
    head: await ask(cwd, ['log', '-1', '--oneline']),
    dirty: dirty.slice(0, 20),
    dirtyTotal: dirty.length,
    diffstat: (await ask(cwd, ['diff', '--stat'])) || null,
    defaultBranch: base,
    commits: commits.slice(0, 20),
    commitsTotal: commits.length,
  }
}
