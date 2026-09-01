import { readFile } from 'node:fs/promises'
import { access, constants } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const root = new URL('../../../.claude-plugin/', import.meta.url).pathname

async function json(name: string) {
  return JSON.parse(await readFile(root + name, 'utf8'))
}

describe('the plugin manifest', () => {
  it('declares itself without borrowing the Claude Code name', async () => {
    const plugin = await json('plugin.json')
    expect(plugin.name).toBe('hountybunter')
    // Spec §3.3: the product name may not contain "Claude Code".
    expect(JSON.stringify(plugin)).not.toMatch(/Claude Code/)
  })

  it('routes every event through the one script that cannot fail', async () => {
    const hooks = await json('hooks/hooks.json')
    const commands = JSON.stringify(hooks).match(/"command":\s*"([^"]+)"/g) ?? []

    expect(commands.length).toBeGreaterThan(0)
    for (const command of commands) {
      expect(command).toMatch(/post-event\.sh/)
    }
  })

  it('covers the events a session is actually made of', async () => {
    const hooks = await json('hooks/hooks.json')
    const declared = Object.keys(hooks.hooks)
    for (const event of ['SessionStart', 'SessionEnd', 'PreToolUse', 'PostToolUse', 'Stop']) {
      expect(declared).toContain(event)
    }
  })

  it('hardcodes no port anywhere, so a conflict never means editing settings', async () => {
    const text = await readFile(root + 'hooks/hooks.json', 'utf8')
    expect(text).not.toMatch(/127\.0\.0\.1|localhost|:\d{4}/)
  })

  it('ships the script executable', async () => {
    await expect(access(root + 'hooks/post-event.sh', constants.X_OK)).resolves.toBeUndefined()
  })
})
