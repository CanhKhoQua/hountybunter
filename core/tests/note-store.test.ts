import { chmod, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { parseNote } from '../src/note/parse.js'
import { makeNoteId, readAllNotes, slugifyTitle, writeNote } from '../src/note/store.js'

let env: NodeJS.ProcessEnv

beforeEach(async () => {
  const home = await mkdtemp(join(tmpdir(), 'hb-'))
  env = { HOUNTYBUNTER_HOME: home } as NodeJS.ProcessEnv
})

const RAW = `---
id: 2026-08-12-pick-db
project: proj-abc123
question: Which database?
chosen: SQLite
---

Because it is a file.
`

describe('slugifyTitle', () => {
  it('lowercases and hyphenates', () => {
    expect(slugifyTitle('Offline reads for the rep PWA')).toBe('offline-reads-for-the-rep-pwa')
  })

  it('strips punctuation and collapses runs', () => {
    expect(slugifyTitle('Which DB?  Postgres vs. SQLite!')).toBe('which-db-postgres-vs-sqlite')
  })

  it('truncates very long titles', () => {
    expect(slugifyTitle('x'.repeat(200)).length).toBeLessThanOrEqual(60)
  })
})

describe('makeNoteId', () => {
  it('prefixes the calendar date in the given zone', () => {
    expect(makeNoteId('Pick a DB', '2026-08-27T03:30:00.000Z', 'America/New_York'))
      .toBe('2026-08-26-pick-a-db')
  })

  it('falls back to a hash when the title slugifies to nothing', () => {
    const id = makeNoteId('缓存策略', '2026-08-27T03:30:00.000Z', 'UTC')
    expect(id).toMatch(/^2026-08-27-[0-9a-f]{8}$/)
  })

  it('gives different non-Latin titles different ids on the same day', () => {
    const a = makeNoteId('缓存策略', '2026-08-27T03:30:00.000Z', 'UTC')
    const b = makeNoteId('另一个标题', '2026-08-27T03:30:00.000Z', 'UTC')
    expect(a).not.toBe(b)
  })

  it('gives titles sharing a 60-character prefix different ids', () => {
    const a = makeNoteId(`${'a'.repeat(60)}X`, '2026-08-27T03:30:00.000Z', 'UTC')
    const b = makeNoteId(`${'a'.repeat(60)}Y`, '2026-08-27T03:30:00.000Z', 'UTC')
    expect(a).not.toBe(b)
  })

  it('leaves an ordinary short title unaffected', () => {
    expect(makeNoteId('Pick a DB', '2026-08-27T03:30:00.000Z', 'UTC')).toBe('2026-08-27-pick-a-db')
  })
})

describe('writeNote / readAllNotes', () => {
  it('writes a note and reads it back', async () => {
    const path = await writeNote(parseNote(RAW, '/unused.md'), env)
    expect(path).toMatch(/notes\/proj-abc123\/2026-08-12-pick-db\.md$/)

    const { notes, errors } = await readAllNotes(env)
    expect(errors).toEqual([])
    expect(notes).toHaveLength(1)
    expect(notes[0]?.chosen).toBe('SQLite')
  })

  it('returns an empty result when the store does not exist yet', async () => {
    const { notes, errors } = await readAllNotes(env)
    expect(notes).toEqual([])
    expect(errors).toEqual([])
  })

  it('collects an error for a malformed note without losing the good ones', async () => {
    await writeNote(parseNote(RAW, '/unused.md'), env)
    const dir = join(env.HOUNTYBUNTER_HOME!, 'notes', 'proj-abc123')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'broken.md'), '---\nchosen: only\n---\n\nno question\n')

    const { notes, errors } = await readAllNotes(env)
    expect(notes).toHaveLength(1)
    expect(errors).toHaveLength(1)
    expect(errors[0]?.field).toBe('question')
  })

  it('ignores non-markdown files', async () => {
    const dir = join(env.HOUNTYBUNTER_HOME!, 'notes', 'proj-abc123')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'notes.txt'), 'not a note')
    const { notes, errors } = await readAllNotes(env)
    expect(notes).toEqual([])
    expect(errors).toEqual([])
  })

  it('collects an error for an unreadable project directory without losing other projects', async () => {
    await writeNote(parseNote(RAW, '/unused.md'), env)

    const blocked = join(env.HOUNTYBUNTER_HOME!, 'notes', 'proj-blocked')
    await mkdir(blocked, { recursive: true })
    await chmod(blocked, 0o000)
    try {
      const { notes, errors } = await readAllNotes(env)
      expect(notes).toHaveLength(1)
      expect(notes[0]?.chosen).toBe('SQLite')
      expect(errors).toHaveLength(1)
      expect(errors[0]?.sourcePath).toContain('proj-blocked')
    } finally {
      await chmod(blocked, 0o755)
    }
  })
})
