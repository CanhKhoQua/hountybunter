import { describe, expect, it } from 'vitest'
import { RegistrationParseError, parseRegistration } from '../src/project/parse.js'

const full = `---
slug: hountybunter-a1b2c3
name: hountybunter
paths:
  - /Users/kobe/Developer/hountybunter
  - /Users/kobe/Developer/hountybunter-wt/phase-8b
git_remote: git@github.com:kobe/hountybunter.git
plan: docs/superpowers/plans/2026-09-02-phase-8a-staleness.md
registered_at: 2026-09-08
mood: cheerful
---

Free prose.
`

describe('parseRegistration', () => {
  it('reads every declared field', () => {
    const r = parseRegistration(full, '/store/projects/hountybunter-a1b2c3.md')
    expect(r.slug).toBe('hountybunter-a1b2c3')
    expect(r.name).toBe('hountybunter')
    expect(r.paths).toEqual([
      '/Users/kobe/Developer/hountybunter',
      '/Users/kobe/Developer/hountybunter-wt/phase-8b',
    ])
    expect(r.git_remote).toBe('git@github.com:kobe/hountybunter.git')
    expect(r.plan).toBe('docs/superpowers/plans/2026-09-02-phase-8a-staleness.md')
    expect(r.registered_at).toBe('2026-09-08')
  })

  it('preserves keys it does not know, so a hand edit survives a rewrite', () => {
    const r = parseRegistration(full, '/store/projects/x.md')
    expect(r.extra).toEqual({ mood: 'cheerful' })
  })

  it('reads an unquoted registered_at as the day its author wrote', () => {
    const r = parseRegistration(
      '---\nslug: s\nname: n\npaths:\n  - /a\nregistered_at: 2026-09-08\n---\n',
      '/store/projects/s.md',
    )
    expect(r.registered_at).toBe('2026-09-08')
  })

  it('leaves an undeclared plan absent rather than empty', () => {
    const r = parseRegistration('---\nslug: s\nname: n\npaths:\n  - /a\nregistered_at: 2026-09-08\n---\n', '/p.md')
    expect(r.plan).toBeNull()
    expect(r.git_remote).toBeNull()
  })

  it('refuses a record with no paths, because it can never match a cwd', () => {
    expect(() => parseRegistration('---\nslug: s\nname: n\nregistered_at: 2026-09-08\n---\n', '/p.md'))
      .toThrow(RegistrationParseError)
  })

  it('refuses a relative path, which would resolve differently per caller', () => {
    expect(() => parseRegistration('---\nslug: s\nname: n\npaths:\n  - ./here\nregistered_at: 2026-09-08\n---\n', '/p.md'))
      .toThrow(/absolute/)
  })

  it('refuses an absolute plan, which would not survive the repo moving', () => {
    const raw = '---\nslug: s\nname: n\npaths:\n  - /a\nplan: /a/docs/p.md\nregistered_at: 2026-09-08\n---\n'
    expect(() => parseRegistration(raw, '/p.md')).toThrow(/repo-relative/)
  })

  it('names the file and the field it choked on', () => {
    try {
      parseRegistration('---\nslug: s\nname: n\nregistered_at: 2026-09-08\n---\n', '/store/projects/s.md')
      expect.unreachable('should have thrown')
    } catch (error) {
      const e = error as RegistrationParseError
      expect(e.sourcePath).toBe('/store/projects/s.md')
      expect(e.field).toBe('paths')
    }
  })
})
