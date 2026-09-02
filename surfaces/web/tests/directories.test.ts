import { mkdir, mkdtemp, realpath, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { listDirectories } from '../src/server/directories.js'

let root: string
let env: NodeJS.ProcessEnv

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'hb-browse-')))
  await mkdir(join(root, 'beta'))
  await mkdir(join(root, 'Alpha'))
  await mkdir(join(root, '.hidden'))
  await writeFile(join(root, 'notes.md'), 'not a directory')
  env = { HOME: root } as NodeJS.ProcessEnv
})

describe('listDirectories', () => {
  it('lists the directories inside a path, and nothing else', async () => {
    const listing = await listDirectories(root, env)

    expect(listing?.entries.map((e) => e.name)).toEqual(['Alpha', 'beta'])
    expect(listing?.entries[0]!.path).toBe(join(root, 'Alpha'))
  })

  it('sorts the way a person reads, not the way bytes do', async () => {
    // 'Alpha' before 'beta'. A byte-order sort puts every capitalised name
    // first, so `Developer` and `Library` would sit above everything lowercase.
    const listing = await listDirectories(root, env)
    expect(listing?.entries.map((e) => e.name)).toEqual(['Alpha', 'beta'])
  })

  it('hides dot directories', async () => {
    // Picking a working directory is not managing files. `.git` and `.cache`
    // are noise between the user and the one name they are looking for.
    const listing = await listDirectories(root, env)
    expect(listing?.entries.some((e) => e.name.startsWith('.'))).toBe(false)
  })

  it('starts at home when asked for nowhere in particular', async () => {
    expect((await listDirectories(undefined, env))?.path).toBe(root)
  })

  it('offers the way back up, and stops at the root', async () => {
    expect((await listDirectories(join(root, 'beta'), env))?.parent).toBe(root)
    // '/' has no parent, and a button that looks like it moves but resolves to
    // where you already are is worse than no button.
    expect((await listDirectories('/', env))?.parent).toBe(null)
  })

  it('says nothing rather than guessing when the path is not a directory', async () => {
    expect(await listDirectories(join(root, 'notes.md'), env)).toBe(null)
    expect(await listDirectories(join(root, 'gone'), env)).toBe(null)
  })

  it('reports where a symlink really leads', async () => {
    // A hunt started through a symlinked path binds to nothing unless both
    // sides resolve, which is a bug this project has already paid for once.
    await symlink(join(root, 'beta'), join(root, 'link'))
    expect((await listDirectories(join(root, 'link'), env))?.path).toBe(join(root, 'beta'))
  })
})
