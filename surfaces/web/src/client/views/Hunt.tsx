import { useEffect, useRef, useState } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import { api, type HuntRow } from '../api.js'

/**
 * A live agent session, in a real terminal.
 *
 * The terminal is the whole point: this is the same `claude` binary the user
 * runs themselves, with their plugins, skills and hooks, drawing its own
 * interface. Nothing here re-implements a chat window over it.
 */
export function Hunt() {
  const [cwd, setCwd] = useState('')
  const [hunt, setHunt] = useState<HuntRow | null>(null)
  const [binding, setBinding] = useState<HuntRow['binding']>(null)
  const [exit, setExit] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const host = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!hunt) return
    const element = host.current
    if (!element) return

    const term = new Terminal({ convertEol: false, fontSize: 13, cursorBlink: true })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(element)

    const resize = () => {
      try {
        fit.fit()
      } catch {
        // Measuring needs a laid-out element. If it cannot be measured yet the
        // terminal keeps its default size rather than the page failing to load.
        return
      }
      void api.resizeHunt(hunt.id, term.cols, term.rows)
    }
    resize()
    window.addEventListener('resize', resize)

    const typed = term.onData((data) => void api.sendInput(hunt.id, data))

    const stream = new EventSource(`/api/hunts/${hunt.id}/stream`)
    stream.onmessage = (event: { data: string }) => {
      const frame = JSON.parse(event.data) as { output?: string; exit?: number }
      if (frame.output !== undefined) term.write(frame.output)
      if (frame.exit !== undefined) {
        setExit(frame.exit)
        stream.close()
      }
    }

    return () => {
      window.removeEventListener('resize', resize)
      typed.dispose()
      stream.close()
      term.dispose()
    }
  }, [hunt])

  // Re-asked while the hunt runs: a hook is fire-and-forget and can arrive
  // after the first paint, turning a guess into certainty.
  useEffect(() => {
    if (!hunt || exit !== null) return
    let live = true
    const ask = () => {
      void api.hunt(hunt.id).then((data) => {
        if (live) setBinding(data.hunt.binding)
      })
    }
    ask()
    const timer = setInterval(ask, 2000)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [hunt, exit])

  if (!hunt) {
    return (
      <form
        className="hunt-start"
        onSubmit={(event) => {
          event.preventDefault()
          setError(null)
          api
            .startHunt(cwd)
            .then((data) => setHunt(data.hunt))
            .catch((cause: Error) => setError(cause.message))
        }}
      >
        <label htmlFor="hunt-cwd">Working directory</label>
        <input
          id="hunt-cwd"
          value={cwd}
          onChange={(event) => setCwd(event.target.value)}
          placeholder="/Users/you/project"
        />
        <button type="submit" disabled={!cwd.trim()}>
          Start a hunt
        </button>
        {error ? <p className="error">{error}</p> : null}
      </form>
    )
  }

  return (
    <div className="hunt">
      <p className="hunt-meta">
        <code>{hunt.command}</code> in <code>{hunt.cwd}</code>
        {exit === null ? null : <strong> · exited with {exit}</strong>}
      </p>
      <p className="hunt-binding">
        {binding ? (
          <>
            session <code>{binding.sessionId}</code>
            {/* Only a guess is labelled. Certainty needs no badge, and a guess
                must never be shown as anything else. */}
            {binding.correlation === 'guessed' ? <span className="badge">guessed</span> : null}
          </>
        ) : (
          'not bound to a transcript yet'
        )}
      </p>
      <div className="terminal" ref={host} />
    </div>
  )
}
