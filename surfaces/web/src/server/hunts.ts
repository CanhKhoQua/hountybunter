import { randomUUID } from 'node:crypto'
import { spawnAgent, type AgentProcess } from '@hountybunter/adapter-claude-code'

export interface StartOptions {
  command: string
  args?: string[]
  cwd?: string
  cols?: number
  rows?: number
  env?: NodeJS.ProcessEnv
}

/** Newest bytes kept for a client that connects after the agent started talking. */
const BUFFER_BYTES = 8192

export interface Hunt {
  readonly id: string
  readonly pid: number
  readonly startedAt: string
  /** Null while the hunt is alive. Set once, and the hunt stays listed. */
  readonly exitCode: number | null
  /**
   * When the user asked it to end. Distinct from `exitCode`, which stays null
   * until the process actually exits: asking is not the same fact as dying, and
   * filling in a code we were never told would be an invention.
   */
  readonly killedAt: string | null
  buffer(): string
  /** Replays the buffer to the new listener, then streams. Returns an unsubscribe. */
  subscribe(listener: (chunk: string) => void): () => void
  write(data: string): void
  resize(cols: number, rows: number): void
}

interface HuntState extends Hunt {
  agent: AgentProcess
}

/**
 * The live hunts this server is running.
 *
 * Kept in memory on purpose: a running process is not durable state, and a row
 * describing one that died with the server would be a lie the next start has to
 * clean up. What is durable — the session and what it did — arrives through the
 * transcript like any other session.
 */
export class HuntRegistry {
  private readonly hunts = new Map<string, HuntState>()
  private readonly max: number

  constructor(opts: { max?: number } = {}) {
    // A hunt is a whole agent process. Without a ceiling, a page that retries a
    // failing start forks until the machine gives up.
    this.max = opts.max ?? 4
  }

  start(opts: StartOptions): Hunt {
    // A hunt already asked to end does not hold a slot. The ceiling is a guard
    // against forking without limit, not a promise about process count.
    const live = this.list().filter((h) => h.exitCode === null && h.killedAt === null).length
    if (live >= this.max) {
      throw new Error(`already running ${this.max} hunts — end one before starting another`)
    }

    const agent = spawnAgent(opts)
    const id = randomUUID()
    const listeners = new Set<(chunk: string) => void>()
    let buffered = ''

    const hunt: HuntState = {
      id,
      pid: agent.pid,
      startedAt: new Date().toISOString(),
      exitCode: null,
      killedAt: null,
      agent,
      buffer: () => buffered,
      subscribe(listener) {
        // The backlog first, so a tab opened a second late is not blank.
        if (buffered) listener(buffered)
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      write: (data) => agent.write(data),
      resize: (cols, rows) => agent.resize(cols, rows),
    }

    agent.onData((chunk) => {
      buffered = (buffered + chunk).slice(-BUFFER_BYTES)
      for (const listener of listeners) listener(chunk)
    })
    agent.onExit((code) => {
      // Death is a state the user needs to see, so the hunt stays listed with
      // its code rather than vanishing from the registry.
      ;(hunt as { exitCode: number | null }).exitCode = code
      listeners.clear()
    })

    this.hunts.set(id, hunt)
    return hunt
  }

  get(id: string): Hunt | undefined {
    return this.hunts.get(id)
  }

  list(): Hunt[] {
    return [...this.hunts.values()]
  }

  kill(id: string): void {
    const hunt = this.hunts.get(id)
    if (!hunt || hunt.killedAt) return
    ;(hunt as { killedAt: string | null }).killedAt = new Date().toISOString()
    hunt.agent.kill()
  }

  killAll(): void {
    for (const hunt of this.hunts.values()) hunt.agent.kill()
  }
}
