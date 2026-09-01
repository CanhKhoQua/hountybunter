import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import { HuntRegistry } from '../src/server/hunts.js'

let hunts: HuntRegistry

/** A shell that echoes and then waits, so a hunt is genuinely alive. */
const SLEEPER = { command: '/bin/sh', args: ['-c', 'echo hello; sleep 30'] }

beforeEach(() => {
  hunts = new HuntRegistry({ max: 2 })
})
afterEach(() => {
  hunts.killAll()
})

/** Wait until `predicate` holds, or fail loudly rather than hanging the suite. */
async function until(predicate: () => boolean, what: string, ms = 3000): Promise<void> {
  const deadline = Date.now() + ms
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 10))
  }
}

describe('HuntRegistry', () => {
  it('starts a hunt and finds it again by id', () => {
    const hunt = hunts.start(SLEEPER)
    expect(hunt.id).toBeTruthy()
    expect(hunts.get(hunt.id)?.id).toBe(hunt.id)
    expect(hunts.list().map((h) => h.id)).toEqual([hunt.id])
  })

  it('buffers output so a listener attached late still sees it', async () => {
    const hunt = hunts.start(SLEEPER)
    await until(() => hunt.buffer().includes('hello'), 'the child to say hello')

    const seen: string[] = []
    hunt.subscribe((chunk) => seen.push(chunk))
    // Late subscriber gets the backlog, not an empty stream: a browser tab
    // opened a second after the hunt started must not miss its first lines.
    expect(seen.join('')).toContain('hello')
  })

  it('refuses to start beyond the limit, with a message', () => {
    hunts.start(SLEEPER)
    hunts.start(SLEEPER)
    expect(() => hunts.start(SLEEPER)).toThrow(/2/)
    expect(hunts.list()).toHaveLength(2)
  })

  it('frees a slot once a hunt is killed', () => {
    const first = hunts.start(SLEEPER)
    hunts.start(SLEEPER)
    hunts.kill(first.id)
    expect(() => hunts.start(SLEEPER)).not.toThrow()
  })

  it('records being asked to end separately from having ended', async () => {
    const hunt = hunts.start(SLEEPER)
    hunts.kill(hunt.id)
    // The slot is free immediately, but no exit code is claimed until the
    // process actually reports one.
    expect(hunt.killedAt).not.toBe(null)
    await until(() => hunt.exitCode !== null, 'the killed child to exit')
    expect(hunts.get(hunt.id)?.killedAt).not.toBe(null)
  })

  it('keeps a dead hunt listed, with its exit code', async () => {
    // Death is a state, not a disappearance. A hunt that exited is exactly what
    // the user needs to look at, and removing it hides the failure.
    const hunt = hunts.start({ command: '/bin/sh', args: ['-c', 'exit 3'] })
    await until(() => hunt.exitCode !== null, 'the child to exit')
    expect(hunt.exitCode).toBe(3)
    expect(hunts.get(hunt.id)?.exitCode).toBe(3)
    expect(hunts.list()).toHaveLength(1)
  })

  it('does not count a dead hunt against the limit', async () => {
    const hunt = hunts.start({ command: '/bin/sh', args: ['-c', 'exit 0'] })
    await until(() => hunt.exitCode !== null, 'the child to exit')
    hunts.start(SLEEPER)
    expect(() => hunts.start(SLEEPER)).not.toThrow()
  })

  it('caps the buffer so a chatty agent cannot exhaust memory', async () => {
    const noisy = hunts.start({
      command: '/bin/sh',
      args: ['-c', 'i=0; while [ $i -lt 400 ]; do echo aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa; i=$((i+1)); done'],
    })
    await until(() => noisy.exitCode !== null, 'the noisy child to finish')
    expect(noisy.buffer().length).toBeLessThanOrEqual(8192)
    // The tail is what survives, because it is the part still being read.
    expect(noisy.buffer()).toContain('aaaa')
  })

  it('unsubscribes cleanly', async () => {
    const hunt = hunts.start(SLEEPER)
    const seen: string[] = []
    const off = hunt.subscribe((chunk) => seen.push(chunk))
    await until(() => seen.length > 0, 'the first chunk')
    off()
    const countAtUnsubscribe = seen.length
    hunt.write('echo more\n')
    await new Promise((r) => setTimeout(r, 200))
    expect(seen).toHaveLength(countAtUnsubscribe)
  })
})
