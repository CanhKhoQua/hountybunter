import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

let child: ChildProcess | null = null

afterEach(() => {
  child?.kill()
  child = null
})

/**
 * Runs the real executable, not runCli. The unit tests cannot see whether the
 * process survives long enough to answer anything — `process.exit` after a
 * successful start looks identical to them.
 */
function startHb(port: number, home: string): Promise<string> {
  return new Promise((resolve, reject) => {
    child = spawn('./bin/hb', ['web', '--port', String(port)], {
      cwd: new URL('../../..', import.meta.url).pathname,
      env: { ...process.env, HOUNTYBUNTER_HOME: home },
    })
    let out = ''
    child.stdout?.on('data', (d) => {
      out += String(d)
      if (out.includes('http://')) resolve(out)
    })
    child.stderr?.on('data', (d) => reject(new Error(String(d))))
    child.on('exit', (code) => reject(new Error(`hb web exited early with code ${code}`)))
    setTimeout(() => reject(new Error('hb web printed nothing')), 15000)
  })
}

describe('hb web, as an actual process', () => {
  it('stays up and answers after printing its address', async () => {
    const home = await mkdtemp(join(tmpdir(), 'hb-proc-'))
    const port = 4789
    await startHb(port, home)

    // A quarter second after it claimed to be ready, it must still be there.
    await new Promise((r) => setTimeout(r, 250))
    const res = await fetch(`http://127.0.0.1:${port}/api/notes`)
    expect(res.status).toBe(200)
    // What this test is for is that the process is still up and serving, not
    // what any one route's body looks like.
    expect(await res.json()).toMatchObject({ notes: [] })
  }, 20000)
})
