import { appendFile, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { openDb } from '@hountybunter/core'
import { readNewLines } from '../src/cursor.js'

let db: ReturnType<typeof openDb>
let file: string
const NOW = '2026-08-27T00:00:00.000Z'

beforeEach(async () => {
  const home = await mkdtemp(join(tmpdir(), 'hb-'))
  db = openDb({ HOUNTYBUNTER_HOME: home } as NodeJS.ProcessEnv)
  file = join(home, 'transcript.jsonl')
})

describe('readNewLines', () => {
  it('reads everything on the first pass', async () => {
    await writeFile(file, 'a\nb\n')
    const result = await readNewLines(db, file, NOW)
    expect(result.lines).toEqual(['a', 'b'])
    expect(result.from).toBe(0)
  })

  it('reads nothing on a second pass over an unchanged file', async () => {
    await writeFile(file, 'a\nb\n')
    await readNewLines(db, file, NOW)
    expect((await readNewLines(db, file, NOW)).lines).toEqual([])
  })

  it('reads only the appended lines', async () => {
    await writeFile(file, 'a\n')
    await readNewLines(db, file, NOW)
    await appendFile(file, 'b\nc\n')
    expect((await readNewLines(db, file, NOW)).lines).toEqual(['b', 'c'])
  })

  it('restarts from zero if the file shrank', async () => {
    await writeFile(file, 'a\nb\nc\n')
    await readNewLines(db, file, NOW)
    await writeFile(file, 'x\n')
    expect((await readNewLines(db, file, NOW)).lines).toEqual(['x'])
  })

  it('does not consume a trailing partial line', async () => {
    await writeFile(file, 'a\nb\npartial')
    expect((await readNewLines(db, file, NOW)).lines).toEqual(['a', 'b'])
    await appendFile(file, '-now-complete\n')
    expect((await readNewLines(db, file, NOW)).lines).toEqual(['partial-now-complete'])
  })

  it('returns nothing for a file that does not exist', async () => {
    expect((await readNewLines(db, join(file, 'nope'), NOW)).lines).toEqual([])
  })
})
