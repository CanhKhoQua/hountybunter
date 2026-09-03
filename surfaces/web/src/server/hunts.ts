import { randomUUID } from 'node:crypto'
import { spawnAgent, type AgentProcess } from '@hountybunter/adapter-claude-code'

export interface StartOptions {
  command: string
  args?: string[]
  cwd?: string
  cols?: number
  rows?: number
  env?: NodeJS.ProcessEnv
  /**
   * Highest hook id seen before this process existed. Taken at spawn because it
   * cannot be recovered afterwards: a moment later, this hunt's own hooks are
   * already indistinguishable from those of a session that was running first.
   */
  sinceHookId?: number
}

/** Newest bytes kept for a client that connects after the agent started talking. */
const BUFFER_BYTES = 8192

export interface Hunt {
  readonly id: string
  readonly pid: number
  readonly startedAt: string
  readonly cwd: string
  readonly sinceHookId: number
  /** Null while the hunt is alive. Set once, and the hunt stays listed. */
  readonly exitCode: number | null
  /**
   * When the user asked it to end. Distinct from `exitCode`, which stays null
   * until the process actually exits: asking is not the same fact as dying, and
   * filling in a code we were never told would be an invention.
   */
  readonly killedAt: string | null
  buffer(): string
  /**
   * Replays the buffer to the new listener, then streams. `onEnd` fires when
   * the process is gone — immediately if it already was, so a client attaching
   * to a finished hunt is told so rather than left holding a connection that
   * will never produce another byte. Returns an unsubscribe.
   */
  subscribe(
    /** `at` is the position in the output after this chunk: where to resume. */
    listener: (chunk: string, at: number) => void,
    onEnd?: () => void,
    /** Resume after this position, from a client that has seen that much. */
    since?: number,
  ): () => void
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
  private readonly keepDead: number

  constructor(opts: { max?: number; keepDead?: number } = {}) {
    // A hunt is a whole agent process. Without a ceiling, a page that retries a
    // failing start forks until the machine gives up.
    this.max = opts.max ?? 4
    // Death is a state, but not a permanent one in memory: each dead hunt holds
    // its output buffer, and a server left running for a week would accumulate
    // every hunt it ever ran.
    this.keepDead = opts.keepDead ?? 20
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
    // `at` is the position to resume after, handed to every listener alongside
    // the bytes. The element type went un-updated when it was added, and
    // `tsc -b`'s incremental cache kept the mismatch invisible until an
    // unrelated change to `core` forced this project to be re-checked.
    const listeners = new Set<{ data: (chunk: string, at: number) => void; end?: () => void }>()
    let buffered = ''
    // Everything ever produced, counted. `buffered` keeps only the tail, so it
    // cannot say where in the output a client has got to.
    let emitted = 0

    const hunt: HuntState = {
      id,
      pid: agent.pid,
      startedAt: new Date().toISOString(),
      cwd: opts.cwd ?? process.cwd(),
      sinceHookId: opts.sinceHookId ?? 0,
      exitCode: null,
      killedAt: null,
      agent,
      buffer: () => buffered,
      subscribe(listener, onEnd, since) {
        // The backlog first, so a tab opened a second late is not blank — but
        // only the part this client has not seen. A browser reconnects on its
        // own and reports the last id it received; replaying everything to it
        // prints the last screen twice.
        //
        // The buffer covers [emitted - buffered.length, emitted). A client
        // that fell further behind than that cannot be caught up exactly, so
        // it gets what is left: a screen missing its oldest lines beats a
        // blank one, and beats pretending nothing happened.
        const held = emitted - buffered.length
        const from = since === undefined ? held : Math.max(since, held)
        const backlog = from >= emitted ? '' : buffered.slice(from - held)
        if (backlog) listener(backlog, emitted)
        if (hunt.exitCode !== null) {
          onEnd?.()
          return () => undefined
        }
        const entry = { data: listener, end: onEnd }
        listeners.add(entry)
        return () => listeners.delete(entry)
      },
      write: (data) => agent.write(data),
      resize: (cols, rows) => agent.resize(cols, rows),
    }

    agent.onData((chunk) => {
      buffered = (buffered + chunk).slice(-BUFFER_BYTES)
      // Counted before the listeners are told, so the position they are given
      // is the one to resume after — the end of what they have just received.
      emitted += chunk.length
      for (const listener of listeners) listener.data(chunk, emitted)
    })
    agent.onExit((code) => {
      // Death is a state the user needs to see, so the hunt stays listed with
      // its code rather than vanishing from the registry.
      ;(hunt as { exitCode: number | null }).exitCode = code
      // Tell them, then forget them. Clearing without telling leaves every open
      // stream waiting on a process that will never speak again.
      for (const listener of listeners) listener.end?.()
      listeners.clear()
      this.pruneDead()
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

  /** Keep the most recent dead hunts; a live one is never dropped. */
  private pruneDead(): void {
    const dead = [...this.hunts.values()].filter((h) => h.exitCode !== null)
    for (const hunt of dead.slice(0, Math.max(0, dead.length - this.keepDead))) {
      this.hunts.delete(hunt.id)
    }
  }
}
