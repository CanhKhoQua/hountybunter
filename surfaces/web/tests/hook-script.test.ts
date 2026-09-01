import { spawn } from 'node:child_process'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDb, portFile, spoolFile } from '@hountybunter/core'
import { serve } from '../src/server/serve.js'

const SCRIPT = new URL('../../../.claude-plugin/hooks/post-event.sh', import.meta.url).pathname

let env: NodeJS.ProcessEnv
let home: string
let server: Awaited<ReturnType<typeof serve>> | null = null

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'hb-script-'))
  env = { HOUNTYBUNTER_HOME: home } as NodeJS.ProcessEnv
})

afterEach(() => {
  server?.close()
  server = null
})

const payload = JSON.stringify({
  hook_event_name: 'PostToolUse',
  session_id: 'sess-42',
  cwd: '/Users/x/myproject',
  timestamp: '2026-09-01T10:00:00.000Z',
})

/** Runs the hook the way Claude Code will: JSON on stdin, nothing else. */
function runHook(): Promise<{ code: number | null; ms: number }> {
  const started = Date.now()
  return new Promise((resolve) => {
    const child = spawn('sh', [SCRIPT], { env: { ...process.env, ...env } })
    child.stdin.write(payload)
    child.stdin.end()
    child.on('exit', (code) => resolve({ code, ms: Date.now() - started }))
  })
}

describe('the hook script', () => {
  it('delivers the event when the server is up', async () => {
    server = await serve({ port: 0, env })
    const { code } = await runHook()
    expect(code).toBe(0)

    const db = openDb(env)
    try {
      const row = db.prepare('SELECT session_id FROM hook_events').get() as { session_id: string }
      expect(row?.session_id).toBe('sess-42')
    } finally {
      db.close()
    }
  })

  it('exits 0 and spools when nothing is listening', async () => {
    // No server at all: the common case the moment the tool is not running.
    const { code } = await runHook()
    expect(code).toBe(0)

    const spooled = await readFile(spoolFile(env), 'utf8')
    expect(JSON.parse(spooled.trim()).session_id).toBe('sess-42')
  })

  it('exits 0 when the port file is garbage', async () => {
    await writeFile(portFile(env), 'not-a-port\n', 'utf8')
    const { code } = await runHook()
    expect(code).toBe(0)
    expect(existsSync(spoolFile(env))).toBe(true)
  })

  it('exits 0 when the port file points at a closed port', async () => {
    await writeFile(portFile(env), '9', 'utf8')
    const { code } = await runHook()
    expect(code).toBe(0)
  })

  it('returns fast enough that a session would not notice', async () => {
    // A hook that hangs is worse than one that loses an event: the session pays.
    await writeFile(portFile(env), '9', 'utf8')
    const { ms } = await runHook()
    expect(ms).toBeLessThan(2500)
  }, 10000)

  it('writes one spool line per event, so a replay can count them', async () => {
    await runHook()
    await runHook()
    const lines = (await readFile(spoolFile(env), 'utf8')).trim().split('\n')
    expect(lines).toHaveLength(2)
    expect(lines.every((l) => JSON.parse(l).session_id === 'sess-42')).toBe(true)
  })
})
