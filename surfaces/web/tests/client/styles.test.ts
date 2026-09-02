import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const CLIENT = join(process.cwd(), 'surfaces/web/src/client')

async function sources(dir: string): Promise<string[]> {
  const out: string[] = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await sources(path)))
    else if (entry.name.endsWith('.tsx')) out.push(path)
  }
  return out
}

describe('the stylesheet covers what the components ask for', () => {
  it('defines a rule for every class name the JSX uses', async () => {
    // A class with no rule renders as unstyled markup, which looks like the
    // page failed to load rather than like a missing rule. Nothing else in the
    // suite can catch it: happy-dom does not lay anything out.
    const css = await readFile(join(CLIENT, 'app.css'), 'utf8')
    const used = new Set<string>()
    for (const file of await sources(CLIENT)) {
      const text = await readFile(file, 'utf8')
      for (const match of text.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
        for (const name of (match[1] ?? match[2] ?? '').split(/[\s${}()?:'"]+/)) {
          if (/^[a-z][a-z0-9-]*$/.test(name)) used.add(name)
        }
      }
    }
    const missing = [...used].filter((name) => !css.includes(`.${name}`)).sort()
    expect(missing).toEqual([])
  })

  it('gives the terminal a height to measure', async () => {
    // xterm's fit addon reads the container's box. A container with no height
    // makes it compute a nonsense size or throw, so this is not decoration.
    const css = await readFile(join(CLIENT, 'app.css'), 'utf8')
    const rule = css.slice(css.indexOf('.terminal'), css.indexOf('}', css.indexOf('.terminal')))
    expect(rule).toMatch(/height|flex/)
  })
})
