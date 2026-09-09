import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readLastExchange } from '../src/exchange.js'

const user = (text: string) =>
  JSON.stringify({ type: 'user', message: { role: 'user', content: text } })
const assistant = (text: string) =>
  JSON.stringify({
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'text', text }] },
  })

describe('readLastExchange', () => {
  it('takes the last prompt and the last reply, not the first', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hb-tail-'))
    const path = join(dir, 's.jsonl')
    await writeFile(path, [user('first'), assistant('early'), user('latest'), assistant('final')].join('\n'))

    expect(await readLastExchange(path)).toEqual({ prompt: 'latest', reply: 'final' })
  })

  it('returns absence for a file it cannot read, rather than throwing', async () => {
    expect(await readLastExchange('/nowhere/at/all.jsonl')).toEqual({ prompt: null, reply: null })
  })

  it('skips a malformed line instead of losing the whole tail', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hb-tail2-'))
    const path = join(dir, 's.jsonl')
    await writeFile(path, [user('kept'), '{not json', assistant('kept too')].join('\n'))

    expect(await readLastExchange(path)).toEqual({ prompt: 'kept', reply: 'kept too' })
  })

  it('skips a line that is valid JSON but not an object, instead of throwing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hb-tail3-'))
    const path = join(dir, 's.jsonl')
    await writeFile(path, [user('kept'), 'null', assistant('kept too')].join('\n'))

    expect(await readLastExchange(path)).toEqual({ prompt: 'kept', reply: 'kept too' })
  })
})
