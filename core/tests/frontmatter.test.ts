import { describe, expect, it } from 'vitest'
import { dateStr, str } from '../src/frontmatter.js'

describe('str', () => {
  it('passes a string through and renders null as empty', () => {
    expect(str('a')).toBe('a')
    expect(str(null)).toBe('')
    expect(str(undefined)).toBe('')
    expect(str(7)).toBe('7')
  })
})

describe('dateStr', () => {
  it('reads a YAML date as the calendar day its author wrote, not the local one', () => {
    // YAML 1.1 parses an unquoted date to UTC midnight; rendering it locally
    // would shift the day west of UTC.
    expect(dateStr(new Date('2026-08-12T00:00:00.000Z'))).toBe('2026-08-12')
  })

  it('renders an unparseable date as empty rather than as Invalid Date', () => {
    expect(dateStr(new Date('nonsense'))).toBe('')
  })
})
