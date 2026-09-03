import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { openDb, parseNote, writeNote } from '@hountybunter/core'
import { runCli, type Io } from '../src/bin.js'

let home: string
let project: string
let out: string[]
let err: string[]
let io: Io

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'hb-cli-verify-'))
  project = await mkdtemp(join(tmpdir(), 'hb-cli-proj-'))
  out = []
  err = []
  io = {
    out: (l) => out.push(l),
    err: (l) => err.push(l),
    env: { HOUNTYBUNTER_HOME: home, HOUNTYBUNTER_TZ: 'UTC' } as NodeJS.ProcessEnv,
    cwd: project,
  }

  await writeFile(join(project, 'a.ts'), 'x\n')
  const note = parseNote(
    `---\nid: n1\ntitle: t\nproject: proj-a\nkind: decision\nstatus: standing\n` +
      `question: q?\nchosen: c\nevidence:\n  - {kind: file, ref: a.ts}\n---\n\nbody\n`,
    join(home, 'notes', 'proj-a', 'n1.md'),
  )
  await writeNote({ ...note, project_path: project }, io.env)
  openDb(io.env).close()
})

const notePath = () => join(home, 'notes', 'proj-a', 'n1.md')

describe('hb verify', () => {
  it('says how many notes have no baseline, and names the command that sets one', async () => {
    // Day one is every note. It has to be a prompt, not a wall of false alarms.
    expect(await runCli(['verify'], io)).toBe(0)
    expect(out.join('\n')).toMatch(/no baseline/i)
    expect(out.join('\n')).toContain('hb verify --ack --all')
  })

  it('does not touch a single note file', async () => {
    const before = await readFile(notePath(), 'utf8')
    await runCli(['verify'], io)

    expect(await readFile(notePath(), 'utf8')).toBe(before)
  })

  it('sets a baseline for every note when asked to', async () => {
    expect(await runCli(['verify', '--ack', '--all'], io)).toBe(0)
    const after = await readFile(notePath(), 'utf8')

    expect(after).toContain('verified:')
    // serializeNote quotes any scalar containing a colon, so the hash comes
    // back as `hash: 'sha256:...'` rather than bare.
    expect(after).toMatch(/hash: '?sha256:[0-9a-f]{64}'?/)
  })

  it('reports a file that changed after it was confirmed', async () => {
    await runCli(['verify', '--ack', '--all'], io)
    await writeFile(join(project, 'a.ts'), 'y\n')
    out.length = 0

    expect(await runCli(['verify'], io)).toBe(0)
    expect(out.join('\n')).toMatch(/n1/)
    expect(out.join('\n')).toMatch(/changed/)
  })

  it('goes quiet again once the change is acknowledged', async () => {
    await runCli(['verify', '--ack', '--all'], io)
    await writeFile(join(project, 'a.ts'), 'y\n')
    await runCli(['verify', '--ack', 'n1'], io)
    out.length = 0

    await runCli(['verify'], io)
    expect(out.join('\n')).not.toMatch(/changed/)
  })

  it('names a note id it does not have rather than acknowledging nothing', async () => {
    expect(await runCli(['verify', '--ack', 'nope'], io)).toBe(1)
    expect(err.join('\n')).toContain('nope')
  })

  it('refuses --ack with no target rather than confirming the whole store', async () => {
    expect(await runCli(['verify', '--ack'], io)).toBe(1)
    expect(err.join('\n')).toMatch(/--all/)
  })
})

describe('hb verify argument validation', () => {
  it('rejects an unrecognized flag instead of silently behaving like a bare verify', async () => {
    expect(await runCli(['verify', '--bogus'], io)).toBe(1)
    expect(err.join('\n')).toContain('--bogus')
  })

  it('rejects --all together with a note id instead of acking the whole store', async () => {
    expect(await runCli(['verify', '--ack', '--all', 'typo-id'], io)).toBe(1)
    expect(err.join('\n')).toContain('typo-id')
    expect(err.join('\n')).toMatch(/--all/)
  })

  it('rejects --all without --ack, since it has no meaning on a read-only verify', async () => {
    expect(await runCli(['verify', '--all'], io)).toBe(1)
    expect(err.join('\n')).toMatch(/--ack/)
  })

  it('rejects more than one bare positional instead of dropping the second one', async () => {
    expect(await runCli(['verify', 'n1', 'n2'], io)).toBe(1)
    expect(err.join('\n')).toContain('n1')
    expect(err.join('\n')).toContain('n2')
  })

  it('still acks the whole store with --ack --all', async () => {
    expect(await runCli(['verify', '--ack', '--all'], io)).toBe(0)
    expect(out.join('\n')).toContain('confirmed n1')
  })

  it('still acks a single named note with --ack <id>', async () => {
    expect(await runCli(['verify', '--ack', 'n1'], io)).toBe(0)
    expect(out.join('\n')).toContain('confirmed n1')
  })
})

describe('hb ingest', () => {
  it('verifies at the end without writing a baseline', async () => {
    const before = await readFile(notePath(), 'utf8')
    await runCli(['ingest'], io)

    expect(await readFile(notePath(), 'utf8')).toBe(before)
  })
})
