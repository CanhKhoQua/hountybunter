import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { indexNote, notesDir, openDb, parseNote } from '@hountybunter/core'
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
      `INSERT INTO sessions (id, project, started_at, title, branch, correlation, harness)
       VALUES ('s1', 'proj-a', '2026-08-20T10:00:00.000Z', 'a hunt', 'main', 'guessed', 'claude-code')`,
    ).run()
    db.prepare(
      `INSERT INTO activities (session_id, seq, kind, tool_name) VALUES ('s1', 1, 'assistant', 'Edit')`,
    ).run()
    // Written to a real file, not just indexed: the detail and acknowledge
    // routes read the note back off disk, and a fake path would 404 them.
    const notePath = join(notesDir('proj-a', env), 'n1.md')
    const noteRaw =
      '---\nid: n1\ntitle: Which basemap?\nproject: proj-a\nstatus: standing\nquestion: Which basemap?\nchosen: OpenFreeMap\nevidence:\n  - {kind: file, ref: a.ts}\n---\n\nbody\n'
    await mkdir(notesDir('proj-a', env), { recursive: true })
    await writeFile(notePath, noteRaw, 'utf8')
    indexNote(db, parseNote(noteRaw, notePath))
  } finally {
    db.close()
  }
})

describe('paging', () => {
  /** Enough rows that a page is smaller than the list. */
  async function bulk() {
    const db = openDb(env)
    try {
      for (let i = 2; i <= 12; i += 1) {
        db.prepare(
          `INSERT INTO sessions (id, project, started_at, correlation, harness)
           VALUES (?, 'proj-a', ?, 'exact', 'claude-code')`,
        ).run(`s${i}`, `2026-08-${String(i).padStart(2, '0')}T10:00:00.000Z`)
      }
      for (let seq = 2; seq <= 12; seq += 1) {
        db.prepare(`INSERT INTO activities (session_id, seq, kind) VALUES ('s1', ?, 'user')`).run(
          seq,
        )
      }
    } finally {
      db.close()
    }
  }

  it('reports the whole count beside the page it served', async () => {
    // Without this the client cannot tell a short list from a truncated one,
    // which is exactly how a session of thousands came to show its first 500
    // in silence.
    await bulk()
    const res = await handle('GET', '/api/sessions?limit=5', null, env)

    expect(res.body.sessions).toHaveLength(5)
    expect(res.body.total).toBe(12)
  })

  it('moves the window with offset, without repeating a row', async () => {
    await bulk()
    const first = await handle('GET', '/api/sessions?limit=5&offset=0', null, env)
    const second = await handle('GET', '/api/sessions?limit=5&offset=5', null, env)

    const ids = (r: { body: { sessions: { id: string }[] } }) => r.body.sessions.map((s) => s.id)
    expect(ids(first)).not.toEqual(ids(second))
    expect(ids(first).filter((id) => ids(second).includes(id))).toEqual([])
  })

  it('pages the activities of one session, and says how many there are', async () => {
    await bulk()
    const res = await handle('GET', '/api/sessions/s1?limit=4&offset=4', null, env)

    expect(res.body.activities).toHaveLength(4)
    expect(res.body.activities[0].seq).toBe(5)
    expect(res.body.total).toBe(12)
  })

  it('pages notes and regions the same way', async () => {
    const notes = await handle('GET', '/api/notes?limit=1', null, env)
    expect(notes.body.notes).toHaveLength(1)
    expect(notes.body.total).toBe(1)

    const regions = await handle('GET', '/api/regions?limit=1', null, env)
    expect(regions.body.regions).toHaveLength(1)
    expect(regions.body.total).toBe(1)
  })

  it('refuses a limit or offset that is not a sane number', async () => {
    // These arrive from a URL, so they arrive as anything. A negative offset is
    // a SQL error and a vast limit is a way to ask the server to read the whole
    // table into memory.
    const nonsense = ['limit=0', 'limit=-3', 'limit=abc', 'limit=99999', 'offset=-1', 'offset=x']
    for (const query of nonsense) {
      const res = await handle('GET', `/api/sessions?${query}`, null, env)
      expect(res.status, query).toBe(200)
      expect(res.body.sessions.length, query).toBeGreaterThan(0)
    }
  })
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
    // No `projects` row here, so the directory reads as unknown rather than
    // being invented from the slug — which cannot be turned back into a path.
    expect(res.body.regions).toEqual([
      { project: 'proj-a', sessions: 1, notes: 1, path: null, name: null, lastSeenAt: null, stale: 0 },
    ])
  })
})

describe('GET /api/health', () => {
  it('answers whether hooks are arriving, or parked, or absent', async () => {
    // Three different situations look identical from hook_events alone, and
    // the store cannot say which without being asked about the spool too.
    const res = await handle('GET', '/api/health', null, env)

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ hookEvents: 0, spooled: 0, hunts: 0 })
  })

  it('counts the events a hook parked while nothing was listening', async () => {
    await writeFile(
      join(env.HOUNTYBUNTER_HOME!, 'spool.jsonl'),
      `${JSON.stringify({ hook_event_name: 'Stop', session_id: 's9', cwd: '/w' })}\n`,
    )

    const res = await handle('GET', '/api/health', null, env)
    expect(res.body.spooled).toBe(1)
  })
})

describe('POST /api/browse', () => {
  it('answers with the directory the desktop dialog returned', async () => {
    const res = await handle('POST', '/api/browse', null, {
      ...env,
      HOUNTYBUNTER_CHOOSER: 'echo /Users/you/project',
    } as NodeJS.ProcessEnv)

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ path: '/Users/you/project' })
  })

  it('answers 200 with no path when the dialog was cancelled', async () => {
    // Declining to choose is a normal answer, not a failure to report.
    const res = await handle('POST', '/api/browse', null, {
      ...env,
      HOUNTYBUNTER_CHOOSER: 'exit 1',
    } as NodeJS.ProcessEnv)

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ path: null })
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
        `INSERT INTO sessions (id, project, started_at, correlation, harness)
         VALUES ('late', 'proj-a', '2026-08-20T18:00:00.000Z', 'exact', 'claude-code')`,
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

describe('staleness over the API', () => {
  it('marks a note in the list whose evidence was found changed', async () => {
    const db = openDb(env)
    try {
      db.prepare(`UPDATE note_evidence SET state = 'changed'`).run()
    } finally {
      db.close()
    }

    const res = await handle('GET', '/api/notes', null, env)
    expect(res.body.notes[0].stale).toBe(true)
  })

  it('gives each reference its own state, not one verdict for all of them', async () => {
    // One verdict for the whole note would hide which reference moved.
    const res = await handle('GET', '/api/notes/n1', null, env)
    expect(res.body.note.evidence[0]).toMatchObject({ ref: 'a.ts', state: 'unknown' })
  })

  it('acknowledges a note and writes the baseline to its file', async () => {
    const res = await handle('POST', '/api/notes/n1/verified', {}, env)

    expect(res.status).toBe(200)
    expect(res.body.note.verified.on).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('answers an acknowledgement in the same shape as the detail route, with per-evidence state and stale', async () => {
    // The client feeds this response straight into the same view that renders
    // GET /api/notes/:id. A bare core Note here — {kind, ref} with no state,
    // and no top-level `stale` — left every evidence row blank after "Still
    // true" was clicked.
    const res = await handle('POST', '/api/notes/n1/verified', {}, env)

    expect(res.body.note.evidence[0]).toMatchObject({ kind: 'file', ref: 'a.ts', state: 'unknown' })
    expect(res.body.note.stale).toBe(false)
  })

  it('404s an acknowledgement for a note that is not in the store', async () => {
    expect((await handle('POST', '/api/notes/nope/verified', {}, env)).status).toBe(404)
  })
})
