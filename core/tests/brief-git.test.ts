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
})
