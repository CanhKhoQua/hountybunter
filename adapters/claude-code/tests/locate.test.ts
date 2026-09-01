import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { findTranscripts, transcriptRoot } from '../src/locate.js'

let env: NodeJS.ProcessEnv
let home: string

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'hb-cc-'))
  env = { HOME: home } as NodeJS.ProcessEnv
})

describe('transcriptRoot', () => {
  it('defaults to ~/.claude/projects', () => {
    expect(transcriptRoot({ HOME: '/home/x' } as NodeJS.ProcessEnv))
      .toBe('/home/x/.claude/projects')
  })

  it('honours an override', () => {
    expect(transcriptRoot({ HOUNTYBUNTER_TRANSCRIPTS: '/elsewhere' } as NodeJS.ProcessEnv))
      .toBe('/elsewhere')
  })
})

describe('findTranscripts', () => {
  it('returns an empty array when the root does not exist', async () => {
    expect(await findTranscripts(env)).toEqual([])
  })

  it('finds jsonl files and reads the session id from the filename', async () => {
    const dir = join(home, '.claude', 'projects', '-Users-kobe-proj')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jsonl'), '')

    const found = await findTranscripts(env)
    expect(found).toHaveLength(1)
    expect(found[0]?.sessionId).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')
    expect(found[0]?.projectDir).toBe('-Users-kobe-proj')
  })

  it('ignores non-jsonl files', async () => {
    const dir = join(home, '.claude', 'projects', '-p')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'notes.md'), '')
    expect(await findTranscripts(env)).toEqual([])
  })
})
