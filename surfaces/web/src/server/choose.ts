import { execFile } from 'node:child_process'
import { platform } from 'node:os'

/** The operating system's own folder chooser, per platform. */
const CHOOSERS: Record<string, string> = {
  darwin: `osascript -e 'POSIX path of (choose folder with prompt "Where should the hunt start?")'`,
  linux: 'zenity --file-selection --directory',
}

/**
 * Ask the operating system where to start, and return the directory chosen.
 *
 * The dialog is opened by the server, not the page. A browser never learns the
 * absolute path of a directory a person picks — `webkitdirectory` and
 * `showDirectoryPicker()` both hand back a name and nothing else — so a page
 * cannot answer this question at all. The server can, because it is a process
 * on the same machine as the person clicking: this tool is one local user on
 * loopback by design (spec 2), and that is the assumption that makes a desktop
 * dialog the right control rather than a reimplemented file tree.
 *
 * Null covers every way of not choosing: cancelled, timed out, or no chooser
 * for this platform. The typed field stays for all of them.
 */
export async function chooseDirectory(env: NodeJS.ProcessEnv): Promise<string | null> {
  const command = env.HOUNTYBUNTER_CHOOSER || CHOOSERS[platform()]
  if (!command) return null

  // Nothing from the request reaches this string. The dialog takes no
  // arguments, so there is no caller input to quote or to get wrong.
  const printed = await new Promise<string | null>((resolve) => {
    execFile(
      '/bin/sh',
      ['-c', command],
      // A modal dialog waits for a person. Five minutes is long enough to find
      // a directory, and short enough that a dialog nobody is sitting in front
      // of does not hold the handle open all day.
      { timeout: 5 * 60_000, maxBuffer: 1 << 20 },
      (error, stdout) => {
        // Cancelling is how a chooser is normally closed, and `osascript` exits
        // non-zero for it. Reporting that as a failure would tell the user
        // something broke when they simply chose not to answer.
        if (error) return resolve(null)
        resolve(stdout)
      },
    )
  })
  if (printed === null) return null

  // The last line: a chooser may warn on stdout before it answers.
  const path = printed.trim().split('\n').pop()?.trim() ?? ''
  if (!path) return null

  // `POSIX path of` ends every directory with a slash. Trimmed here so a cwd
  // reads the same whether it was chosen or typed.
  return path.length > 1 ? path.replace(/\/+$/, '') : path
}
