import { useEffect, useRef, useState } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import { api, calendarDate, type HuntRow, type RegionRow } from '../api.js'
import { BACK, BADGE, BUTTON, FIELD, MUTED, ROW, TALLY } from '../ui/styles.js'

/**
 * A live agent session, in a real terminal.
 *
 * The terminal is the whole point: this is the same `claude` binary the user
 * runs themselves, with their plugins, skills and hooks, drawing its own
 * interface. Nothing here re-implements a chat window over it.
 */
export function Hunt({ timeZone }: { timeZone: string }) {
  const [cwd, setCwd] = useState('')
  const [grounds, setGrounds] = useState<RegionRow[]>([])
  const [hunt, setHunt] = useState<HuntRow | null>(null)
  const [binding, setBinding] = useState<HuntRow['binding']>(null)
  const [exit, setExit] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const host = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Ordered by when each was last worked in. The server sorts regions by how
    // busy they are, which answers a different question than "where was I".
    api
      .regions()
      .then((data) =>
        setGrounds(
          data.regions
            .filter((region) => region.path)
            .sort((a, b) => (b.lastSeenAt ?? '').localeCompare(a.lastSeenAt ?? '')),
        ),
      )
      .catch(() => setGrounds([]))
  }, [])

  const browse = () => {
    setError(null)
    api
      .browse()
      // A cancelled dialog leaves the field alone: the user closed it rather
      // than choosing nothing.
      .then((data) => data.path && setCwd(data.path))
      .catch((cause: Error) => setError(cause.message))
  }

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

  const start = (where: string) => {
    setError(null)
    api
      .startHunt(where)
      .then((data) => setHunt(data.hunt))
      .catch((cause: Error) => setError(cause.message))
  }

  if (!hunt) {
    const target = cwd.trim().replace(/\/+$/, '')
    const named = target.slice(target.lastIndexOf('/') + 1)

    return (
      <form
        className="flex max-w-160 flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          start(cwd)
        }}
      >
        <div className="flex flex-col gap-1.5">
          <label htmlFor="hunt-cwd" className="text-[13px]">
            Working directory
          </label>
          <div className="flex items-center gap-2">
            <input
              id="hunt-cwd"
              className={`${FIELD} grow font-mono text-[13px]`}
              value={cwd}
              onChange={(event) => setCwd(event.target.value)}
              placeholder="/Users/you/project"
              spellCheck={false}
              autoComplete="off"
            />
            {/* The desktop's own chooser, opened by the server. A page cannot
                learn the absolute path of a directory a person picks. */}
            <button type="button" className={BACK} onClick={browse}>
              Browse…
            </button>
            <button type="submit" className={BUTTON} disabled={!target}>
              {/* A control says what it does, and where. The path beside it is
                  long enough to be read past. */}
              {named ? `Start hunt in ${named}` : 'Start hunt'}
            </button>
          </div>
        </div>

        {grounds.length > 0 ? (
          <div className="flex flex-col">
            <h2 className={`m-0 pb-1 text-[12px] uppercase tracking-wide ${MUTED}`}>
              Where you work
            </h2>
            {/* The app's own list row, not buttons: a screen of filled accent
                bars leaves no primary action on it. */}
            {grounds.map((ground) => (
              <button
                key={ground.path}
                type="button"
                className={ROW}
                onClick={() => setCwd(ground.path!)}
              >
                <span className={TALLY}>{calendarDate(ground.lastSeenAt, timeZone)}</span>
                <span className="truncate">{ground.name}</span>
                <span className={`truncate text-[12px] ${MUTED}`}>{ground.path}</span>
              </button>
            ))}
          </div>
        ) : null}

        {error ? <p className="m-0 text-[13px] text-warn">{error}</p> : null}
      </form>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-1.5">
      <p className={`m-0 text-[13px] ${MUTED}`}>
        <code className="text-ink">{hunt.command}</code> in{' '}
        <code className="text-ink">{hunt.cwd}</code>
        {exit === null ? null : <strong> · exited with {exit}</strong>}
      </p>
      <p className={`m-0 flex items-center gap-2 text-[13px] ${MUTED}`}>
        {binding ? (
          <>
            session <code className="text-ink">{binding.sessionId}</code>
            {/* Only a guess is labelled. Certainty needs no badge, and a guess
                must never be shown as anything else. */}
            {binding.correlation === 'guessed' ? <span className={BADGE}>guessed</span> : null}
          </>
        ) : (
          'not bound to a transcript yet'
        )}
      </p>
      {/*
        A real box to measure. xterm's fit addon reads this element's size;
        without a height it computes a nonsense grid, so `min-h-80 flex-1` is
        load-bearing, not decoration.
      */}
      <div className="min-h-80 flex-1 rounded border border-line bg-[#101010] p-2" ref={host} />
    </div>
  )
}
