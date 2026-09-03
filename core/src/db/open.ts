import Database from 'better-sqlite3'
import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dbPath } from '../paths.js'

export const SCHEMA_VERSION = 4

export class SchemaVersionError extends Error {
  constructor(
    readonly found: number,
    readonly expected: number,
    readonly path: string,
  ) {
    super(
      `database at ${path} has schema version ${found}, but this build expects ` +
        `${expected}. The index is derived data: delete it and rebuild.`,
    )
    this.name = 'SchemaVersionError'
  }
}

const here = dirname(fileURLToPath(import.meta.url))

export function openDb(env: NodeJS.ProcessEnv = process.env): Database.Database {
  const path = dbPath(env)
  mkdirSync(dirname(path), { recursive: true })
  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  // Read before writing. A fresh database reports 0; anything else that is not
  // our version was written by a different build and must not be silently
  // re-stamped as if it had been migrated.
  const found = Number(db.pragma('user_version', { simple: true }))
  if (found !== 0 && found !== SCHEMA_VERSION) {
    db.close()
    throw new SchemaVersionError(found, SCHEMA_VERSION, path)
  }

  db.exec(readFileSync(join(here, 'schema.sql'), 'utf8'))
  db.pragma(`user_version = ${SCHEMA_VERSION}`)
  return db
}
