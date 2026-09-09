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

describe('the interface can be driven from the keyboard, and says where it is', () => {
  it('gives every shared interactive style a focus ring of its own', async () => {
    // These are all custom-painted buttons. The UA's default ring is drawn
    // against `bg-accent` and `bg-raised` at a contrast nobody can follow, so
    // tabbing through the app was invisible.
    const styles = await readFile(join(CLIENT, 'ui/styles.ts'), 'utf8')
    // The rings are named constants, so a declaration earns its ring either by
    // spelling the utility out or by composing one of them in.
    const rings = [...styles.matchAll(/^const (\w*RING) =/gm)].map((m) => m[1])
    expect(rings.length, 'styles.ts declares no ring constant').toBeGreaterThan(0)

    for (const name of ['ROW', 'BACK', 'FIELD', 'BUTTON']) {
      const start = styles.indexOf(`export const ${name} =`)
      const declaration = styles.slice(start, styles.indexOf('export const', start + 10))
      const ringed =
        /focus-visible:/.test(declaration) || rings.some((ring) => declaration.includes(ring))
      expect(ringed, `${name} has no focus-visible ring`).toBe(true)
    }
  })

  it('leaves outer margin off the shared button, so it can sit in a row', async () => {
    // `BACK` carried `mb-3` for the two detail views that wanted it. Reused
    // beside an input, that margin lifted the button off the baseline of the
    // row it was in.
    const styles = await readFile(join(CLIENT, 'ui/styles.ts'), 'utf8')
    const start = styles.indexOf('export const BACK =')
    const declaration = styles.slice(start, styles.indexOf('export const', start + 10))
    expect(declaration).not.toMatch(/\bm[btlrxy]?-\d/)
  })

  it('keeps roadmap language out of the interface', async () => {
    // Which phase built a thing is a fact about us, not about the user's work.
    // Comments are stripped first: they are where that fact belongs, and a
    // check that forbade it there would forbid explaining the copy at all.
    for (const file of await sources(CLIENT)) {
      const copy = (await readFile(file, 'utf8'))
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '')
      expect(copy, file).not.toMatch(/phase \d/i)
    }
  })

  it('paints the terminal the colour the stylesheet reserves for it', async () => {
    // xterm draws its own background over the element it is opened in, so the
    // wrapper's colour was never the one on screen. Both have to be told, and
    // both have to agree.
    const css = await readFile(join(CLIENT, 'app.css'), 'utf8')
    const token = css.match(/--color-pit:\s*(#[0-9a-f]{6})/i)
    expect(token, 'app.css declares no --color-pit').toBeTruthy()

    const hunt = await readFile(join(CLIENT, 'views/Hunt.tsx'), 'utf8')
    expect(hunt).toContain('bg-pit')
    expect(hunt.toLowerCase()).toContain(token![1].toLowerCase())
  })
})
