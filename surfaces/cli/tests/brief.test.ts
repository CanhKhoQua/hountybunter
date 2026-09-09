import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { runCli, type Io } from '../src/bin.js'

let io: Io
let out: string[]
let err: string[]

beforeEach(async () => {
  const home = await mkdtemp(join(tmpdir(), 'hb-brief-'))
  const live = await mkdtemp(join(tmpdir(), 'hb-brief-live-'))
  out = []
  err = []
  io = {
    out: (l) => out.push(l),
    err: (l) => err.push(l),
    env: {
      HOUNTYBUNTER_HOME: home,
      HOUNTYBUNTER_TZ: 'UTC',
      HOUNTYBUNTER_TRANSCRIPTS: live,
    } as NodeJS.ProcessEnv,
    cwd: process.cwd(),
  }
})

describe('hb brief', () => {
  it('refuses to speak for a project nobody registered, and says how to fix it', async () => {
    expect(await runCli(['brief'], { ...io, cwd: '/w/unregistered' })).toBe(1)
    expect(err.join('\n')).toContain('hb register')
  })

  it('prints the tree state for a registered project', async () => {
    await runCli(['register'], io)
    out.length = 0
    expect(await runCli(['brief', '--no-ingest'], io)).toBe(0)
    const text = out.join('\n')
    expect(text).toContain('In flight now')
    expect(text).toContain('Verify against the working tree')
  })

  it('refuses a flag it does not know instead of ignoring it', async () => {
    await runCli(['register'], io)
    expect(await runCli(['brief', '--wat'], io)).toBe(1)
  })
})
