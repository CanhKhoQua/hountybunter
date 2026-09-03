import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { indexNote } from '../src/db/write.js'
import { openDb } from '../src/db/open.js'
import {
  countActivities,
  countNotes,
  countRegions,
  countSessions,
  escapeFts,
  getSession,
  listActivities,
  listNotes,
  listRegions,
  listSessions,
  searchNotes,
} from '../src/db/query.js'
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

  it('walks the list a page at a time, in the same order', () => {
    expect(listNotes(db, { limit: 2, offset: 0 }).map((h) => h.id)).toEqual(['n4', 'n3'])
    expect(listNotes(db, { limit: 2, offset: 2 }).map((h) => h.id)).toEqual(['n2', 'n1'])
    expect(listNotes(db, { limit: 2, offset: 99 })).toEqual([])
  })

  it('counts every note a page could be taken from, filters included', () => {
    expect(countNotes(db)).toBe(4)
    expect(countNotes(db, { project: 'proj-a' })).toBe(2)
    expect(countNotes(db, { status: 'superseded' })).toBe(1)
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

  it('walks the list a page at a time, in the same order', () => {
    // The window has to move without reordering, or page two shows rows page
    // one already did.
    expect(listSessions(db, { limit: 2, offset: 0 }).map((s) => s.id)).toEqual(['s2', 's3'])
    expect(listSessions(db, { limit: 2, offset: 2 }).map((s) => s.id)).toEqual(['s1'])
    expect(listSessions(db, { limit: 2, offset: 99 })).toEqual([])
  })

  it('counts every session a page could be taken from', () => {
    // The count is what tells a reader a page is a page. It has to answer for
    // the same rows the list would return, so it carries the same filters —
    // including the one that keeps subagent runs out.
    expect(countSessions(db)).toBe(3)
    expect(countSessions(db, { project: 'proj-b' })).toBe(1)
  })

  it('counts around the limit, not within it', () => {
    // A limited page still has to report the size of the whole list, or the
    // reader is told there is nothing more when there is.
    expect(countSessions(db)).toBe(listSessions(db, { limit: 1000 }).length)
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

  it('walks a long transcript a page at a time, still in seq order', () => {
    expect(listActivities(db, 's1', { limit: 2, offset: 2 }).map((a) => a.seq)).toEqual([3])
    expect(listActivities(db, 's1', { limit: 2, offset: 9 })).toEqual([])
  })

  it('counts every activity in the session, past whatever a page holds', () => {
    // The one that mattered: a session of thousands was served its first 500
    // and said nothing, directly under a row reporting the true total.
    expect(countActivities(db, 's1')).toBe(3)
    expect(countActivities(db, 'nope')).toBe(0)
  })

  it('returns an empty array for a session with nothing in it', () => {
    expect(listActivities(db, 'nope')).toEqual([])
  })
})

describe('listRegions with a known directory', () => {
  it('carries the real path, so a region can be worked in and not only read', () => {
    db.prepare(
      `INSERT INTO sessions (id, project, started_at, correlation)
       VALUES ('s1', 'proj-a', '2026-08-20T10:00:00.000Z', 'exact')`,
    ).run()
    db.prepare(
      `INSERT INTO projects (path, slug, name, last_seen_at)
       VALUES ('/w/alpha', 'proj-a', 'alpha', '2026-08-20T11:00:00.000Z')`,
    ).run()

    const alpha = listRegions(db, { today: '2026-09-02' }).find((r) => r.project === 'proj-a')
    expect(alpha).toMatchObject({
      path: '/w/alpha',
      name: 'alpha',
      lastSeenAt: '2026-08-20T11:00:00.000Z',
    })
  })

  it('leaves a region no transcript has placed without a path', () => {
    // A note can name a project that was never ingested. Inventing a directory
    // for it would offer to start a session somewhere nobody has ever worked.
    expect(listRegions(db, { today: '2026-09-02' }).find((r) => r.project === 'proj-c')?.path).toBe(null)
  })
})

describe('listRegions', () => {
  it('counts sessions and notes per project, busiest first', () => {
    db.prepare(
      `INSERT INTO sessions (id, project, started_at, correlation)
       VALUES ('s1', 'proj-a', '2026-08-20T10:00:00.000Z', 'exact'),
              ('s2', 'proj-a', '2026-08-21T10:00:00.000Z', 'exact'),
              ('s3', 'proj-b', '2026-08-22T10:00:00.000Z', 'exact')`,
    ).run()

    expect(listRegions(db, { today: '2026-09-02' })).toEqual([
      { project: 'proj-a', sessions: 2, notes: 2, path: null, name: null, lastSeenAt: null, stale: 0 },
      { project: 'proj-b', sessions: 1, notes: 1, path: null, name: null, lastSeenAt: null, stale: 0 },
      { project: 'proj-c', sessions: 0, notes: 1, path: null, name: null, lastSeenAt: null, stale: 0 },
    ])
  })

  it('counts the stale notes in each region, so fog can thicken with the ratio', () => {
    // n1 belongs to proj-a in this file's fixture. Give it a row to move.
    db.prepare(
      `INSERT OR IGNORE INTO note_evidence (note_id, kind, ref) VALUES ('n1', 'file', 'a.ts')`,
    ).run()
    db.prepare(`UPDATE note_evidence SET state = 'missing' WHERE note_id = 'n1'`).run()

    const byProject = Object.fromEntries(listRegions(db, { today: '2026-09-02' }).map((r) => [r.project, r.stale]))
    expect(byProject['proj-a']).toBe(1)
    expect(byProject['proj-b']).toBe(0)
  })

  it('counts a note whose review date has passed as stale, even with no evidence state to blame', () => {
    // n2 belongs to proj-a and has no note_evidence rows at all — the review
    // date is the only thing that could make it stale.
    db.prepare(`UPDATE notes SET review_after = '2026-09-01' WHERE id = 'n2'`).run()

    const byProject = Object.fromEntries(
      listRegions(db, { today: '2026-09-02' }).map((r) => [r.project, r.stale]),
    )
    expect(byProject['proj-a']).toBe(1)
  })

  it('includes a project that has notes but no session yet', () => {
    expect(listRegions(db, { today: '2026-09-02' }).map((r) => r.project)).toContain('proj-c')
  })

  it('walks the list a page at a time, in the same order', () => {
    expect(listRegions(db, { limit: 2, offset: 0, today: '2026-09-02' }).map((r) => r.project)).toEqual([
      'proj-a',
      'proj-b',
    ])
    expect(listRegions(db, { limit: 2, offset: 2, today: '2026-09-02' }).map((r) => r.project)).toEqual(['proj-c'])
  })

  it('counts the regions a page could be taken from', () => {
    // Regions are a union of two tables, so the count cannot be a row count of
    // either one on its own.
    expect(countRegions(db)).toBe(3)
  })

  it('lists every region when no page is asked for', () => {
    // The default has to stay unlimited: the CLI and the region grid both read
    // the whole list, and a silent cap here is the bug this work is about.
    expect(listRegions(db, { today: '2026-09-02' })).toHaveLength(countRegions(db))
  })
})
