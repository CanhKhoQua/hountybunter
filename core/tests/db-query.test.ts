import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { indexNote } from '../src/db/write.js'
import { openDb } from '../src/db/open.js'
import { escapeFts, getSession, listActivities, listNotes, listSessions, searchNotes } from '../src/db/query.js'
import { parseNote } from '../src/note/parse.js'

let db: ReturnType<typeof openDb>

function note(id: string, project: string, question: string, chosen: string, status = 'standing') {
  return parseNote(
    `---\nid: ${id}\ntitle: ${id}\nproject: ${project}\nstatus: ${status}\nquestion: ${question}\nchosen: ${chosen}\n---\n\nbody for ${id}\n`,
    `/store/${id}.md`,
  )
}

beforeEach(async () => {
  const home = await mkdtemp(join(tmpdir(), 'hb-'))
  db = openDb({ HOUNTYBUNTER_HOME: home } as NodeJS.ProcessEnv)
  indexNote(db, note('n1', 'proj-a', 'How do reps work offline?', 'TanStack Query'))
  indexNote(db, note('n2', 'proj-a', 'Which database?', 'SQLite', 'superseded'))
  indexNote(db, note('n3', 'proj-b', 'Which language for the CLI?', 'TypeScript'))
  indexNote(db, note('n4', 'proj-c', 'Which operator?', 'C++ AND kept'))
})

describe('searchNotes', () => {
  it('finds a note by a word in its question', () => {
    expect(searchNotes(db, 'offline').map((h) => h.id)).toEqual(['n1'])
  })

  it('finds a note by a word in what was chosen', () => {
    expect(searchNotes(db, 'sqlite').map((h) => h.id)).toEqual(['n2'])
  })

  it('filters by project', () => {
    expect(searchNotes(db, 'which', { project: 'proj-b' }).map((h) => h.id)).toEqual(['n3'])
  })

  it('returns an empty array for no match', () => {
    expect(searchNotes(db, 'kubernetes')).toEqual([])
  })

  it('treats FTS operators in user input as literal text, and still matches', () => {
    // Operator-shaped input must not throw and must not be parsed as operators.
    for (const q of ['a AND b', 'C++', '"', 'NEAR(a b)', '*', '', 'x'.repeat(500)]) {
      expect(() => searchNotes(db, q)).not.toThrow()
    }

    // And a literal search for operator-shaped text must actually find it —
    // the check the previous version of this test could not make.
    expect(searchNotes(db, 'C++').map((h) => h.id)).toContain('n4')
    expect(searchNotes(db, 'C++ AND kept').map((h) => h.id)).toContain('n4')
    expect(searchNotes(db, 'NEAR(a b)')).toEqual([])
  })

  it('returns a snippet containing the match', () => {
    expect(searchNotes(db, 'offline')[0]?.snippet.toLowerCase()).toContain('offline')
  })
})

describe('listNotes', () => {
  it('lists every note by default, newest id first', () => {
    expect(listNotes(db).map((h) => h.id)).toEqual(['n4', 'n3', 'n2', 'n1'])
  })

  it('filters by project', () => {
    expect(listNotes(db, { project: 'proj-a' }).map((h) => h.id)).toEqual(['n2', 'n1'])
  })

  it('filters by status', () => {
    expect(listNotes(db, { status: 'superseded' }).map((h) => h.id)).toEqual(['n2'])
  })

  it('respects a limit', () => {
    expect(listNotes(db, { limit: 1 })).toHaveLength(1)
  })
})

describe('escapeFts', () => {
  it('wraps input in quotes and doubles embedded quotes', () => {
    expect(escapeFts('a AND b')).toBe('"a AND b"')
    expect(escapeFts('say "hi"')).toBe('"say ""hi"""')
  })
})

describe('listSessions', () => {
  function session(id: string, project: string, startedAt: string | null, title: string | null) {
    db.prepare(
      `INSERT INTO sessions (id, project, started_at, title, correlation)
       VALUES (?, ?, ?, ?, 'exact')`,
    ).run(id, project, startedAt, title)
  }

  function activity(sessionId: string, seq: number) {
    db.prepare(
      `INSERT INTO activities (session_id, seq, kind) VALUES (?, ?, 'user')`,
    ).run(sessionId, seq)
  }

  beforeEach(() => {
    session('s1', 'proj-a', '2026-08-20T10:00:00.000Z', 'oldest')
    session('s2', 'proj-a', '2026-08-22T10:00:00.000Z', 'newest')
    session('s3', 'proj-b', '2026-08-21T10:00:00.000Z', null)
    activity('s1', 1)
    activity('s1', 2)
    activity('s2', 1)
  })

  it('lists sessions newest first', () => {
    expect(listSessions(db).map((s) => s.id)).toEqual(['s2', 's3', 's1'])
  })

  it('counts the activities belonging to each session', () => {
    const bySession = Object.fromEntries(listSessions(db).map((s) => [s.id, s.activities]))
    expect(bySession).toEqual({ s1: 2, s2: 1, s3: 0 })
  })

  it('filters by project', () => {
    expect(listSessions(db, { project: 'proj-b' }).map((s) => s.id)).toEqual(['s3'])
  })

  it('respects a limit', () => {
    expect(listSessions(db, { limit: 1 }).map((s) => s.id)).toEqual(['s2'])
  })

  it('sorts a session with no start time last rather than dropping it', () => {
    session('s4', 'proj-a', null, 'undated')
    expect(listSessions(db).map((s) => s.id)).toEqual(['s2', 's3', 's1', 's4'])
  })
})

describe('getSession and listActivities', () => {
  beforeEach(() => {
    db.prepare(
      `INSERT INTO sessions (id, project, started_at, title, correlation)
       VALUES ('s1', 'proj-a', '2026-08-20T10:00:00.000Z', 'a hunt', 'guessed')`,
    ).run()
    for (const seq of [3, 1, 2]) {
      db.prepare(
        `INSERT INTO activities (session_id, seq, kind, tool_name) VALUES ('s1', ?, 'assistant', ?)`,
      ).run(seq, `tool-${seq}`)
    }
  })

  it('reads one session with its activity count and correlation', () => {
    const session = getSession(db, 's1')
    expect(session?.title).toBe('a hunt')
    expect(session?.activities).toBe(3)
    expect(session?.correlation).toBe('guessed')
  })

  it('returns undefined for an id that is not there', () => {
    expect(getSession(db, 'nope')).toBeUndefined()
  })

  it('lists activities in seq order, not insertion order', () => {
    expect(listActivities(db, 's1').map((a) => a.seq)).toEqual([1, 2, 3])
  })

  it('respects a limit', () => {
    expect(listActivities(db, 's1', { limit: 2 }).map((a) => a.seq)).toEqual([1, 2])
  })

  it('returns an empty array for a session with nothing in it', () => {
    expect(listActivities(db, 'nope')).toEqual([])
  })
})
