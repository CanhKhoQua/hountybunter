import { execFile } from 'node:child_process'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { beforeEach, describe, expect, it } from 'vitest'
import { verifyEvidence } from '../src/verify/evidence.js'

const run = promisify(execFile)

let dir: string
const never = () => false
const always = () => true

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'hb-verify-'))
})

async function repo(at: string) {
  await run('git', ['init', '-q'], { cwd: at })
  await run('git', ['config', 'user.email', 't@t'], { cwd: at })
  await run('git', ['config', 'user.name', 't'], { cwd: at })
}

describe('file evidence', () => {
  it('is verified when the bytes still hash to the baseline', async () => {
    await writeFile(join(dir, 'a.ts'), 'export const a = 1\n')
    const first = await verifyEvidence(
      { kind: 'file', ref: 'a.ts' },
      { projectPath: dir, baseline: undefined, sessionExists: never },
    )
    // No baseline yet, so the first look can only report that it does not know.
    expect(first.state).toBe('unknown')
    expect(first.hash).toMatch(/^sha256:[0-9a-f]{64}$/)

    const second = await verifyEvidence(
      { kind: 'file', ref: 'a.ts' },
      { projectPath: dir, baseline: first.hash, sessionExists: never },
    )
    expect(second.state).toBe('verified')
  })

  it('is changed when the bytes differ from the baseline', async () => {
    await writeFile(join(dir, 'a.ts'), 'export const a = 1\n')
    const before = await verifyEvidence(
      { kind: 'file', ref: 'a.ts' },
      { projectPath: dir, baseline: undefined, sessionExists: never },
    )
    await writeFile(join(dir, 'a.ts'), 'export const a = 2\n')

    const after = await verifyEvidence(
      { kind: 'file', ref: 'a.ts' },
      { projectPath: dir, baseline: before.hash, sessionExists: never },
    )
    expect(after.state).toBe('changed')
  })

  it('is missing when the file the note cites is gone', async () => {
    const result = await verifyEvidence(
      { kind: 'file', ref: 'gone.ts' },
      { projectPath: dir, baseline: 'sha256:whatever', sessionExists: never },
    )
    expect(result.state).toBe('missing')
  })

  it('is unknown when the project is not on this machine', async () => {
    // The repository being absent says nothing about whether the note is stale.
    const result = await verifyEvidence(
      { kind: 'file', ref: 'a.ts' },
      { projectPath: null, baseline: 'sha256:whatever', sessionExists: never },
    )
    expect(result.state).toBe('unknown')
  })

  it('never resolves a ref outside the project directory', async () => {
    // `ref` comes out of a file a person edits. A traversal would let a note
    // report on, and hash, something the project does not contain.
    const result = await verifyEvidence(
      { kind: 'file', ref: '../../etc/hosts' },
      { projectPath: dir, baseline: undefined, sessionExists: never },
    )
    expect(result.state).toBe('unknown')
  })
})

describe('commit evidence', () => {
  it('is verified when the commit still resolves', async () => {
    await repo(dir)
    await writeFile(join(dir, 'a.ts'), 'x\n')
    await run('git', ['add', '-A'], { cwd: dir })
    await run('git', ['commit', '-qm', 'first'], { cwd: dir })
    const { stdout } = await run('git', ['rev-parse', 'HEAD'], { cwd: dir })

    const result = await verifyEvidence(
      { kind: 'commit', ref: stdout.trim() },
      { projectPath: dir, baseline: undefined, sessionExists: never },
    )
    expect(result.state).toBe('verified')
  })

  it('is missing when the commit does not resolve in a real repository', async () => {
    await repo(dir)
    const result = await verifyEvidence(
      { kind: 'commit', ref: '0'.repeat(40) },
      { projectPath: dir, baseline: undefined, sessionExists: never },
    )
    expect(result.state).toBe('missing')
  })

  it('is unknown when the directory is not a repository at all', async () => {
    // Not the same claim as "that commit is gone".
    const result = await verifyEvidence(
      { kind: 'commit', ref: '0'.repeat(40) },
      { projectPath: dir, baseline: undefined, sessionExists: never },
    )
    expect(result.state).toBe('unknown')
  })
})

describe('session and url evidence', () => {
  it('verifies a session that is still in the index', async () => {
    const result = await verifyEvidence(
      { kind: 'session', ref: 's1' },
      { projectPath: null, baseline: undefined, sessionExists: always },
    )
    expect(result.state).toBe('verified')
  })

  it('reports a session the index no longer holds as missing', async () => {
    const result = await verifyEvidence(
      { kind: 'session', ref: 's1' },
      { projectPath: null, baseline: undefined, sessionExists: never },
    )
    expect(result.state).toBe('missing')
  })

  it('never checks a url, however reachable it looks', async () => {
    // Offline would otherwise mark every note stale at once, which trains the
    // reader to disregard the one signal this feature exists to give.
    const result = await verifyEvidence(
      { kind: 'url', ref: 'https://example.invalid/adr' },
      { projectPath: null, baseline: undefined, sessionExists: always },
    )
    expect(result.state).toBe('unknown')
  })
})
