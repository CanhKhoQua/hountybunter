import { mkdtemp, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDb, portFile } from '@hountybunter/core'
import { handle } from '../src/server/routes.js'
import { serve } from '../src/server/serve.js'

let env: NodeJS.ProcessEnv
let home: string
let server: Awaited<ReturnType<typeof serve>> | null = null

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'hb-hook-'))
  env = { HOUNTYBUNTER_HOME: home } as NodeJS.ProcessEnv
})

afterEach(() => {
  server?.close()
  server = null
})

const event = {
  hook_event_name: 'SessionStart',
  session_id: 'sess-1',
  cwd: '/Users/x/myproject',
  timestamp: '2026-09-01T10:00:00.000Z',
}

describe('POST /hook', () => {
  it('answers 204 with nothing in the body', async () => {
    const res = await handle('POST', '/hook', event, env)
    expect(res.status).toBe(204)
    expect(res.body).toBeUndefined()
  })

  it('records the event it was given', async () => {
    await handle('POST', '/hook', event, env)
    const db = openDb(env)
    try {
      expect(db.prepare('SELECT COUNT(*) n FROM hook_events').get()).toEqual({ n: 1 })
    } finally {
      db.close()
    }
  })

  it('rejects an event with no session id, without throwing', async () => {
    const res = await handle('POST', '/hook', { hook_event_name: 'Stop' }, env)
    expect(res.status).toBe(400)
    expect(String(res.body.error)).toMatch(/session_id/)
  })

  it('answers 400 for a body that is not JSON at all, over a real socket', async () => {
    server = await serve({ port: 0, env })
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

    const res = await fetch(`${base}/hook`, { method: 'POST', body: 'not json{' })
    expect(res.status).toBe(400)
  })
})

describe('the port file', () => {
  it('publishes the port actually bound, not the one requested', async () => {
    server = await serve({ port: 0, env })
    const bound = (server.address() as AddressInfo).port

    expect(Number(await readFile(portFile(env), 'utf8'))).toBe(bound)
    expect(bound).not.toBe(0)
  })

  it('removes the file on close, so nothing points at a dead server', async () => {
    server = await serve({ port: 0, env })
    expect(existsSync(portFile(env))).toBe(true)

    await new Promise<void>((resolve) => server!.close(() => resolve()))
    server = null

    expect(existsSync(portFile(env))).toBe(false)
  })
})
