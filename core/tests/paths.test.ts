import { describe, expect, it } from 'vitest'
import { dbPath, jotsDir, notesDir, projectSlug, storeRoot } from '../src/paths.js'

const ENV = { HOUNTYBUNTER_HOME: '/tmp/hb-test' } as NodeJS.ProcessEnv

describe('projectSlug', () => {
  it('combines basename with a hash of the full path', () => {
    expect(projectSlug('/Users/kobe/Developer/tnm-dms')).toMatch(/^tnm-dms-[0-9a-f]{6}$/)
  })

  it('gives different slugs to same-named projects at different paths', () => {
    expect(projectSlug('/Users/kobe/A/tnm-dms')).not.toBe(projectSlug('/Users/kobe/B/tnm-dms'))
  })

  it('is stable across calls', () => {
    const p = '/Users/kobe/Developer/tnm-dms'
    expect(projectSlug(p)).toBe(projectSlug(p))
  })

  it('ignores a trailing slash', () => {
    expect(projectSlug('/a/b/proj/')).toBe(projectSlug('/a/b/proj'))
  })

  it('sanitises characters unsafe in a directory name', () => {
    expect(projectSlug('/Users/kobe/My Drive/tnm dms')).toMatch(/^tnm-dms-[0-9a-f]{6}$/)
  })
})

describe('store locations', () => {
  it('honours HOUNTYBUNTER_HOME', () => {
    expect(storeRoot(ENV)).toBe('/tmp/hb-test')
    expect(jotsDir(ENV)).toBe('/tmp/hb-test/jots')
    expect(dbPath(ENV)).toBe('/tmp/hb-test/index.db')
    expect(notesDir('proj-abc123', ENV)).toBe('/tmp/hb-test/notes/proj-abc123')
  })

  it('falls back to ~/.hountybunter', () => {
    expect(storeRoot({ HOME: '/home/x' } as NodeJS.ProcessEnv)).toBe('/home/x/.hountybunter')
  })
})
