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
  it('leaves behind no class the old stylesheet used to define', async () => {
    // Under Tailwind a name that is not a utility silently does nothing, and
    // renders exactly like a styled element — happy-dom lays nothing out, so
    // nothing else in the suite can see it. These are the names the
    // hand-written stylesheet defined; a survivor is a class that lost its
    // rules in the move and now styles nothing at all.
    const orphaned = [
      'app', 'menu', 'menu-item', 'menu-tab', 'main', 'panel', 'stage-wrap',
      'rows', 'row', 'when', 'what', 'branch', 'tail', 'tally', 'seq', 'kind',
      'tool', 'sub', 'state', 'preview', 'badge', 'empty', 'loading', 'lost',
      'error', 'recorded', 'region-grid', 'region-card', 'fogged', 'back',
      'note-detail', 'notes-view', 'detail', 'evidence', 'activities',
      'record-form', 'form-foot', 'hunt', 'hunt-start', 'hunt-meta',
      'hunt-binding', 'terminal',
    ]
    const found: string[] = []
    for (const file of await sources(CLIENT)) {
      const text = await readFile(file, 'utf8')
      for (const match of text.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
        for (const name of (match[1] ?? match[2] ?? '').split(/[\s${}()?:'"]+/)) {
          if (orphaned.includes(name)) found.push(`${file}: ${name}`)
        }
      }
    }
    expect(found).toEqual([])
  })

  it('keeps the design tokens the utilities are named after', async () => {
    // `border-line` and `text-ink-soft` exist only because @theme declares
    // them. Deleting a token turns every utility that uses it into a no-op
    // rather than an error.
    const css = await readFile(join(CLIENT, 'app.css'), 'utf8')
    for (const token of [
      '--color-ink', '--color-ink-soft', '--color-paper', '--color-raised',
      '--color-line', '--color-accent', '--color-warn', '--spacing-menu',
    ]) {
      expect(css).toContain(token)
    }
  })

  it('gives the terminal a height to measure', async () => {
    const hunt = await readFile(join(CLIENT, 'views/Hunt.tsx'), 'utf8')
    const container = hunt.slice(hunt.indexOf('ref={host}') - 200, hunt.indexOf('ref={host}'))
    expect(container).toMatch(/min-h-|h-full|flex-1/)
  })

  it('still points the stylesheet at Tailwind', async () => {
    const css = await readFile(join(CLIENT, 'app.css'), 'utf8')
    expect(css).toContain("@import 'tailwindcss'")
  })
})
