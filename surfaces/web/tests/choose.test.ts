import { describe, expect, it } from 'vitest'
import { chooseDirectory } from '../src/server/choose.js'

/** A stand-in for the operating system's folder chooser. */
const chooser = (command: string) => ({ HOUNTYBUNTER_CHOOSER: command }) as NodeJS.ProcessEnv

describe('chooseDirectory', () => {
  it('returns the directory the chooser reported', async () => {
    expect(await chooseDirectory(chooser('echo /Users/you/project'))).toBe('/Users/you/project')
  })

  it('trims the trailing slash AppleScript adds', async () => {
    // `POSIX path of` returns /Users/you/project/, and a cwd that differs only
    // by a trailing slash is the same directory wearing a different name.
    expect(await chooseDirectory(chooser('echo /Users/you/project/'))).toBe('/Users/you/project')
  })

  it('reads a cancelled dialog as cancelled, not as a failure', async () => {
    // Cancelling is the normal way to close a chooser. `osascript` exits
    // non-zero for it, and that must not reach the user as something broken.
    expect(await chooseDirectory(chooser('exit 1'))).toBe(null)
  })

  it('reports nothing when the chooser prints nothing', async () => {
    expect(await chooseDirectory(chooser('true'))).toBe(null)
  })

  it('keeps the last line, so a chooser that also warns still answers', async () => {
    expect(await chooseDirectory(chooser('echo noise; echo /Users/you/project'))).toBe(
      '/Users/you/project',
    )
  })
})
