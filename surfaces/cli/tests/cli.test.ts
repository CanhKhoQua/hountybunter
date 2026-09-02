import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { appendJot, openDb, readJots } from '@hountybunter/core'
import { runCli, stopWeb, type Io } from '../src/bin.js'

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

  it('refuses a flag instead of recording it as the note', async () => {
    // `hb jot --help` used to file a jot whose entire content was "--help".
    // Swallowing an unrecognised flag as prose corrupts the store silently,
    // which is worse than any error message.
    expect(await runCli(['jot', '--help'], io)).toBe(1)
    expect(err.join('\n')).toMatch(/--help/)
    expect(await readJots({ env: io.env })).toHaveLength(0)
  })

  it('records a leading dash as text after an explicit --', async () => {
    expect(await runCli(['jot', '--', '--help is the literal point'], io)).toBe(0)
    const jots = await readJots({ env: io.env })
    expect(jots[0]!.text).toBe('--help is the literal point')
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

describe('hb jots', () => {
  it('says so plainly when there are none', async () => {
    expect(await runCli(['jots'], io)).toBe(0)
    expect(out.join('\n')).toMatch(/no jots/i)
  })

  it('numbers jots as a flat index across days, oldest first', async () => {
    const clock = (iso: string) => () => new Date(iso)
    await appendJot({ project: 'p', text: 'day one, first' },
      { env: io.env, timeZone: 'UTC', clock: clock('2026-08-20T10:00:00.000Z') })
    await appendJot({ project: 'p', text: 'day one, second' },
      { env: io.env, timeZone: 'UTC', clock: clock('2026-08-20T11:00:00.000Z') })
    await appendJot({ project: 'p', text: 'day two, first' },
      { env: io.env, timeZone: 'UTC', clock: clock('2026-08-21T10:00:00.000Z') })

    expect(await runCli(['jots'], io)).toBe(0)
    const lines = out.join('\n').split('\n')
    expect(lines[0]).toMatch(/^1\s+2026-08-20.*day one, first/)
    expect(lines[1]).toMatch(/^2\s+2026-08-20.*day one, second/)
    expect(lines[2]).toMatch(/^3\s+2026-08-21.*day two, first/)
  })

  it('--limit caps how many are shown, keeping the newest', async () => {
    const clock = (iso: string) => () => new Date(iso)
    await appendJot({ project: 'p', text: 'one' },
      { env: io.env, timeZone: 'UTC', clock: clock('2026-08-20T10:00:00.000Z') })
    await appendJot({ project: 'p', text: 'two' },
      { env: io.env, timeZone: 'UTC', clock: clock('2026-08-21T10:00:00.000Z') })
    await appendJot({ project: 'p', text: 'three' },
      { env: io.env, timeZone: 'UTC', clock: clock('2026-08-22T10:00:00.000Z') })

    expect(await runCli(['jots', '--limit', '2'], io)).toBe(0)
    const lines = out.join('\n').split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatch(/^2\s+.*two/)
    expect(lines[1]).toMatch(/^3\s+.*three/)
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

describe('hb sessions', () => {
  function ingestedSession(id: string, project: string, startedAt: string, title: string) {
    const db = openDb(io.env)
    try {
      db.prepare(
        `INSERT INTO sessions (id, project, started_at, title, correlation)
         VALUES (?, ?, ?, ?, 'exact')`,
      ).run(id, project, startedAt, title)
      db.prepare(`INSERT INTO activities (session_id, seq, kind) VALUES (?, 1, 'user')`).run(id)
    } finally {
      db.close()
    }
  }

  it('says so plainly when nothing has been ingested', async () => {
    expect(await runCli(['sessions'], io)).toBe(0)
    expect(out.join('\n')).toMatch(/no sessions/i)
  })

  it('shows an ingested session with its date, activity count, and title', async () => {
    ingestedSession('sess-1', 'proj-a', '2026-08-22T10:00:00.000Z', 'debt table rework')

    expect(await runCli(['sessions'], io)).toBe(0)
    const line = out.join('\n')
    expect(line).toMatch(/2026-08-22/)
    expect(line).toMatch(/debt table rework/)
    expect(line).toMatch(/\b1\b/)
    expect(line).toMatch(/sess-1/)
  })

  it('filters by project', async () => {
    ingestedSession('sess-1', 'proj-a', '2026-08-22T10:00:00.000Z', 'kept')
    ingestedSession('sess-2', 'proj-b', '2026-08-23T10:00:00.000Z', 'dropped')

    expect(await runCli(['sessions', '--project', 'proj-a'], io)).toBe(0)
    expect(out.join('\n')).toMatch(/kept/)
    expect(out.join('\n')).not.toMatch(/dropped/)
  })

  it('reports a session that carries no title instead of printing undefined', async () => {
    const db = openDb(io.env)
    try {
      db.prepare(
        `INSERT INTO sessions (id, project, started_at, title, correlation)
         VALUES ('sess-3', 'proj-a', '2026-08-22T10:00:00.000Z', NULL, 'exact')`,
      ).run()
    } finally {
      db.close()
    }

    expect(await runCli(['sessions'], io)).toBe(0)
    expect(out.join('\n')).not.toMatch(/undefined|null/)
  })
})

describe('hb promote --rejected and --evidence', () => {
  async function promote(...extra: string[]) {
    await runCli(['jot', 'bỏ CARTO lấy OpenFreeMap'], io)
    return runCli(
      ['promote', '1', '--question', 'Which basemap?', '--chosen', 'OpenFreeMap', ...extra],
      io,
    )
  }

  it('records a rejected option written as `option :: why not`', async () => {
    expect(await promote('--rejected', 'CARTO :: request cap on the free tier')).toBe(0)

    out.length = 0
    expect(await runCli(['search', 'request cap'], io)).toBe(0)
    expect(out.join('\n')).toMatch(/Which basemap\?/)
  })

  it('records more than one rejected option', async () => {
    expect(await promote(
      '--rejected', 'CARTO :: request cap',
      '--rejected', 'Mapbox :: needs a paid key',
    )).toBe(0)

    out.length = 0
    await runCli(['search', 'paid key'], io)
    expect(out.join('\n')).toMatch(/Which basemap\?/)
  })

  it('explains the syntax when the separator is missing instead of guessing', async () => {
    expect(await promote('--rejected', 'CARTO was too slow')).toBe(1)
    expect(err.join('\n')).toMatch(/::/)
  })

  it('records evidence written as `kind:ref`', async () => {
    expect(await promote('--evidence', 'commit:99aee8c')).toBe(0)

    out.length = 0
    expect(await runCli(['list'], io)).toBe(0)
    expect(out.join('\n')).toMatch(/Which basemap\?/)
  })

  it('rejects an evidence kind that is not one of the four', async () => {
    expect(await promote('--evidence', 'tweet:12345')).toBe(1)
    expect(err.join('\n')).toMatch(/file|commit|session|url/)
  })

  it('rejects evidence with no ref', async () => {
    expect(await promote('--evidence', 'commit:')).toBe(1)
    expect(err.join('\n').length).toBeGreaterThan(0)
  })
})

describe('hb web', () => {
  afterEach(stopWeb)

  it('starts on an ephemeral port and prints the address it actually bound', async () => {
    const code = await runCli(['web', '--port', '0'], io)
    expect(code).toBe(0)

    const printed = out.join('\n')
    expect(printed).toMatch(/http:\/\/127\.0\.0\.1:\d+/)
    // Never 0.0.0.0: the server has no auth, so it must not be reachable off-box.
    expect(printed).not.toMatch(/0\.0\.0\.0/)
  })

  it('rejects a hostile port the way the other numeric flags do', async () => {
    for (const port of ['-1', 'abc', '70000']) {
      out.length = 0
      err.length = 0
      expect(await runCli(['web', '--port', port], io)).toBe(1)
      expect(err.join('\n')).not.toMatch(/at .*\(.*:\d+:\d+\)/)
      expect(err.join('\n').length).toBeGreaterThan(0)
    }
  })
})

describe('hb promote --drafted', () => {
  it('marks a note an agent worded, so the store says who reasoned', async () => {
    await runCli(['jot', 'bỏ payload_json'], io)
    await runCli(
      ['promote', '1', '--question', 'Giữ payload_json?', '--chosen', 'Bỏ', '--drafted'],
      io,
    )
    const written = await readFile(
      join(home, 'notes', 'myproject-1c9268', '2026-09-01-giu-payload-json.md'),
      'utf8',
    ).catch(async () => {
      // The id carries today's date; find the one file rather than pin the date.
      const dir = join(home, 'notes')
      const project = (await readdir(dir))[0]!
      const file = (await readdir(join(dir, project)))[0]!
      return readFile(join(dir, project, file), 'utf8')
    })
    expect(written).toContain('origin: drafted')
  })

  it('is authored when the flag is absent', async () => {
    await runCli(['jot', 'anything'], io)
    await runCli(['promote', '1', '--question', 'q', '--chosen', 'c'], io)
    const dir = join(home, 'notes')
    const project = (await readdir(dir))[0]!
    const file = (await readdir(join(dir, project)))[0]!
    expect(await readFile(join(dir, project, file), 'utf8')).toContain('origin: authored')
  })
})
