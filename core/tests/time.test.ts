import { describe, expect, it } from 'vitest'
import { calendarDate, nowIso, resolveTimeZone } from '../src/time.js'

describe('nowIso', () => {
  it('formats as ISO 8601 UTC with a Z suffix', () => {
    expect(nowIso(() => new Date('2026-08-27T15:04:05.000Z'))).toBe('2026-08-27T15:04:05.000Z')
  })
})

describe('calendarDate', () => {
  it('resolves the date in the given zone, not the machine zone', () => {
    const instant = '2026-08-27T03:30:00.000Z'
    expect(calendarDate(instant, 'UTC')).toBe('2026-08-27')
    expect(calendarDate(instant, 'Asia/Ho_Chi_Minh')).toBe('2026-08-27')
    expect(calendarDate(instant, 'America/New_York')).toBe('2026-08-26')
  })

  it('handles an instant crossing the boundary the other way', () => {
    const late = '2026-08-27T18:00:00.000Z'
    expect(calendarDate(late, 'UTC')).toBe('2026-08-27')
    expect(calendarDate(late, 'Asia/Ho_Chi_Minh')).toBe('2026-08-28')
  })

  it('throws on an unparseable instant rather than guessing', () => {
    expect(() => calendarDate('not-a-date', 'UTC')).toThrow(/invalid instant/i)
  })
})

describe('resolveTimeZone', () => {
  it('prefers an explicit configuration', () => {
    expect(resolveTimeZone({ HOUNTYBUNTER_TZ: 'Asia/Ho_Chi_Minh' } as NodeJS.ProcessEnv))
      .toBe('Asia/Ho_Chi_Minh')
  })

  it('falls back to a resolvable zone', () => {
    expect(resolveTimeZone({} as NodeJS.ProcessEnv)).toMatch(/\w+/)
  })
})
