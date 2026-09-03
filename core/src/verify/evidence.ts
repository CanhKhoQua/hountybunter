import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import { promisify } from 'node:util'
import type { Evidence } from '../types.js'

const run = promisify(execFile)

export const EVIDENCE_STATES = ['verified', 'changed', 'missing', 'unknown'] as const
export type EvidenceState = (typeof EVIDENCE_STATES)[number]

export interface VerifyContext {
  /** The directory a relative `file` ref resolves against. Null when unknown. */
  projectPath: string | null
  /** The digest recorded the last time a human confirmed this ref, if any. */
  baseline: string | undefined
  /** Whether a `session` ref is still in the index. */
  sessionExists: (id: string) => boolean
}

/** sha256 of a file's bytes, or undefined when it cannot be read at all. */
async function hashFile(path: string): Promise<string | undefined> {
  try {
    return `sha256:${createHash('sha256').update(await readFile(path)).digest('hex')}`
  } catch {
    return undefined
  }
}

/**
 * The absolute path a `file` ref names, or null when it names nothing this
 * project contains.
 *
 * `ref` is read out of a file a person edits by hand, so it can say anything. A
 * ref that climbs out of the project would let a note report on — and hash — a
 * file the project has nothing to do with.
 */
function resolveInside(projectPath: string, ref: string): string | null {
  if (isAbsolute(ref)) return null
  const target = resolve(projectPath, ref)
  const step = relative(projectPath, target)
  return step && !step.startsWith('..') ? target : null
}

export async function verifyEvidence(
  evidence: Evidence,
  context: VerifyContext,
): Promise<{ state: EvidenceState; hash?: string }> {
  if (evidence.kind === 'url') return { state: 'unknown' }

  if (evidence.kind === 'session') {
    return { state: context.sessionExists(evidence.ref) ? 'verified' : 'missing' }
  }

  if (!context.projectPath) return { state: 'unknown' }

  if (evidence.kind === 'commit') {
    // Two failures that look alike and are not: a repository that does not have
    // this commit, and a directory that is not a repository. Only the first is
    // news about the note.
    try {
      await run('git', ['rev-parse', '--git-dir'], { cwd: context.projectPath })
    } catch {
      return { state: 'unknown' }
    }
    try {
      await run('git', ['cat-file', '-e', `${evidence.ref}^{commit}`], {
        cwd: context.projectPath,
      })
      return { state: 'verified' }
    } catch {
      return { state: 'missing' }
    }
  }

  const path = resolveInside(context.projectPath, evidence.ref)
  if (!path) return { state: 'unknown' }

  const hash = await hashFile(path)
  if (hash === undefined) return { state: 'missing' }
  // Readable, but nobody has said what it should look like. Not news either way.
  if (context.baseline === undefined) return { state: 'unknown', hash }
  return { state: hash === context.baseline ? 'verified' : 'changed', hash }
}
