import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { openDb } from '../src/db/open.js'
import { receiveHookEvent } from '../src/hooks/receive.js'
import { replaySpool } from '../src/hooks/spool.js'
import { spoolFile } from '../src/paths.js'

let env: NodeJS.ProcessEnv
let db: ReturnType<typeof openDb>

beforeEach(async () => {
  const home = await mkdtemp(join(tmpdir(), 'hb-spool-'))
  env = { HOUNTYBUNTER_HOME: home } as NodeJS.ProcessEnv
  db = openDb(env)
})

const event = (id: string) =>
  JSON.stringify({
    hook_event_name: 'PostToolUse',
    session_id: id,
    cwd: '/Users/x/myproject',
    timestamp: '2026-09-01T10:00:00.000Z',
  })

async function spool(...lines: string[]) {
  await writeFile(spoolFile(env), lines.join('\n') + '\n', 'utf8')
}

function eventCount() {
  return (db.prepare('SELECT COUNT(*) n FROM hook_events').get() as { n: number }).n
}

describe('replaySpool', () => {
  it('brings in what arrived while nothing was listening', async () => {
    await spool(event('a'), event('b'))
    const report = await replaySpool(db, env)

    expect(report.replayed).toBe(2)
    expect(eventCount()).toBe(2)
  })

  it('empties the spool once the events are safely in', async () => {
    await spool(event('a'))
    await replaySpool(db, env)
    expect((await readFile(spoolFile(env), 'utf8')).trim()).toBe('')
  })

  it('replays twice without doubling anything', async () => {
    await spool(event('a'), event('a'))
    await replaySpool(db, env)
    await spool(event('a'))
    await replaySpool(db, env)

    expect(eventCount()).toBe(1)
  })

  it('does not double-count an event that was also delivered live', async () => {
    receiveHookEvent(db, JSON.parse(event('a')))
    await spool(event('a'))
    await replaySpool(db, env)

    expect(eventCount()).toBe(1)
  })

  it('skips a corrupt line and counts it, instead of losing the good ones', async () => {
    await spool(event('a'), '{not json', event('b'))
    const report = await replaySpool(db, env)

    expect(report.replayed).toBe(2)
    expect(report.skipped).toBe(1)
    expect(eventCount()).toBe(2)
  })

  it('is quiet and harmless when there is no spool at all', async () => {
    const report = await replaySpool(db, env)
    expect(report).toEqual({ replayed: 0, skipped: 0 })
  })

  it('keeps events it could not accept out of the store, and counts them', async () => {
    await spool(JSON.stringify({ hook_event_name: 'Stop' }), event('a'))
    const report = await replaySpool(db, env)

    expect(report.replayed).toBe(1)
    expect(report.skipped).toBe(1)
    expect(eventCount()).toBe(1)
  })
})
