import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { serve } from '../src/server/serve.js'

let env: NodeJS.ProcessEnv
let home: string
let server: Awaited<ReturnType<typeof serve>> | null = null

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'hb-static-'))
  env = { HOUNTYBUNTER_HOME: home } as NodeJS.ProcessEnv
})

afterEach(() => {
  server?.close()
  server = null
})

async function start(clientDir: string) {
  server = await serve({ port: 0, env, clientDir })
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

describe('serving the client', () => {
  it('serves index.html at the root', async () => {
    const dir = join(home, 'client')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'index.html'), '<h1>camp</h1>', 'utf8')

    const base = await start(dir)
    const res = await fetch(base)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/text\/html/)
    expect(await res.text()).toContain('camp')
  })

  it('serves an asset with a type the browser will honour', async () => {
    const dir = join(home, 'client')
    await mkdir(join(dir, 'assets'), { recursive: true })
    await writeFile(join(dir, 'assets', 'app.js'), 'export const a = 1', 'utf8')

    const base = await start(dir)
    const res = await fetch(`${base}/assets/app.js`)
    expect(res.headers.get('content-type')).toMatch(/javascript/)
  })

  it('refuses to read outside the client directory', async () => {
    const dir = join(home, 'client')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'index.html'), 'ok', 'utf8')
    await writeFile(join(home, 'secret.txt'), 'not yours', 'utf8')

    const base = await start(dir)
    const res = await fetch(`${base}/../secret.txt`, { redirect: 'manual' })
    expect(await res.text()).not.toContain('not yours')
  })

  it('says what to run when the client has not been built', async () => {
    const base = await start(join(home, 'never-built'))
    const res = await fetch(base)
    expect(res.status).toBe(503)
    expect(await res.text()).toMatch(/build/i)
  })

  it('still answers the API when the client is missing', async () => {
    const base = await start(join(home, 'never-built'))
    const res = await fetch(`${base}/api/notes`)
    expect(res.status).toBe(200)
  })
})
