import { mkdtemp, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { parseRegistration } from '../src/project/parse.js'
import { projectsDir } from '../src/paths.js'
import { readAllRegistrations, writeRegistration } from '../src/project/store.js'
import { serializeRegistration } from '../src/project/serialize.js'

let env: NodeJS.ProcessEnv

beforeEach(async () => {
  const home = await mkdtemp(join(tmpdir(), 'hb-reg-'))
  env = { HOUNTYBUNTER_HOME: home } as NodeJS.ProcessEnv
})

const sample = parseRegistration(
  `---
slug: proj-abc123
name: proj
paths:
  - /w/proj
plan: docs/plan.md
registered_at: 2026-09-08
mood: cheerful
---

Prose survives.
`,
  '/unused.md',
)

describe('registration round trip', () => {
  it('writes a record that parses back to the same values', async () => {
    const path = await writeRegistration(sample, env)
    expect(path).toBe(join(projectsDir(env), 'proj-abc123.md'))

    const { registrations, errors } = await readAllRegistrations(env)
    expect(errors).toEqual([])
    expect(registrations).toHaveLength(1)
    const back = registrations[0]!
    expect(back.slug).toBe('proj-abc123')
    expect(back.paths).toEqual(['/w/proj'])
    expect(back.plan).toBe('docs/plan.md')
    expect(back.extra).toEqual({ mood: 'cheerful' })
    expect(back.body).toBe('Prose survives.')
  })

  it('omits a field nobody set rather than writing it as null', () => {
    const bare = parseRegistration(
      '---\nslug: s\nname: n\npaths:\n  - /a\nregistered_at: 2026-09-08\n---\n',
      '/unused.md',
    )
    const text = serializeRegistration(bare)
    expect(text).not.toContain('plan')
    expect(text).not.toContain('git_remote')
  })

  it('collects a bad record as an error instead of hiding the good ones', async () => {
    await writeRegistration(sample, env)
    await writeFile(join(projectsDir(env), 'broken.md'), '---\nname: no slug here\n---\n')

    const { registrations, errors } = await readAllRegistrations(env)
    expect(registrations).toHaveLength(1)
    expect(errors).toHaveLength(1)
    expect(errors[0]!.sourcePath).toBe(join(projectsDir(env), 'broken.md'))
  })

  it('reports no registrations at all rather than throwing on a store with no directory', async () => {
    const { registrations, errors } = await readAllRegistrations(env)
    expect(registrations).toEqual([])
    expect(errors).toEqual([])
  })

  it('refuses a slug that would put the record outside the store', async () => {
    // The slug is authored, and `hb register` writes back whatever slug it
    // read — so a hand-edited one must not be able to aim the write at the
    // user's repository, which registration promises never to touch.
    const escaped = join(dirname(projectsDir(env)), 'escaped.md')
    await expect(writeRegistration({ ...sample, slug: '../escaped' }, env)).rejects.toThrow(
      /single path segment/,
    )
    await expect(stat(escaped)).rejects.toThrow()

    // Inside the store but not where its reader looks is refused for the same reason.
    await expect(writeRegistration({ ...sample, slug: 'sub/x' }, env)).rejects.toThrow(
      /single path segment/,
    )
    const { registrations, errors } = await readAllRegistrations(env)
    expect(registrations).toEqual([])
    expect(errors).toEqual([])
  })
})
