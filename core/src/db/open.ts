import Database from 'better-sqlite3'
import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dbPath } from '../paths.js'

export const SCHEMA_VERSION = 1

const here = dirname(fileURLToPath(import.meta.url))

export function openDb(env: NodeJS.ProcessEnv = process.env): Database.Database {
  const path = dbPath(env)
  mkdirSync(dirname(path), { recursive: true })
  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(readFileSync(join(here, 'schema.sql'), 'utf8'))
  db.pragma(`user_version = ${SCHEMA_VERSION}`)
  return db
}
