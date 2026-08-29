import { appendFile, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { openDb } from '@hountybunter/core'
import { readNewLines, saveCursor } from '../src/cursor.js'

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
    const result = await readNewLines(db, file)
    saveCursor(db, file, result.to, NOW)
    expect(result.lines).toEqual(['a', 'b'])
    expect(result.from).toBe(0)
  })

  it('reads nothing on a second pass over an unchanged file', async () => {
    await writeFile(file, 'a\nb\n')
    const first = await readNewLines(db, file)
    saveCursor(db, file, first.to, NOW)
    expect((await readNewLines(db, file)).lines).toEqual([])
  })

  it('reads only the appended lines', async () => {
    await writeFile(file, 'a\n')
    const first = await readNewLines(db, file)
    saveCursor(db, file, first.to, NOW)
    await appendFile(file, 'b\nc\n')
    expect((await readNewLines(db, file)).lines).toEqual(['b', 'c'])
  })

  it('restarts from zero if the file shrank', async () => {
    await writeFile(file, 'a\nb\nc\n')
    const first = await readNewLines(db, file)
    saveCursor(db, file, first.to, NOW)
    await writeFile(file, 'x\n')
    expect((await readNewLines(db, file)).lines).toEqual(['x'])
  })

  it('does not consume a trailing partial line', async () => {
    await writeFile(file, 'a\nb\npartial')
    const first = await readNewLines(db, file)
    saveCursor(db, file, first.to, NOW)
    expect(first.lines).toEqual(['a', 'b'])
    await appendFile(file, '-now-complete\n')
    expect((await readNewLines(db, file)).lines).toEqual(['partial-now-complete'])
  })

  it('returns nothing for a file that does not exist', async () => {
    expect((await readNewLines(db, join(file, 'nope'))).lines).toEqual([])
  })
})
