import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { openDb } from '@hountybunter/core'
import { runCli, type Io } from '../src/bin.js'

let io: Io
let out: string[]
let home: string
let live: string

const line = (n: number) =>
  JSON.stringify({
    type: 'user',
    timestamp: `2026-08-2${n}T10:00:00.000Z`,
    cwd: '/w/proj',
    sessionId: 'sess-1',
  })

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'hb-rb-'))
  live = await mkdtemp(join(tmpdir(), 'hb-live-'))
  out = []
  io = {
    out: (l) => out.push(l),
    err: () => undefined,
    env: {
      HOUNTYBUNTER_HOME: home,
      HOUNTYBUNTER_TZ: 'UTC',
      HOUNTYBUNTER_TRANSCRIPTS: live,
    } as NodeJS.ProcessEnv,
    cwd: '/w/proj',
  }
  await mkdir(join(live, '-w-proj'), { recursive: true })
  await writeFile(join(live, '-w-proj', 'sess-1.jsonl'), `${line(1)}\n${line(2)}\n`)
})

function counts() {
  const db = openDb(io.env)
  try {
    const one = (q: string) => (db.prepare(q).get() as { c: number }).c
    return {
      notes: one('SELECT COUNT(*) c FROM notes'),
      sessions: one('SELECT COUNT(*) c FROM sessions'),
      activities: one('SELECT COUNT(*) c FROM activities'),
    }
  } finally {
    db.close()
  }
}

describe('hb rebuild restores the whole index', () => {
  beforeEach(async () => {
    await runCli(['ingest'], io)
    await runCli(['jot', 'a decision worth keeping'], io)
    await runCli(['promote', '1', '--question', 'q', '--chosen', 'c'], io)
    expect(counts()).toEqual({ notes: 1, sessions: 1, activities: 2 })
  })

  it('brings back sessions and activities, not only notes', async () => {
    // The schema-version error tells the user to delete the index and rebuild.
    // Following that instruction has to actually restore the index.
    await rm(join(home, 'index.db'), { force: true })
    await rm(join(home, 'index.db-shm'), { force: true })
    await rm(join(home, 'index.db-wal'), { force: true })

    expect(await runCli(['rebuild'], io)).toBe(0)
    expect(counts()).toEqual({ notes: 1, sessions: 1, activities: 2 })
  })

  it('does not double up when run against an index that is already full', async () => {
    expect(await runCli(['rebuild'], io)).toBe(0)
    expect(counts()).toEqual({ notes: 1, sessions: 1, activities: 2 })
  })

  it('reports what it restored, both halves', async () => {
    out.length = 0
    await runCli(['rebuild'], io)
    const said = out.join('\n')
    expect(said).toMatch(/1 note/)
    expect(said).toMatch(/1 session/)
  })

  it('--verify compares sessions too, not just notes', async () => {
    expect(await runCli(['rebuild', '--verify'], io)).toBe(0)
    expect(out.join('\n')).toMatch(/identical state/)
    expect(counts()).toEqual({ notes: 1, sessions: 1, activities: 2 })
  })
})
