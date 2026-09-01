import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { promoteJot } from '../src/jot/promote.js'
import { appendJot } from '../src/jot/store.js'

let env: NodeJS.ProcessEnv
let home: string

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'hb-'))
  env = { HOUNTYBUNTER_HOME: home } as NodeJS.ProcessEnv
})

async function jot(text: string) {
  return appendJot(
    { project: 'proj-a', text },
    { env, clock: () => new Date('2026-08-27T15:04:05.000Z'), timeZone: 'UTC' },
  )
}

describe('promoteJot', () => {
  it('creates a note dated from the jot, not from now', async () => {
    const note = await promoteJot(
      await jot('chose SQLite over Postgres'),
      { question: 'Which database?', chosen: 'SQLite' },
      { env, clock: () => new Date('2027-01-01T00:00:00.000Z'), timeZone: 'UTC' },
    )
    expect(note.id.startsWith('2026-08-27-')).toBe(true)
    expect(note.decided_on).toBe('2026-08-27')
  })

  it('keeps the jot text as the first body paragraph', async () => {
    const note = await promoteJot(
      await jot('chose SQLite over Postgres'),
      { question: 'Which database?', chosen: 'SQLite' },
      { env, timeZone: 'UTC' },
    )
    expect(note.body).toContain('chose SQLite over Postgres')
  })

  it('defaults the title to the question', async () => {
    const note = await promoteJot(
      await jot('anything'),
      { question: 'Which database?', chosen: 'SQLite' },
      { env, timeZone: 'UTC' },
    )
    expect(note.title).toBe('Which database?')
  })

  it('uses an explicit title when given', async () => {
    const note = await promoteJot(
      await jot('anything'),
      { question: 'Which database?', chosen: 'SQLite', title: 'Storage engine' },
      { env, timeZone: 'UTC' },
    )
    expect(note.title).toBe('Storage engine')
    expect(note.id).toBe('2026-08-27-storage-engine')
  })

  it('writes the note into the jot project directory', async () => {
    const note = await promoteJot(
      await jot('anything'),
      { question: 'q', chosen: 'c' },
      { env, timeZone: 'UTC' },
    )
    const written = await readFile(join(home, 'notes', 'proj-a', `${note.id}.md`), 'utf8')
    expect(written).toContain('chosen: c')
  })

  it('requires both question and chosen', async () => {
    const j = await jot('anything')
    await expect(promoteJot(j, { question: '', chosen: 'c' }, { env, timeZone: 'UTC' }))
      .rejects.toThrow(/question/)
    await expect(promoteJot(j, { question: 'q', chosen: '' }, { env, timeZone: 'UTC' }))
      .rejects.toThrow(/chosen/)
  })

  it('carries rejected options onto the note', async () => {
    const note = await promoteJot(
      await jot('bỏ CARTO'),
      {
        question: 'Which basemap?',
        chosen: 'OpenFreeMap',
        rejected: [{ option: 'CARTO', why_not: 'Request cap on the free tier' }],
      },
      { env, timeZone: 'UTC' },
    )
    expect(note.rejected).toEqual([{ option: 'CARTO', why_not: 'Request cap on the free tier' }])

    const written = await readFile(join(home, 'notes', 'proj-a', `${note.id}.md`), 'utf8')
    expect(written).toContain('CARTO')
    expect(written).toContain('Request cap on the free tier')
  })

  it('carries evidence onto the note', async () => {
    const note = await promoteJot(
      await jot('anything'),
      {
        question: 'q',
        chosen: 'c',
        evidence: [{ kind: 'commit', ref: '99aee8c' }],
      },
      { env, timeZone: 'UTC' },
    )
    expect(note.evidence).toEqual([{ kind: 'commit', ref: '99aee8c' }])

    const written = await readFile(join(home, 'notes', 'proj-a', `${note.id}.md`), 'utf8')
    expect(written).toContain('99aee8c')
  })
})
