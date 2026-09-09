import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { readAllRegistrations, writeRegistration } from '@hountybunter/core'
import { runCli, type Io } from '../src/bin.js'

let io: Io
let out: string[]
let err: string[]

beforeEach(async () => {
  const home = await mkdtemp(join(tmpdir(), 'hb-reg-cli-'))
  out = []
  err = []
  io = {
    out: (l) => out.push(l),
    err: (l) => err.push(l),
    env: { HOUNTYBUNTER_HOME: home, HOUNTYBUNTER_TZ: 'UTC' } as NodeJS.ProcessEnv,
    cwd: '/w/proj',
  }
})

describe('hb register', () => {
  it('registers the current directory and reports the slug', async () => {
    expect(await runCli(['register'], io)).toBe(0)
    const { registrations } = await readAllRegistrations(io.env)
    expect(registrations).toHaveLength(1)
    expect(registrations[0]!.paths).toEqual(['/w/proj'])
    expect(out.join('\n')).toContain(registrations[0]!.slug)
  })

  it('prints the line to paste, and says it changed nothing in the repository', async () => {
    await runCli(['register'], io)
    const text = out.join('\n')
    expect(text).toContain('hb brief')
    expect(text).toMatch(/AGENTS\.md|CLAUDE\.md/)
    expect(text).toMatch(/Nothing in the repository was changed/)
  })

  it('registering the same directory twice does not make a second project', async () => {
    await runCli(['register'], io)
    await runCli(['register'], io)
    const { registrations } = await readAllRegistrations(io.env)
    expect(registrations).toHaveLength(1)
  })

  it('sets the plan pointer', async () => {
    await runCli(['register', '--plan', 'docs/superpowers/plans/p.md'], io)
    const { registrations } = await readAllRegistrations(io.env)
    expect(registrations[0]!.plan).toBe('docs/superpowers/plans/p.md')
  })

  it('refuses an absolute plan with a sentence, not a stack trace', async () => {
    expect(await runCli(['register', '--plan', '/w/proj/docs/p.md'], io)).toBe(1)
    expect(err.join('\n')).toMatch(/repo-relative/)
  })

  it('registers an unrelated directory as its own project when git cannot tie the two together', async () => {
    await runCli(['register'], io)
    expect(await runCli(['register', '/w/proj-wt'], { ...io, cwd: '/w/proj-wt' })).toBe(0)
    const { registrations } = await readAllRegistrations(io.env)
    // No git in this fixture, so the second path is only joined when the user
    // names the project it belongs to.
    expect(registrations).toHaveLength(2)
  })
})

describe('notes follow the registration', () => {
  it('files a jot under the registered slug, not the path-derived one', async () => {
    await runCli(['register'], io)
    const { registrations } = await readAllRegistrations(io.env)
    const record = registrations[0]!
    // `hb register` sets slug = projectSlug(path), so the registered slug and
    // the path-derived slug are the same string for the primary directory —
    // declaring a different slug is what actually distinguishes "the CLI reads
    // the registration" from "the CLI still hashes the path".
    await writeRegistration({ ...record, slug: 'declared-elsewhere' }, io.env)

    await runCli(['jot', 'chose SQLite because the file outlives the tool'], io)
    expect(out.join('\n')).toContain('declared-elsewhere')
  })

  it('files a jot from a second registered path under the primary slug', async () => {
    await runCli(['register'], io)
    // Join the worktree to the project by registering it from inside a record
    // that already holds the main path.
    const { registrations } = await readAllRegistrations(io.env)
    const record = registrations[0]!
    await writeRegistration({ ...record, paths: [...record.paths, '/w/proj-wt'] }, io.env)

    out.length = 0
    await runCli(['jot', 'from the worktree'], { ...io, cwd: '/w/proj-wt' })
    expect(out.join('\n')).toContain(record.slug)
  })
})
