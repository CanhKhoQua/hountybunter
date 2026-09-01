import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { handle } from '../src/server/routes.js'
import { HuntRegistry } from '../src/server/hunts.js'

let env: NodeJS.ProcessEnv
let hunts: HuntRegistry
let cwd: string

beforeEach(async () => {
  const home = await mkdtemp(join(tmpdir(), 'hb-'))
  cwd = await mkdtemp(join(tmpdir(), 'hb-work-'))
  // A shell standing in for the agent binary, so these tests exercise the
  // route rather than Claude Code.
  env = {
    HOUNTYBUNTER_HOME: home,
    HOUNTYBUNTER_AGENT_CMD: '/bin/sh',
  } as NodeJS.ProcessEnv
  hunts = new HuntRegistry({ max: 2 })
})
afterEach(() => hunts.killAll())

async function until(predicate: () => boolean, what: string, ms = 3000): Promise<void> {
  const deadline = Date.now() + ms
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 10))
  }
}

const start = (body: unknown = { cwd }) => handle('POST', '/api/hunts', body, env, hunts)

describe('POST /api/hunts', () => {
  it('starts a hunt in the directory given and returns its id', async () => {
    const res = await start()
    expect(res.status).toBe(201)
    expect(res.body.hunt.id).toBeTruthy()
    expect(hunts.list()).toHaveLength(1)
  })

  it('never takes the command from the client', async () => {
    // The port has no auth by design (§2, single local user). Letting the body
    // name the binary would turn that into arbitrary local execution for
    // anything on the machine that can post a form.
    const res = await start({ cwd, command: '/usr/bin/curl', args: ['evil.example'] })
    expect(res.status).toBe(201)
    expect(res.body.hunt.command).toBe('/bin/sh')
  })

  it('refuses a directory that does not exist, naming it', async () => {
    const res = await start({ cwd: '/no/such/place' })
    expect(res.status).toBe(400)
    expect(res.body.error).toContain('/no/such/place')
  })

  it('refuses to exceed the ceiling, with the message rather than a crash', async () => {
    await start()
    await start()
    const res = await start()
    expect(res.status).toBe(429)
    expect(res.body.error).toMatch(/2/)
  })
})

describe('GET /api/hunts', () => {
  it('lists hunts without their process handles', async () => {
    await start()
    const res = await handle('GET', '/api/hunts', null, env, hunts)
    expect(res.status).toBe(200)
    expect(res.body.hunts).toHaveLength(1)
    expect(res.body.hunts[0]).not.toHaveProperty('agent')
  })
})

describe('GET /api/hunts/:id/stream', () => {
  it('replays the backlog then streams, as SSE frames', async () => {
    const hunt = hunts.start({ command: '/bin/sh', args: ['-c', 'echo hello; sleep 30'] })
    await until(() => hunt.buffer().includes('hello'), 'the child to speak')

    const res = await handle('GET', `/api/hunts/${hunt.id}/stream`, null, env, hunts)
    expect(res.status).toBe(200)
    expect(res.headers?.['Content-Type']).toBe('text/event-stream')

    const frames: string[] = []
    const close = res.stream!((chunk) => frames.push(chunk))
    try {
      expect(frames.join('')).toMatch(/^data: /)
      expect(JSON.parse(frames[0]!.replace(/^data: /, '').trim()).output).toContain('hello')
    } finally {
      close()
    }
  })

  it('stops sending once the client goes away', async () => {
    const hunt = hunts.start({ command: '/bin/sh', args: ['-c', 'sleep 30'] })
    const res = await handle('GET', `/api/hunts/${hunt.id}/stream`, null, env, hunts)
    const frames: string[] = []
    res.stream!((chunk) => frames.push(chunk))()
    hunt.write('echo after\n')
    await new Promise((r) => setTimeout(r, 200))
    expect(frames).toHaveLength(0)
  })

  it('404s for an unknown id', async () => {
    const res = await handle('GET', '/api/hunts/nope/stream', null, env, hunts)
    expect(res.status).toBe(404)
  })
})

describe('input and resize', () => {
  it('reaches the child with what was typed', async () => {
    const hunt = hunts.start({ command: '/bin/sh', args: ['-c', 'read line; echo "got:$line"'] })
    const res = await handle('POST', `/api/hunts/${hunt.id}/input`, { data: 'ping\n' }, env, hunts)
    expect(res.status).toBe(204)
    await until(() => hunt.buffer().includes('got:ping'), 'the child to answer')
  })

  it('changes what the child reports for its window size', async () => {
    const hunt = hunts.start({ command: '/bin/sh', args: ['-c', 'sleep 0.3; stty size'] })
    const res = await handle('POST', `/api/hunts/${hunt.id}/resize`, { cols: 100, rows: 40 }, env, hunts)
    expect(res.status).toBe(204)
    await until(() => hunt.buffer().includes('40 100'), 'the child to report 40 100')
  })

  it('rejects a resize that is not two positive numbers', async () => {
    const hunt = hunts.start({ command: '/bin/sh', args: ['-c', 'sleep 5'] })
    const res = await handle('POST', `/api/hunts/${hunt.id}/resize`, { cols: 0, rows: -1 }, env, hunts)
    expect(res.status).toBe(400)
  })

  it('404s input and resize for an unknown id', async () => {
    expect((await handle('POST', '/api/hunts/nope/input', { data: 'x' }, env, hunts)).status).toBe(404)
    expect((await handle('POST', '/api/hunts/nope/resize', { cols: 80, rows: 24 }, env, hunts)).status).toBe(404)
  })
})

describe('DELETE /api/hunts/:id', () => {
  it('ends a hunt and leaves it listed', async () => {
    const hunt = hunts.start({ command: '/bin/sh', args: ['-c', 'sleep 30'] })
    const res = await handle('DELETE', `/api/hunts/${hunt.id}`, null, env, hunts)
    expect(res.status).toBe(204)
    expect(hunts.get(hunt.id)?.killedAt).not.toBe(null)
    expect(hunts.list()).toHaveLength(1)
  })
})
