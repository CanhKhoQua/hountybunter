import { mkdir, mkdtemp, realpath, symlink, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { openDb, receiveHookEvent } from '@hountybunter/core'
import { bindHunt, latestHookId } from '../src/bind.js'

let db: ReturnType<typeof openDb>
let env: NodeJS.ProcessEnv
let live: string

const CWD = '/Users/x/myproject'
const STARTED = '2026-09-01T10:00:00.000Z'

beforeEach(async () => {
  const home = await mkdtemp(join(tmpdir(), 'hb-bind-'))
  live = await mkdtemp(join(tmpdir(), 'hb-live-'))
  env = { HOUNTYBUNTER_HOME: home, HOUNTYBUNTER_TRANSCRIPTS: live } as NodeJS.ProcessEnv
  db = openDb(env)
})

function hook(sessionId: string, cwd: string) {
  receiveHookEvent(db, { hook_event_name: 'SessionStart', session_id: sessionId, cwd })
}

/**
 * A transcript as Claude Code actually writes one. The cwd is NOT on the first
 * line: every one of the 185 transcripts on the machine this was written on
 * opens with a `queue-operation` record that carries no cwd at all, and the
 * first record that does is further down. A fixture that puts it on line one
 * describes a file Claude Code has never produced.
 */
async function transcript(dir: string, sessionId: string, cwd: string, mtime: Date) {
  await mkdir(join(live, dir), { recursive: true })
  const path = join(live, dir, `${sessionId}.jsonl`)
  const lines = [
    { type: 'queue-operation', operation: 'enqueue', sessionId, timestamp: STARTED },
    { type: 'file-history-snapshot', messageId: 'm1', snapshot: {} },
    { type: 'user', cwd, timestamp: STARTED },
  ]
  await writeFile(path, lines.map((line) => JSON.stringify(line)).join('\n') + '\n')
  await utimes(path, mtime, mtime)
}

const after = (ms: number) => new Date(Date.parse(STARTED) + ms)

describe('bindHunt', () => {
  it('binds the session a matching hook named, and calls it exact', async () => {
    const since = latestHookId(db)
    hook('sess-hooked', CWD)
    expect(await bindHunt(db, { cwd: CWD, sinceHookId: since, startedAt: STARTED }, env)).toEqual({
      sessionId: 'sess-hooked',
      correlation: 'exact',
    })
  })

  it('never binds a hook from a different directory', async () => {
    const since = latestHookId(db)
    hook('sess-elsewhere', '/Users/x/other')
    expect(await bindHunt(db, { cwd: CWD, sinceHookId: since, startedAt: STARTED }, env)).toBe(null)
  })

  it('ignores a hook that arrived before this hunt started', async () => {
    // Another session in the same directory, already running. Binding to it
    // would attribute this hunt's work to someone else's session.
    hook('sess-earlier', CWD)
    const since = latestHookId(db)
    expect(await bindHunt(db, { cwd: CWD, sinceHookId: since, startedAt: STARTED }, env)).toBe(null)
  })

  it('falls back to the newest transcript in that directory, and says guessed', async () => {
    const since = latestHookId(db)
    await transcript('-Users-x-myproject', 'sess-older', CWD, after(1000))
    await transcript('-Users-x-myproject', 'sess-newer', CWD, after(5000))
    expect(await bindHunt(db, { cwd: CWD, sinceHookId: since, startedAt: STARTED }, env)).toEqual({
      sessionId: 'sess-newer',
      correlation: 'guessed',
    })
  })

  it('does not guess from a transcript belonging to another directory', async () => {
    const since = latestHookId(db)
    await transcript('-Users-x-other', 'sess-other', '/Users/x/other', after(5000))
    expect(await bindHunt(db, { cwd: CWD, sinceHookId: since, startedAt: STARTED }, env)).toBe(null)
  })

  it('does not guess from a transcript that predates the hunt', async () => {
    const since = latestHookId(db)
    await transcript('-Users-x-myproject', 'sess-stale', CWD, new Date(Date.parse(STARTED) - 60_000))
    expect(await bindHunt(db, { cwd: CWD, sinceHookId: since, startedAt: STARTED }, env)).toBe(null)
  })

  it('prefers the hook over the guess when both are available', async () => {
    const since = latestHookId(db)
    await transcript('-Users-x-myproject', 'sess-guess', CWD, after(5000))
    hook('sess-hooked', CWD)
    expect(await bindHunt(db, { cwd: CWD, sinceHookId: since, startedAt: STARTED }, env)).toEqual({
      sessionId: 'sess-hooked',
      correlation: 'exact',
    })
  })

  it('upgrades a guess to exact when the hook arrives late', async () => {
    // Hooks are fire-and-forget and can lose a race with the first paint. A
    // binding is re-resolved rather than frozen at spawn, so a late hook
    // replaces the guess instead of leaving a guess standing forever.
    const since = latestHookId(db)
    await transcript('-Users-x-myproject', 'sess-guess', CWD, after(5000))
    const first = await bindHunt(db, { cwd: CWD, sinceHookId: since, startedAt: STARTED }, env)
    expect(first?.correlation).toBe('guessed')

    hook('sess-hooked', CWD)
    const second = await bindHunt(db, { cwd: CWD, sinceHookId: since, startedAt: STARTED }, env)
    expect(second).toEqual({ sessionId: 'sess-hooked', correlation: 'exact' })
  })

  it('never guesses a Task-tool run, however recent', async () => {
    // A hunt spawns a top-level `claude`, so its transcript is never a
    // subagent file. Against the real archive the newest file in a directory
    // was a subagent run 80 times out of 265, and binding a hunt to one shows
    // the user a session they did not start.
    const since = latestHookId(db)
    await transcript('-Users-x-myproject', 'sess-real', CWD, after(1000))
    await transcript('-Users-x-myproject/sess-real/subagents', 'agent-abc', CWD, after(9000))

    expect(await bindHunt(db, { cwd: CWD, sinceHookId: since, startedAt: STARTED }, env)).toEqual({
      sessionId: 'sess-real',
      correlation: 'guessed',
    })
  })

  it('binds through a symlinked path', async () => {
    // On macOS a temp directory is reached as /var/folders/… but reported by
    // the agent as /private/var/folders/…. Comparing the two strings never
    // matches, so every hunt started under /tmp would silently read as
    // unbound — which looks exactly like "no hooks installed".
    const real = await mkdtemp(join(tmpdir(), 'hb-real-'))
    const link = join(await mkdtemp(join(tmpdir(), 'hb-link-')), 'work')
    await symlink(real, link)

    const since = latestHookId(db)
    hook('sess-symlinked', await realpath(real))
    expect(await bindHunt(db, { cwd: link, sinceHookId: since, startedAt: STARTED }, env)).toEqual({
      sessionId: 'sess-symlinked',
      correlation: 'exact',
    })
  })

  it('binds nothing when there is nothing to bind', async () => {
    const since = latestHookId(db)
    expect(await bindHunt(db, { cwd: CWD, sinceHookId: since, startedAt: STARTED }, env)).toBe(null)
  })
})
