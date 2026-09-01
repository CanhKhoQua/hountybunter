import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { recordDecision } from '../src/note/record.js'

let env: NodeJS.ProcessEnv
let home: string

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'hb-'))
  env = { HOUNTYBUNTER_HOME: home } as NodeJS.ProcessEnv
})

const base = {
  origin: 'authored' as const,
  project: 'proj-a',
  instant: '2026-08-27T15:04:05.000Z',
  question: 'Which database?',
  chosen: 'SQLite',
}

describe('recordDecision', () => {
  it('dates the note from the instant given, in the timezone given', async () => {
    const note = await recordDecision(base, { env, timeZone: 'Asia/Ho_Chi_Minh' })
    // 15:04 UTC is already the 27th in Ho Chi Minh City; the point is that the
    // date comes from the instant, never from the clock at write time.
    expect(note.decided_on).toBe('2026-08-27')
    expect(note.id).toBe('2026-08-27-which-database')
  })

  it('writes the file under the project it belongs to', async () => {
    const note = await recordDecision(base, { env, timeZone: 'UTC' })
    const written = await readFile(join(home, 'notes', 'proj-a', `${note.id}.md`), 'utf8')
    expect(written).toContain('chosen: SQLite')
  })

  it('carries rejected options and evidence', async () => {
    const note = await recordDecision(
      {
        ...base,
        rejected: [{ option: 'Postgres', why_not: 'a server to run for one user' }],
        evidence: [{ kind: 'session', ref: 's1' }],
      },
      { env, timeZone: 'UTC' },
    )
    expect(note.rejected).toHaveLength(1)
    expect(note.evidence).toEqual([{ kind: 'session', ref: 's1' }])

    const written = await readFile(note.sourcePath, 'utf8')
    expect(written).toContain('a server to run for one user')
  })

  it('leaves the body empty when nothing was captured in the moment', async () => {
    const note = await recordDecision(base, { env, timeZone: 'UTC' })
    expect(note.body.trim()).toBe('')
  })

  it('requires both question and chosen', async () => {
    await expect(recordDecision({ ...base, question: '  ' }, { env, timeZone: 'UTC' }))
      .rejects.toThrow(/question/)
    await expect(recordDecision({ ...base, chosen: '' }, { env, timeZone: 'UTC' }))
      .rejects.toThrow(/chosen/)
  })
})

describe('recordDecision origin', () => {
  it('stamps the origin the caller declares', async () => {
    const note = await recordDecision({ ...base, origin: 'drafted' }, { env, timeZone: 'UTC' })
    expect(note.origin).toBe('drafted')
  })

  it('writes the origin into the file, not only the returned object', async () => {
    // The index is deletable by design, so a channel recorded only there would
    // not survive `hb rebuild`. It has to live in the markdown or it is not
    // durable at all.
    const note = await recordDecision({ ...base, origin: 'drafted' }, { env, timeZone: 'UTC' })
    expect(await readFile(note.sourcePath, 'utf8')).toContain('origin: drafted')
  })

  it('carries supersedes onto the note and into the file', async () => {
    const note = await recordDecision(
      { ...base, origin: 'authored', supersedes: ['2026-08-01-old-call'] },
      { env, timeZone: 'UTC' },
    )
    expect(note.supersedes).toEqual(['2026-08-01-old-call'])
    expect(await readFile(note.sourcePath, 'utf8')).toContain('2026-08-01-old-call')
  })
})
