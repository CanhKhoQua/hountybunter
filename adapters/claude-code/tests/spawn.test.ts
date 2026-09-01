import { afterEach, describe, expect, it } from 'vitest'
import { spawnAgent, type AgentProcess } from '../src/spawn.js'

let running: AgentProcess | null = null

afterEach(() => {
  running?.kill()
  running = null
})

/** Collect output until a predicate holds, or give up. */
function readUntil(proc: AgentProcess, matches: (text: string) => boolean): Promise<string> {
  return new Promise((resolve, reject) => {
    let seen = ''
    const timer = setTimeout(() => reject(new Error(`never saw it; got: ${seen}`)), 8000)
    proc.onData((chunk) => {
      seen += chunk
      if (matches(seen)) {
        clearTimeout(timer)
        resolve(seen)
      }
    })
  })
}

describe('spawnAgent', () => {
  it('streams what the child writes', async () => {
    running = spawnAgent({ command: '/bin/sh', args: ['-c', 'echo marker-one'] })
    expect(await readUntil(running, (t) => t.includes('marker-one'))).toContain('marker-one')
  })

  it('gives the child a real tty, not a pipe', async () => {
    // The whole point of a pty: the agent must believe it is interactive.
    running = spawnAgent({ command: '/bin/sh', args: ['-c', 'tty'] })
    const out = await readUntil(running, (t) => /\/dev\/(tty|pts)/.test(t))
    expect(out).toMatch(/\/dev\/(tty|pts)/)
  })

  it('passes the window size through, so output is not wrapped wrong', async () => {
    running = spawnAgent({ command: '/bin/sh', args: ['-c', 'stty size'], cols: 123, rows: 45 })
    expect(await readUntil(running, (t) => t.includes('45 123'))).toContain('45 123')
  })

  it('resizes a running child', async () => {
    running = spawnAgent({ command: '/bin/sh', args: [], cols: 80, rows: 24 })
    running.resize(100, 30)
    running.write('stty size\n')
    expect(await readUntil(running, (t) => t.includes('30 100'))).toContain('30 100')
  })

  it('reaches the child on stdin', async () => {
    running = spawnAgent({ command: '/bin/sh', args: [] })
    running.write('echo typed-in\n')
    expect(await readUntil(running, (t) => t.includes('typed-in'))).toContain('typed-in')
  })

  it('reports the exit code when the child ends on its own', async () => {
    running = spawnAgent({ command: '/bin/sh', args: ['-c', 'exit 3'] })
    const code = await new Promise<number>((resolve) => running!.onExit(resolve))
    expect(code).toBe(3)
  })

  it('ends a child that would otherwise sit there', async () => {
    running = spawnAgent({ command: '/bin/sh', args: ['-c', 'sleep 30'] })
    const exited = new Promise<number>((resolve) => running!.onExit(resolve))
    running.kill()
    await expect(exited).resolves.toBeTypeOf('number')
  })

  it('starts in the directory it was given', async () => {
    running = spawnAgent({ command: '/bin/sh', args: ['-c', 'pwd'], cwd: '/tmp' })
    expect(await readUntil(running, (t) => t.includes('/tmp'))).toContain('/tmp')
  })
})
