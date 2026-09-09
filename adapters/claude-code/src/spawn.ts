import { spawn as ptySpawn, type IPty } from '@homebridge/node-pty-prebuilt-multiarch'

export interface SpawnOptions {
  command: string
  args?: string[]
  cwd?: string
  cols?: number
  rows?: number
  env?: NodeJS.ProcessEnv
}

export interface AgentProcess {
  readonly pid: number
  onData(listener: (chunk: string) => void): void
  onExit(listener: (exitCode: number) => void): void
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(): void
}

/**
 * Run an agent CLI in a pseudo-terminal.
 *
 * A pty rather than a pipe because the agent must believe it is interactive:
 * the real `claude` binary draws a terminal UI, reads keys, and asks for
 * confirmation. It is also what preserves the user's own subscription and their
 * whole environment — installed plugins, skills, hooks, MCP servers, CLAUDE.md
 * — because this is the same binary they run themselves, started the same way.
 *
 * The environment is passed through untouched. Nothing here filters what the
 * agent loads; what was loaded is recorded from the transcript instead.
 */
export function spawnAgent(opts: SpawnOptions): AgentProcess {
  let pty: IPty
  try {
    pty = ptySpawn(opts.command, opts.args ?? [], {
      name: 'xterm-256color',
      cols: opts.cols ?? 80,
      rows: opts.rows ?? 24,
      cwd: opts.cwd ?? process.cwd(),
      env: (opts.env ?? process.env) as Record<string, string>,
    })
  } catch (cause) {
    // A native module that will not load is a setup problem, and a stack trace
    // from inside node-pty tells the user nothing they can act on.
    throw new Error(
      `could not start a terminal on ${process.platform}/${process.arch}: ` +
        `@homebridge/node-pty-prebuilt-multiarch failed to load (${String(cause)})`,
    )
  }

  let exited = false

  return {
    pid: pty.pid,
    onData: (listener) => {
      pty.onData(listener)
    },
    onExit: (listener) => {
      pty.onExit(({ exitCode }) => {
        exited = true
        listener(exitCode)
      })
    },
    write: (data) => pty.write(data),
    resize: (cols, rows) => {
      if (!exited) pty.resize(cols, rows)
    },
    kill: () => {
      if (!exited) {
        try {
          pty.kill()
        } catch {
          // Already gone between the check and the call. Nothing to report.
        }
      }
    },
  }
}
