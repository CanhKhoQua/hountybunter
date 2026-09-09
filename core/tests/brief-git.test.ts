import { execFile } from 'node:child_process'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { beforeEach, describe, expect, it } from 'vitest'
import { readGitState } from '../src/brief/git.js'

const run = promisify(execFile)
let repo: string

async function git(...args: string[]) {
  await run('git', ['-C', repo, ...args])
}

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), 'hb-git-'))
  await git('init', '-b', 'main')
  await git('config', 'user.email', 'test@example.com')
  await git('config', 'user.name', 'Test')
  await writeFile(join(repo, 'a.txt'), 'one\n')
  await git('add', '.')
  await git('commit', '-m', 'first commit')
})

describe('readGitState', () => {
  it('reports the branch and the commit at HEAD', async () => {
    const state = await readGitState(repo)
    expect(state.ok).toBe(true)
    expect(state.branch).toBe('main')
    expect(state.head).toContain('first commit')
  })

  it('lists what is uncommitted, which is what a killed session left behind', async () => {
    await writeFile(join(repo, 'a.txt'), 'two\n')
    const state = await readGitState(repo)
    expect(state.dirty.join('\n')).toContain('a.txt')
    expect(state.diffstat).toContain('a.txt')
  })

  it('lists the commits made on a branch since it left the default branch', async () => {
    await git('checkout', '-b', 'feat/x')
    await writeFile(join(repo, 'b.txt'), 'b\n')
    await git('add', '.')
    await git('commit', '-m', 'second commit')

    const state = await readGitState(repo)
    expect(state.commits.join('\n')).toContain('second commit')
    expect(state.commits.join('\n')).not.toContain('first commit')
  })

  it('reports an empty range on the default branch rather than the whole history', async () => {
    const state = await readGitState(repo)
    expect(state.commits).toEqual([])
  })

  it('says so rather than throwing when there is no repository at all', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'hb-nogit-'))
    const state = await readGitState(empty)
    expect(state.ok).toBe(false)
    expect(state.branch).toBeNull()
    expect(state.commits).toEqual([])
  })

  it('reads origin/HEAD to determine the default branch, not assuming main', async () => {
    // Create a non-main default branch to prove the value is read, not defaulted.
    const sha = (await run('git', ['-C', repo, 'rev-parse', 'HEAD'])).stdout.trim()

    // Set up remote-tracking ref and symbolic ref locally without fetching.
    await git('update-ref', 'refs/remotes/origin/trunk', sha)
    await git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/trunk')

    // Create a local branch at the same commit so the commit range resolves.
    await git('checkout', '-b', 'trunk')
    await writeFile(join(repo, 'c.txt'), 'c\n')
    await git('add', '.')
    await git('commit', '-m', 'branch commit')

    const state = await readGitState(repo)
    // The default branch should be 'trunk', not 'origin/trunk' (the stripping) and not 'main' (the fallback).
    expect(state.defaultBranch).toBe('trunk')
    // Verify it actually read the symbolic ref and didn't just default to 'main'.
    expect(state.defaultBranch).not.toBe('main')
  })
})
