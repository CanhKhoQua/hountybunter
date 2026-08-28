import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { appendJot, readJots } from '../src/jot/store.js'

let env: NodeJS.ProcessEnv
let home: string
const clock = (iso: string) => () => new Date(iso)

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'hb-'))
  env = { HOUNTYBUNTER_HOME: home } as NodeJS.ProcessEnv
})

describe('appendJot', () => {
  it('writes one line to a file named for the calendar date', async () => {
    const jot = await appendJot(
      { project: 'proj-a', text: 'chose SQLite' },
      { env, clock: clock('2026-08-27T15:04:05.000Z'), timeZone: 'UTC' },
    )
    expect(jot.date).toBe('2026-08-27')
    expect(await readFile(join(home, 'jots', '2026-08-27.md'), 'utf8'))
      .toBe('2026-08-27T15:04:05.000Z | proj-a | chose SQLite\n')
  })

  it('files a jot by the configured zone, not the machine zone', async () => {
    const jot = await appendJot(
      { project: 'proj-a', text: 'late night' },
      { env, clock: clock('2026-08-27T18:00:00.000Z'), timeZone: 'Asia/Ho_Chi_Minh' },
    )
    expect(jot.date).toBe('2026-08-28')
  })

  it('appends rather than overwriting', async () => {
    const opts = { env, clock: clock('2026-08-27T10:00:00.000Z'), timeZone: 'UTC' }
    await appendJot({ project: 'proj-a', text: 'first' }, opts)
    await appendJot({ project: 'proj-a', text: 'second' }, opts)
    const contents = await readFile(join(home, 'jots', '2026-08-27.md'), 'utf8')
    expect(contents.trim().split('\n')).toHaveLength(2)
  })

  it('collapses newlines so one jot is always one line', async () => {
    await appendJot(
      { project: 'proj-a', text: 'line one\nline two' },
      { env, clock: clock('2026-08-27T10:00:00.000Z'), timeZone: 'UTC' },
    )
    const contents = await readFile(join(home, 'jots', '2026-08-27.md'), 'utf8')
    expect(contents.trim().split('\n')).toHaveLength(1)
    expect(contents).toContain('line one line two')
  })

  it('rejects empty text', async () => {
    await expect(appendJot({ project: 'proj-a', text: '   ' }, { env, timeZone: 'UTC' }))
      .rejects.toThrow(/empty/i)
  })
})

describe('readJots', () => {
  it('returns an empty array when nothing has been jotted', async () => {
    expect(await readJots({ env })).toEqual([])
  })

  it('reads jots across days, oldest first', async () => {
    await appendJot({ project: 'p', text: 'day one' },
      { env, clock: clock('2026-08-26T10:00:00.000Z'), timeZone: 'UTC' })
    await appendJot({ project: 'p', text: 'day two' },
      { env, clock: clock('2026-08-27T10:00:00.000Z'), timeZone: 'UTC' })
    const jots = await readJots({ env })
    expect(jots.map((j) => j.text)).toEqual(['day one', 'day two'])
    expect(jots[0]?.line).toBe(1)
  })

  it('skips a malformed line instead of failing the read', async () => {
    await mkdir(join(home, 'jots'), { recursive: true })
    await writeFile(
      join(home, 'jots', '2026-08-27.md'),
      'garbage with no pipes\n2026-08-27T10:00:00.000Z | p | good one\n',
    )
    const jots = await readJots({ env })
    expect(jots).toHaveLength(1)
    expect(jots[0]?.text).toBe('good one')
  })
})
