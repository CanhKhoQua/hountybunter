import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { indexNote, openDb, parseNote } from '@hountybunter/core'
import { handle } from '../src/server/routes.js'

let env: NodeJS.ProcessEnv

beforeEach(async () => {
  const home = await mkdtemp(join(tmpdir(), 'hb-web-'))
  // Pinned, not inherited: the note's date must come from a declared zone,
  // never from whatever timezone the machine running the server happens to be in.
  env = { HOUNTYBUNTER_HOME: home, HOUNTYBUNTER_TZ: 'UTC' } as NodeJS.ProcessEnv

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

describe('POST /api/notes', () => {
  const decision = {
    sessionId: 's1',
    question: 'Dùng nền bản đồ nào?',
    chosen: 'OpenFreeMap',
    rejected: [{ option: 'CARTO', why_not: 'giới hạn request gói free' }],
  }

  it('writes a note into the project the session belongs to', async () => {
    const res = await handle('POST', '/api/notes', decision, env)
    expect(res.status).toBe(201)
    expect(res.body.note.id).toBe('2026-08-20-dung-nen-ban-do-nao')
    expect(res.body.note.project).toBe('proj-a')
  })

  it('dates the note from when the session ran, not from now', async () => {
    const res = await handle('POST', '/api/notes', decision, env)
    expect(res.body.note.decided_on).toBe('2026-08-20')
  })

  it('cites the session as evidence without being asked', async () => {
    const res = await handle('POST', '/api/notes', decision, env)
    expect(res.body.note.evidence).toContainEqual({ kind: 'session', ref: 's1' })
  })

  it('makes the rejected reason searchable straight away', async () => {
    await handle('POST', '/api/notes', decision, env)
    const found = await handle('GET', '/api/notes?q=' + encodeURIComponent('giới hạn request'), null, env)
    expect(found.body.notes).toHaveLength(1)
  })

  it('writes a file that parses back as the same note', async () => {
    const res = await handle('POST', '/api/notes', decision, env)
    const written = await readFile(res.body.note.sourcePath, 'utf8')
    const reparsed = parseNote(written, res.body.note.sourcePath)
    expect(reparsed.chosen).toBe('OpenFreeMap')
    expect(reparsed.rejected[0]?.why_not).toBe('giới hạn request gói free')
  })

  it('names the missing field instead of failing vaguely', async () => {
    const noQuestion = await handle('POST', '/api/notes', { ...decision, question: '' }, env)
    expect(noQuestion.status).toBe(400)
    expect(String(noQuestion.body.error)).toMatch(/question/)

    const noChosen = await handle('POST', '/api/notes', { ...decision, chosen: '  ' }, env)
    expect(noChosen.status).toBe(400)
    expect(String(noChosen.body.error)).toMatch(/chosen/)
  })

  it('refuses a session it has never ingested', async () => {
    const res = await handle('POST', '/api/notes', { ...decision, sessionId: 'nope' }, env)
    expect(res.status).toBe(404)
    expect(String(res.body.error)).toMatch(/nope/)
  })
})

describe('POST /api/notes across a date boundary', () => {
  it('dates the note in the configured zone, not the machine zone', async () => {
    const db = openDb(env)
    try {
      db.prepare(
        `INSERT INTO sessions (id, project, started_at, correlation)
         VALUES ('late', 'proj-a', '2026-08-20T18:00:00.000Z', 'exact')`,
      ).run()
    } finally {
      db.close()
    }

    const vn = { ...env, HOUNTYBUNTER_TZ: 'Asia/Ho_Chi_Minh' } as NodeJS.ProcessEnv
    const res = await handle(
      'POST',
      '/api/notes',
      { sessionId: 'late', question: 'q', chosen: 'c' },
      vn,
    )

    // 18:00 UTC on the 20th is 01:00 on the 21st in Ho Chi Minh City.
    expect(res.body.note.decided_on).toBe('2026-08-21')
  })
})

describe('GET /api/notes/:id', () => {
  it('returns the whole record, including what lost and why', async () => {
    const created = await handle(
      'POST',
      '/api/notes',
      {
        sessionId: 's1',
        question: 'Which basemap?',
        chosen: 'OpenFreeMap',
        rejected: [{ option: 'CARTO', why_not: 'request cap on the free tier' }],
      },
      env,
    )

    const res = await handle('GET', `/api/notes/${created.body.note.id}`, null, env)
    expect(res.status).toBe(200)
    expect(res.body.note.chosen).toBe('OpenFreeMap')
    expect(res.body.note.rejected[0].why_not).toBe('request cap on the free tier')
  })

  it('404s for a note that is not in the store', async () => {
    const res = await handle('GET', '/api/notes/2026-01-01-nope', null, env)
    expect(res.status).toBe(404)
  })
})
