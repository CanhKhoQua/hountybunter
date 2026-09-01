import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { indexNote, openDb, parseNote } from '@hountybunter/core'
import { handle } from '../src/server/routes.js'

let env: NodeJS.ProcessEnv

beforeEach(async () => {
  const home = await mkdtemp(join(tmpdir(), 'hb-web-'))
  env = { HOUNTYBUNTER_HOME: home } as NodeJS.ProcessEnv

  const db = openDb(env)
  try {
    db.prepare(
      `INSERT INTO sessions (id, project, started_at, title, branch, correlation)
       VALUES ('s1', 'proj-a', '2026-08-20T10:00:00.000Z', 'a hunt', 'main', 'guessed')`,
    ).run()
    db.prepare(
      `INSERT INTO activities (session_id, seq, kind, tool_name) VALUES ('s1', 1, 'assistant', 'Edit')`,
    ).run()
    indexNote(
      db,
      parseNote(
        '---\nid: n1\ntitle: Which basemap?\nproject: proj-a\nstatus: standing\nquestion: Which basemap?\nchosen: OpenFreeMap\n---\n\nbody\n',
        '/store/n1.md',
      ),
    )
  } finally {
    db.close()
  }
})

describe('GET /api/sessions', () => {
  it('returns the sessions in the store', async () => {
    const res = await handle('GET', '/api/sessions', null, env)
    expect(res.status).toBe(200)
    expect(res.body.sessions.map((s: { id: string }) => s.id)).toEqual(['s1'])
  })
})

describe('GET /api/sessions/:id', () => {
  it('returns one session with its activities', async () => {
    const res = await handle('GET', '/api/sessions/s1', null, env)
    expect(res.status).toBe(200)
    expect(res.body.session.title).toBe('a hunt')
    expect(res.body.activities).toHaveLength(1)
  })

  it('answers an unknown id with 404 and a message, not an empty 200', async () => {
    const res = await handle('GET', '/api/sessions/nope', null, env)
    expect(res.status).toBe(404)
    expect(String(res.body.error)).toMatch(/nope/)
  })
})

describe('GET /api/notes', () => {
  it('returns the notes in the store', async () => {
    const res = await handle('GET', '/api/notes', null, env)
    expect(res.body.notes.map((n: { id: string }) => n.id)).toEqual(['n1'])
  })

  it('filters by a search query when one is given', async () => {
    const hit = await handle('GET', '/api/notes?q=openfreemap', null, env)
    expect(hit.body.notes.map((n: { id: string }) => n.id)).toEqual(['n1'])

    const miss = await handle('GET', '/api/notes?q=kubernetes', null, env)
    expect(miss.body.notes).toEqual([])
  })
})

describe('GET /api/regions', () => {
  it('reports each project with its session and note counts', async () => {
    const res = await handle('GET', '/api/regions', null, env)
    expect(res.body.regions).toEqual([
      { project: 'proj-a', sessions: 1, notes: 1 },
    ])
  })
})

describe('unknown routes', () => {
  it('404s rather than throwing', async () => {
    expect((await handle('GET', '/api/quarry', null, env)).status).toBe(404)
    expect((await handle('POST', '/api/sessions', null, env)).status).toBe(404)
  })
})
