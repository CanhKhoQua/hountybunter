import { describe, expect, it } from 'vitest'
import { projectSlug } from '../src/paths.js'
import { parseRegistration } from '../src/project/parse.js'
import { resolveFrom } from '../src/project/resolve.js'

const reg = (slug: string, paths: string[], plan?: string) =>
  parseRegistration(
    `---\nslug: ${slug}\nname: ${slug}\npaths:\n${paths.map((p) => `  - ${p}`).join('\n')}\n` +
      `${plan ? `plan: ${plan}\n` : ''}registered_at: 2026-09-08\n---\n`,
    `/store/${slug}.md`,
  )

describe('resolveFrom', () => {
  it('matches a directory that is registered', () => {
    const found = resolveFrom([reg('proj-a', ['/w/proj'])], '/w/proj')
    expect(found?.slug).toBe('proj-a')
    expect(found?.primaryPath).toBe('/w/proj')
  })

  it('matches a subdirectory, so a session opened deeper still resolves', () => {
    expect(resolveFrom([reg('proj-a', ['/w/proj'])], '/w/proj/core/src')?.slug).toBe('proj-a')
  })

  it('does not match a sibling that merely shares a name prefix', () => {
    expect(resolveFrom([reg('proj-a', ['/w/proj'])], '/w/project-two')).toBeNull()
  })

  it('takes the longest match when one registered path sits inside another', () => {
    const outer = reg('outer', ['/w'])
    const inner = reg('inner', ['/w/proj'])
    expect(resolveFrom([outer, inner], '/w/proj/src')?.slug).toBe('inner')
  })

  it('ignores a trailing separator on either side', () => {
    expect(resolveFrom([reg('proj-a', ['/w/proj/'])], '/w/proj')?.slug).toBe('proj-a')
  })

  it('yields one slug per registered path, primary first', () => {
    // `hb register` sets slug = projectSlug(paths[0]), so a record the system
    // actually produces has this shape — the declared slug and the primary
    // path's hash agree.
    const primary = projectSlug('/w/proj')
    const found = resolveFrom([reg(primary, ['/w/proj', '/w/wt/phase-8b'])], '/w/wt/phase-8b')
    // The worktree hashes to its own slug; both must be readable, and the
    // primary must stay first because it is where writes go.
    expect(found?.slugs).toEqual([primary, projectSlug('/w/wt/phase-8b')])
    expect(found?.slug).toBe(primary)
  })

  it('reads a hand-authored slug plus the primary path\'s own hash', () => {
    // A record can declare any slug — not just projectSlug(paths[0]). Notes
    // filed under the path-derived slug before this record existed must stay
    // readable, so the primary path's own hash is still part of the set.
    const found = resolveFrom([reg('hand-written', ['/w/proj'])], '/w/proj')
    expect(found?.slugs).toEqual(['hand-written', projectSlug('/w/proj')])
    expect(found?.slug).toBe('hand-written')
  })

  it('carries the declared plan through', () => {
    expect(resolveFrom([reg('proj-a', ['/w/proj'], 'docs/p.md')], '/w/proj')?.plan).toBe('docs/p.md')
  })

  it('returns null for a directory nobody registered', () => {
    expect(resolveFrom([reg('proj-a', ['/w/proj'])], '/elsewhere')).toBeNull()
  })
})
