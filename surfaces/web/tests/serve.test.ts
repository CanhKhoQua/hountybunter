import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { serve } from '../src/server/serve.js'

let env: NodeJS.ProcessEnv
let server: Awaited<ReturnType<typeof serve>>
let base: string

beforeEach(async () => {
  const home = await mkdtemp(join(tmpdir(), 'hb-serve-'))
  env = { HOUNTYBUNTER_HOME: home } as NodeJS.ProcessEnv
  server = await serve({ port: 0, env })
  const address = server.address() as AddressInfo
  base = `http://127.0.0.1:${address.port}`
})

afterEach(() => {
  server.close()
})

describe('serve', () => {
  it('answers a real request over a real socket', async () => {
    const res = await fetch(`${base}/api/notes`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/application\/json/)
    expect(await res.json()).toEqual({ notes: [] })
  })

  it('binds the loopback interface only, never every interface', async () => {
    // A single-user tool with no auth must not be reachable from the network.
    expect((server.address() as AddressInfo).address).toBe('127.0.0.1')
  })

  it('passes an unknown path through as a 404 with a message', async () => {
    const res = await fetch(`${base}/api/quarry`)
    expect(res.status).toBe(404)
    expect(String((await res.json()).error)).toMatch(/quarry/)
  })
})
