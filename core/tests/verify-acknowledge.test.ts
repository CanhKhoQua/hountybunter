import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { parseNote } from '../src/note/parse.js'
import { serializeNote } from '../src/note/serialize.js'
import { readAllNotes, writeNote } from '../src/note/store.js'
import { rebuildFromDisk } from '../src/rebuild.js'
import { acknowledgeNote } from '../src/verify/acknowledge.js'
import { verifyNote } from '../src/verify/note.js'

let home: string
let project: string
let env: NodeJS.ProcessEnv
const never = () => false

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'hb-ack-home-'))
  project = await mkdtemp(join(tmpdir(), 'hb-ack-proj-'))
  env = { HOUNTYBUNTER_HOME: home } as NodeJS.ProcessEnv
})

function note() {
  return parseNote(
    `---\nid: n1\ntitle: t\nproject: proj-a\nkind: decision\nstatus: standing\n` +
      `question: q?\nchosen: c\n` +
      `evidence:\n  - {kind: file, ref: a.ts}\n  - {kind: url, ref: https://e.invalid}\n---\n\nbody\n`,
    join(home, 'notes', 'proj-a', 'n1.md'),
  )
}

const deps = () => ({ projectPath: project, sessionExists: never, today: '2026-09-02' })

describe('acknowledgeNote', () => {
  it('records a baseline for the file it can hash, and only for that', async () => {
    // A commit or a session has no prior value worth writing down, and a url is
    // never checked at all.
    await writeFile(join(project, 'a.ts'), 'x\n')
    const acked = await acknowledgeNote(note(), deps(), env)

    expect(acked.verified!.on).toBe('2026-09-02')
    expect(acked.verified!.refs.map((r) => r.ref)).toEqual(['a.ts'])
    expect(acked.verified!.refs[0]!.hash).toMatch(/^sha256:[0-9a-f]{64}$/)
  })

  it('clears the staleness it was answering', async () => {
    await writeFile(join(project, 'a.ts'), 'x\n')
    const acked = await acknowledgeNote(note(), deps(), env)
    const after = await verifyNote(acked, deps())

    expect(after.stale).toBe(false)
    expect(after.refs.find((r) => r.ref === 'a.ts')!.state).toBe('verified')
  })

  it('writes a file that reads back as the same note', async () => {
    await writeFile(join(project, 'a.ts'), 'x\n')
    const acked = await acknowledgeNote(note(), deps(), env)

    const onDisk = await readFile(join(home, 'notes', 'proj-a', 'n1.md'), 'utf8')
    expect(onDisk).toBe(serializeNote(acked))
    expect(parseNote(onDisk, acked.sourcePath)).toEqual(acked)
  })

  it('leaves a baseline that survives the index being thrown away', async () => {
    // The point of putting it in the file: rebuildFromDisk clears the tables.
    // Re-reading through the real pipeline — readAllNotes, then verifyNote —
    // rather than a raw readFile is what makes this test able to fail: a
    // baseline kept only in a table rebuildFromDisk truncates would come back
    // as `unknown` here, where a bare parse of the file would not notice.
    await writeFile(join(project, 'a.ts'), 'x\n')
    await writeNote(note(), env)
    await acknowledgeNote(note(), deps(), env)

    const report = await rebuildFromDisk(env)
    expect(report.errors).toEqual([])

    const { notes } = await readAllNotes(env)
    const reread = notes.find((n) => n.id === 'n1')!
    const verdict = await verifyNote(reread, deps())
    expect(verdict.refs.find((r) => r.ref === 'a.ts')!.state).toBe('verified')
  })

  it('records nothing for a file it could not read, rather than a hash of nothing', async () => {
    const acked = await acknowledgeNote(note(), deps(), env)
    expect(acked.verified!.refs).toEqual([])
  })
})
