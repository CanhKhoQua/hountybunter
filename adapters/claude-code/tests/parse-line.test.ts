import { describe, expect, it } from 'vitest'
import { extractToolUses, parseLine } from '../src/parse-line.js'

describe('parseLine', () => {
  it('parses a user record', () => {
    const record = parseLine(JSON.stringify({ type: 'user', cwd: '/repo' }))
    expect(record.ok).toBe(true)
    if (record.ok) {
      expect(record.kind).toBe('user')
      expect(record.raw.cwd).toBe('/repo')
    }
  })

  it('keeps an unknown record type instead of dropping it', () => {
    const record = parseLine(JSON.stringify({ type: 'brand-new-thing', payload: 1 }))
    expect(record.ok).toBe(true)
    if (record.ok) {
      expect(record.kind).toBe('brand-new-thing')
      expect(record.raw.payload).toBe(1)
    }
  })

  it('treats a record with no type as unknown rather than failing', () => {
    const record = parseLine(JSON.stringify({ cwd: '/repo' }))
    expect(record.ok).toBe(true)
    if (record.ok) expect(record.kind).toBe('unknown')
  })

  it('reports malformed JSON rather than throwing', () => {
    const record = parseLine('{ not json')
    expect(record.ok).toBe(false)
    if (!record.ok) expect(record.reason).toMatch(/json/i)
  })

  it('reports a non-object line rather than throwing', () => {
    expect(parseLine('42').ok).toBe(false)
    expect(parseLine('"a string"').ok).toBe(false)
    expect(parseLine('null').ok).toBe(false)
  })

  it('reports an empty line', () => {
    expect(parseLine('   ').ok).toBe(false)
  })
})

describe('extractToolUses', () => {
  it('finds tool_use blocks in an assistant record', () => {
    const raw = {
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'hello' },
          { type: 'tool_use', name: 'Bash' },
          { type: 'tool_use', name: 'Write' },
        ],
      },
    }
    expect(extractToolUses(raw)).toEqual([{ name: 'Bash' }, { name: 'Write' }])
  })

  it('returns an empty array when content is missing or the wrong shape', () => {
    expect(extractToolUses({ type: 'assistant' })).toEqual([])
    expect(extractToolUses({ type: 'assistant', message: { content: 'text' } })).toEqual([])
    expect(extractToolUses({ type: 'assistant', message: null })).toEqual([])
  })

  it('skips a tool_use block with no name', () => {
    expect(extractToolUses({ type: 'assistant', message: { content: [{ type: 'tool_use' }] } }))
      .toEqual([])
  })
})
