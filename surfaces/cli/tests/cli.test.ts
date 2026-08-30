import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { runCli, type Io } from '../src/bin.js'

let out: string[]
let err: string[]
let io: Io
let home: string

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'hb-'))
  out = []
  err = []
  io = {
    out: (l) => out.push(l),
    err: (l) => err.push(l),
    env: { HOUNTYBUNTER_HOME: home, HOUNTYBUNTER_TZ: 'UTC' } as NodeJS.ProcessEnv,
    cwd: '/Users/x/myproject',
  }
})

describe('hb jot', () => {
  it('captures a line and reports where it went', async () => {
    expect(await runCli(['jot', 'chose', 'SQLite', 'over', 'Postgres'], io)).toBe(0)
    expect(out.join('\n')).toMatch(/jotted/i)
  })

  it('fails with a message when given no text', async () => {
    expect(await runCli(['jot'], io)).toBe(1)
    expect(err.join('\n')).toMatch(/text/i)
  })
})

describe('hb promote', () => {
  it('turns jot 1 into a note', async () => {
    await runCli(['jot', 'chose', 'SQLite'], io)
    expect(await runCli(['promote', '1', '--question', 'Which database?', '--chosen', 'SQLite'], io))
      .toBe(0)
    expect(out.join('\n')).toMatch(/which-database/)
  })

  it('rejects a jot number that does not exist', async () => {
    expect(await runCli(['promote', '9', '--question', 'q', '--chosen', 'c'], io)).toBe(1)
    expect(err.join('\n')).toMatch(/no jot/i)
  })

  it('requires --question and --chosen', async () => {
    await runCli(['jot', 'anything'], io)
    expect(await runCli(['promote', '1', '--question', 'q'], io)).toBe(1)
    expect(err.join('\n')).toMatch(/chosen/)
  })
})

describe('hb search and list', () => {
  it('finds a promoted note', async () => {
    await runCli(['jot', 'chose SQLite because it is a file'], io)
    await runCli(['promote', '1', '--question', 'Which database?', '--chosen', 'SQLite'], io)

    out.length = 0
    expect(await runCli(['search', 'database'], io)).toBe(0)
    expect(out.join('\n')).toMatch(/Which database\?/)
  })

  it('says so plainly when nothing matches', async () => {
    expect(await runCli(['search', 'kubernetes'], io)).toBe(0)
    expect(out.join('\n')).toMatch(/no matches/i)
  })

  it('lists notes', async () => {
    await runCli(['jot', 'anything'], io)
    await runCli(['promote', '1', '--question', 'Which cache?', '--chosen', 'Redis'], io)

    out.length = 0
    expect(await runCli(['list'], io)).toBe(0)
    expect(out.join('\n')).toMatch(/Which cache\?/)
  })
})

describe('hb rebuild', () => {
  it('reports how many notes were indexed', async () => {
    await runCli(['jot', 'anything'], io)
    await runCli(['promote', '1', '--question', 'q', '--chosen', 'c'], io)
    out.length = 0
    expect(await runCli(['rebuild'], io)).toBe(0)
    expect(out.join('\n')).toMatch(/1 note/)
  })

  it('--verify confirms a second rebuild is identical', async () => {
    await runCli(['jot', 'anything'], io)
    await runCli(['promote', '1', '--question', 'q', '--chosen', 'c'], io)
    out.length = 0
    expect(await runCli(['rebuild', '--verify'], io)).toBe(0)
    expect(out.join('\n')).toMatch(/identical/i)
  })

  it('exits 1 when a note fails to index, but still indexes the good one', async () => {
    await runCli(['jot', 'good one'], io)
    await runCli(['promote', '1', '--question', 'q', '--chosen', 'c'], io)

    const brokenDir = join(home, 'notes', 'broken-proj')
    await mkdir(brokenDir, { recursive: true })
    await writeFile(join(brokenDir, 'bad.md'), '---\nchosen: only\n---\n\nx\n')

    out.length = 0
    err.length = 0
    expect(await runCli(['rebuild'], io)).toBe(1)
    expect(out.join('\n')).toMatch(/1 note/)
    expect(err.join('\n').length).toBeGreaterThan(0)
  })
})

describe('dispatch', () => {
  it('prints usage and exits non-zero for an unknown command', async () => {
    expect(await runCli(['fly'], io)).toBe(1)
    expect(err.join('\n')).toMatch(/usage/i)
  })

  it('prints usage for no arguments', async () => {
    expect(await runCli([], io)).toBe(1)
  })
})

describe('hostile input', () => {
  const cases: [string, string[]][] = [
    ['negative jot number', ['promote', '-1', '--question', 'q', '--chosen', 'c']],
    ['non-numeric jot number', ['promote', 'abc', '--question', 'q', '--chosen', 'c']],
    ['zero jot number', ['promote', '0', '--question', 'q', '--chosen', 'c']],
    ['missing jot number', ['promote', '--question', 'q', '--chosen', 'c']],
    ['non-numeric limit', ['search', 'anything', '--limit', 'abc']],
    ['negative limit', ['list', '--limit', '-5']],
  ]

  for (const [name, argv] of cases) {
    it(`reports ${name} without crashing`, async () => {
      expect(await runCli(argv, io)).toBe(1)
      const message = err.join('\n')
      expect(message).not.toMatch(/at .*\(.*:\d+:\d+\)/)   // no stack frames
      expect(message.length).toBeGreaterThan(0)
    })
  }
})
