import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { indexNote } from '../src/db/write.js'
import { openDb } from '../src/db/open.js'
import { escapeFts, listNotes, searchNotes } from '../src/db/query.js'
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

  it('treats FTS operators in user input as literal text', () => {
    expect(() => searchNotes(db, 'a AND')).not.toThrow()
    expect(() => searchNotes(db, 'C++')).not.toThrow()
    expect(() => searchNotes(db, '"')).not.toThrow()
  })

  it('returns a snippet containing the match', () => {
    expect(searchNotes(db, 'offline')[0]?.snippet.toLowerCase()).toContain('offline')
  })
})

describe('listNotes', () => {
  it('lists every note by default, newest id first', () => {
    expect(listNotes(db).map((h) => h.id)).toEqual(['n3', 'n2', 'n1'])
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
