import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  parseNote,
  projectSlug,
  projectsDir,
  readAllRegistrations,
  writeNote,
  writeRegistration,
} from '@hountybunter/core'
import { runCli, type Io } from '../src/bin.js'

let io: Io
let home: string
let out: string[]
let err: string[]

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'hb-brief-'))
  const live = await mkdtemp(join(tmpdir(), 'hb-brief-live-'))
  out = []
  err = []
  io = {
    out: (l) => out.push(l),
    err: (l) => err.push(l),
    env: {
      HOUNTYBUNTER_HOME: home,
      HOUNTYBUNTER_TZ: 'UTC',
      HOUNTYBUNTER_TRANSCRIPTS: live,
    } as NodeJS.ProcessEnv,
    cwd: process.cwd(),
  }
})

describe('hb brief', () => {
  it('refuses to speak for a project nobody registered, and says how to fix it', async () => {
    expect(await runCli(['brief'], { ...io, cwd: '/w/unregistered' })).toBe(1)
    expect(err.join('\n')).toContain('hb register')
  })

  it('prints the tree state for a registered project', async () => {
    await runCli(['register'], io)
    out.length = 0
    expect(await runCli(['brief', '--no-ingest'], io)).toBe(0)
    const text = out.join('\n')
    expect(text).toContain('In flight now')
    expect(text).toContain('Verify against the working tree')
  })

  it('refuses a flag it does not know instead of ignoring it', async () => {
    await runCli(['register'], io)
    expect(await runCli(['brief', '--wat'], io)).toBe(1)
  })

  /** The record `hb register` wrote for the project this `io` points at. */
  async function recordPath(): Promise<string> {
    const { registrations } = await readAllRegistrations(io.env)
    return join(projectsDir(io.env), `${registrations[0]!.slug}.md`)
  }

  /** A standing note filed under `slug`, on disk for `hb rebuild` to index. */
  async function seedNote(slug: string, id: string, title: string): Promise<void> {
    const note = parseNote(
      `---\nid: ${id}\ntitle: ${title}\nproject: ${slug}\nkind: decision\n` +
        `status: standing\nquestion: q?\nchosen: c\n---\n\nbody\n`,
      join(home, 'notes', slug, `${id}.md`),
    )
    await writeNote(note, io.env)
  }

  it('names a record it could not read instead of calling the project unregistered', async () => {
    await runCli(['register'], io)
    const path = await recordPath()
    // A hand-edit that no longer parses: `registered_at` is required.
    await writeFile(path, (await readFile(path, 'utf8')).replace(/^registered_at:.*\n/m, ''), 'utf8')

    out.length = 0
    err.length = 0
    expect(await runCli(['brief', '--no-ingest'], io)).toBe(1)
    const said = err.join('\n')
    expect(said).toContain(path)
    expect(said).toMatch(/registered_at/)
    // Sending the user to `hb register` here is what destroys the file.
    expect(said).not.toMatch(/is not a registered project/)
  })

  it('says how many plan steps the plan holds, not how many it was handed', async () => {
    const project = await mkdtemp(join(tmpdir(), 'hb-brief-plan-'))
    const steps = Array.from(
      { length: 30 },
      (_, i) => `- [ ] Step ${i + 1}: a plan step with a realistically descriptive title`,
    )
    await writeFile(join(project, 'plan.md'), `${steps.join('\n')}\n`, 'utf8')

    const where = { ...io, cwd: project }
    await runCli(['register', '--plan', 'plan.md'], where)
    out.length = 0
    expect(await runCli(['brief', '--no-ingest'], where)).toBe(0)

    const aiming = out.join('\n').split(/\n(?=## )/).find((b) => b.startsWith('## Aiming at'))!
    const kept = aiming.split('\n').filter((l) => l.startsWith('- ')).length
    const dropped = Number(/… (\d+) more, cut to fit/.exec(aiming)?.[1] ?? 0)
    expect(dropped).toBeGreaterThan(0)
    expect(kept + dropped).toBe(30)
  })

  it("reaches a worktree's notes rather than stopping at the first slug's ten", async () => {
    const main = await mkdtemp(join(tmpdir(), 'hb-brief-main-'))
    const worktree = await mkdtemp(join(tmpdir(), 'hb-brief-wt-'))
    const where = { ...io, cwd: main }
    await runCli(['register'], where)

    // Join the worktree to the project, as registering from inside it would.
    const { registrations } = await readAllRegistrations(io.env)
    await writeRegistration({ ...registrations[0]!, paths: [main, worktree] }, io.env)

    for (let i = 0; i < 10; i++) {
      await seedNote(projectSlug(main), `2026-09-0${1 + (i % 3)}-older-${i}`, `older decision ${i}`)
    }
    await seedNote(projectSlug(worktree), '2026-09-08-newest', 'newest decision, in the worktree')
    await runCli(['rebuild'], where)

    out.length = 0
    expect(await runCli(['brief', '--no-ingest'], where)).toBe(0)
    const text = out.join('\n')
    // Concatenating ten notes per slug and slicing to ten never reached this one.
    expect(text).toContain('newest decision, in the worktree')
    // And it is ordered by date across both slugs, not by which slug was read first.
    expect(text.indexOf('newest decision')).toBeLessThan(text.indexOf('older decision'))
  })
})
