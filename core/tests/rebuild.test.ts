import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { clearSessionIndex } from '../src/db/write.js'
import { openDb } from '../src/db/open.js'
import { dbPath } from '../src/paths.js'
import { NoteParseError } from '../src/note/parse.js'
import { RegistrationParseError } from '../src/project/parse.js'
import { NOT_SNAPSHOTTED, SNAPSHOT, rebuildFromDisk, snapshotState } from '../src/rebuild.js'

let env: NodeJS.ProcessEnv
let home: string

async function seedNote(id: string, project: string, extra = '') {
  const dir = join(home, 'notes', project)
  await mkdir(dir, { recursive: true })
  await writeFile(
    join(dir, `${id}.md`),
    `---\nid: ${id}\ntitle: ${id}\nproject: ${project}\nquestion: q for ${id}\nchosen: c for ${id}\n${extra}---\n\nbody ${id}\n`,
  )
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'hb-'))
  env = { HOUNTYBUNTER_HOME: home } as NodeJS.ProcessEnv
})

describe('rebuildFromDisk', () => {
  it('indexes every note found on disk', async () => {
    await seedNote('n1', 'proj-a')
    await seedNote('n2', 'proj-a')
    await seedNote('n3', 'proj-b')
    const report = await rebuildFromDisk(env)
    expect(report.notesIndexed).toBe(3)
    expect(report.errors).toEqual([])
  })

  it('reports a malformed note without aborting the rebuild', async () => {
    await seedNote('n1', 'proj-a')
    await writeFile(join(home, 'notes', 'proj-a', 'bad.md'), '---\nchosen: only\n---\n\nx\n')
    const report = await rebuildFromDisk(env)
    expect(report.notesIndexed).toBe(1)
    expect(report.errors).toHaveLength(1)
  })

  it('reports a malformed registration as a RegistrationParseError, not a NoteParseError', async () => {
    await mkdir(join(home, 'notes', 'proj-a'), { recursive: true })
    await writeFile(join(home, 'notes', 'proj-a', 'bad.md'), '---\nchosen: only\n---\n\nx\n')
    await mkdir(join(home, 'projects'), { recursive: true })
    await writeFile(join(home, 'projects', 'bad.md'), '---\nname: no slug here\n---\n\nx\n')

    const report = await rebuildFromDisk(env)

    expect(report.errors).toHaveLength(2)
    const noteErrors = report.errors.filter((e) => e instanceof NoteParseError)
    const registrationErrors = report.errors.filter((e) => e instanceof RegistrationParseError)
    expect(noteErrors).toHaveLength(1)
    expect(registrationErrors).toHaveLength(1)
  })

  // The keystone.
  it('produces identical state after the database is deleted and rebuilt', async () => {
    await seedNote('n1', 'proj-a', 'evidence:\n  - kind: file\n    ref: src/a.ts\n')
    await seedNote('n2', 'proj-b', 'rejected:\n  - option: Redis\n    why_not: overkill\n')

    await rebuildFromDisk(env)
    const first = snapshotState(openDb(env))

    await rm(dbPath(env), { force: true })
    await rm(`${dbPath(env)}-wal`, { force: true })
    await rm(`${dbPath(env)}-shm`, { force: true })

    await rebuildFromDisk(env)
    const second = snapshotState(openDb(env))

    expect(second).toBe(first)
  })

  it('is idempotent when run twice without deleting the database', async () => {
    await seedNote('n1', 'proj-a')
    await rebuildFromDisk(env)
    const first = snapshotState(openDb(env))
    await rebuildFromDisk(env)
    expect(snapshotState(openDb(env))).toBe(first)
  })

  it('drops notes whose files were deleted from disk', async () => {
    await seedNote('n1', 'proj-a')
    await seedNote('n2', 'proj-a')
    await rebuildFromDisk(env)

    await rm(join(home, 'notes', 'proj-a', 'n2.md'))
    const report = await rebuildFromDisk(env)
    expect(report.notesIndexed).toBe(1)

    const db = openDb(env)
    expect(db.prepare('SELECT COUNT(*) c FROM notes').get()).toEqual({ c: 1 })
    db.close()
  })

  it('counts only notes actually indexed', async () => {
    await seedNote('n1', 'proj-a')
    await seedNote('n2', 'proj-a')
    // No forced-failure case here: nothing reachable through parseNote can make
    // indexNote throw, so there is no way to drive the catch branch in
    // rebuildFromDisk from a note file. This test guards the counting logic
    // itself (notesIndexed reflects successes, not files seen) rather than that
    // branch.
    const report = await rebuildFromDisk(env)
    expect(report.notesIndexed).toBe(2)
    expect(report.errors).toEqual([])
  })

  it('notices when a note file moved, even with identical frontmatter', async () => {
    await seedNote('n1', 'proj-a')
    await rebuildFromDisk(env)
    const before = snapshotState(openDb(env))

    // Same note, same frontmatter, different file location. Only `path` differs.
    await mkdir(join(home, 'notes', 'proj-c'), { recursive: true })
    await rename(
      join(home, 'notes', 'proj-a', 'n1.md'),
      join(home, 'notes', 'proj-c', 'n1.md'),
    )

    await rebuildFromDisk(env)
    const after = snapshotState(openDb(env))

    expect(after).not.toBe(before)
  })
})

describe('the snapshot covers the whole index', () => {
  it('accounts for every column of every table, one way or the other', () => {
    // `--verify` compares two rebuilds by comparing their snapshots, so a
    // column the snapshot does not read is a column two rebuilds can disagree
    // about while reporting identical state. That has happened twice already:
    // the keystone test once omitted notes.path, and sessions.parent_id
    // shipped this morning without being added here.
    //
    // Nothing is allowed to be merely forgotten. Every column is either in the
    // snapshot, or in NOT_SNAPSHOTTED with a reason someone had to type.
    const db = openDb(env)
    try {
      const tables = (
        db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
          name: string
        }[]
      ).map((row) => row.name)

      const unaccounted: string[] = []
      for (const table of tables) {
        if (NOT_SNAPSHOTTED[table]) continue
        if (!SNAPSHOT[table]) {
          unaccounted.push(table)
          continue
        }
        const columns = (
          db.prepare('SELECT name FROM pragma_table_info(?)').all(table) as { name: string }[]
        ).map((row) => row.name)
        for (const column of columns) {
          if (SNAPSHOT[table]!.columns.includes(column)) continue
          if (NOT_SNAPSHOTTED[`${table}.${column}`]) continue
          unaccounted.push(`${table}.${column}`)
        }
      }

      expect(unaccounted).toEqual([])
    } finally {
      db.close()
    }
  })

  it('gives a reason for everything it leaves out', () => {
    // The reason is the point. An empty string would turn this into a list of
    // names to append to, which is the forgetting it exists to prevent.
    for (const [what, why] of Object.entries(NOT_SNAPSHOTTED)) {
      expect(why.length, `${what} needs a reason, not a placeholder`).toBeGreaterThan(20)
    }
  })

  it('reads only columns that exist', () => {
    // The other direction: a renamed or dropped column would leave the
    // snapshot selecting something gone, and fail at query time instead.
    const db = openDb(env)
    try {
      for (const [table, spec] of Object.entries(SNAPSHOT)) {
        const columns = (
          db.prepare('SELECT name FROM pragma_table_info(?)').all(table) as { name: string }[]
        ).map((row) => row.name)
        for (const column of spec.columns) {
          expect(columns, `${table}.${column}`).toContain(column)
        }
      }
    } finally {
      db.close()
    }
  })
})

describe('snapshotState', () => {
  it('covers where sessions ran, not only that they ran', async () => {
    // A column absent from the snapshot makes `--verify` blind to it: two
    // rebuilds that disagree about it still compare identical, which is how a
    // keystone test comes to prove less than it claims.
    const db = openDb(env)
    try {
      db.prepare(
        "INSERT INTO projects (path, slug, name, last_seen_at) VALUES ('/w/proj', 'p', 'proj', 'then')",
      ).run()
    } finally {
      // snapshotState closes the handle it is given.
    }
    expect(snapshotState(db)).toContain('/w/proj')
  })
})

describe('clearSessionIndex', () => {
  it('drops sessions, activities and their cursors together', async () => {
    const db = openDb(env)
    try {
      db.prepare("INSERT INTO sessions (id, project, harness) VALUES ('s1', 'p', 'claude-code')").run()
      db.prepare(
        "INSERT INTO projects (path, slug, name) VALUES ('/w/proj', 'p', 'proj')",
      ).run()
      db.prepare("INSERT INTO activities (session_id, seq, kind) VALUES ('s1', 1, 'user')").run()
      db.prepare(
        "INSERT INTO ingest_cursors (file_path, byte_offset, last_seen_at) VALUES ('/f', 10, 'now')",
      ).run()

      clearSessionIndex(db)

      const count = (t: string) => (db.prepare(`SELECT COUNT(*) c FROM ${t}`).get() as { c: number }).c
      // All three or none: a cursor kept without its rows skips those lines
      // forever, and rows kept without their cursor come back duplicated.
      expect([
        count('sessions'),
        count('activities'),
        count('ingest_cursors'),
        // Derived from the same transcripts, so it belongs to the same half.
        // Left behind, it would name a directory no surviving session ran in.
        count('projects'),
      ]).toEqual([0, 0, 0, 0])
    } finally {
      db.close()
    }
  })

  it('leaves notes alone', async () => {
    const db = openDb(env)
    try {
      db.prepare(
        `INSERT INTO notes (id, project, path, title, kind, status, hash)
         VALUES ('n1', 'p', '/n1.md', 't', 'decision', 'standing', 'h')`,
      ).run()
      clearSessionIndex(db)
      expect((db.prepare('SELECT COUNT(*) c FROM notes').get() as { c: number }).c).toBe(1)
    } finally {
      db.close()
    }
  })
})
