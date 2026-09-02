import { useEffect, useRef, useState } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import { api, type HuntRow, type Listing, type RegionRow } from '../api.js'
import { BADGE, BUTTON, FIELD, MUTED } from '../ui/styles.js'

/**
 * A live agent session, in a real terminal.
 *
 * The terminal is the whole point: this is the same `claude` binary the user
 * runs themselves, with their plugins, skills and hooks, drawing its own
 * interface. Nothing here re-implements a chat window over it.
 */
export function Hunt() {
  const [cwd, setCwd] = useState('')
  const [grounds, setGrounds] = useState<RegionRow[]>([])
  const [listing, setListing] = useState<Listing | null>(null)
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

  useEffect(() => {
    browse()
    // Home, once. Where the browser goes after that is the user's business.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  const browse = (where?: string) => {
    api
      .directories(where)
      .then((data) => setListing(data.listing))
      // A directory that cannot be listed leaves the browser where it was,
      // rather than emptying it and reading as "nothing in here".
      .catch(() => undefined)
  }

  const start = (where: string) => {
    setError(null)
    api
      .startHunt(where)
      .then((data) => setHunt(data.hunt))
      .catch((cause: Error) => setError(cause.message))
  }

  if (!hunt) {
    return (
      <form
        className="flex max-w-160 flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          start(cwd)
        }}
      >
        {grounds.length > 0 ? (
          <>
            <h2 className="m-0 text-sm font-semibold">Where you have hunted before</h2>
            <ul className="m-0 flex list-none flex-col gap-1 p-0">
              {grounds.map((ground) => (
                <li key={ground.path}>
                  <button
                    type="button"
                    className={`${BUTTON} w-full justify-start text-left`}
                    onClick={() => start(ground.path!)}
                  >
                    Hunt in {ground.name}
                    <span className={`ml-2 truncate text-[12px] ${MUTED}`}>{ground.path}</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : null}
        {listing ? (
          <>
            <h2 className="m-0 text-sm font-semibold">Anywhere else</h2>
            <div className="flex items-center gap-2">
              <code className="grow truncate text-[12px]">{listing.path}</code>
              <button type="button" className={BUTTON} onClick={() => start(listing.path)}>
                Hunt here
              </button>
            </div>
            <ul className="m-0 flex max-h-64 list-none flex-col gap-1 overflow-y-auto p-0">
              {listing.parent ? (
                <li>
                  <button
                    type="button"
                    className={`${BUTTON} w-full justify-start text-left`}
                    onClick={() => browse(listing.parent!)}
                  >
                    Up one level
                  </button>
                </li>
              ) : null}
              {listing.entries.map((entry) => (
                <li key={entry.path}>
                  <button
                    type="button"
                    className={`${BUTTON} w-full justify-start text-left`}
                    onClick={() => browse(entry.path)}
                  >
                    Open {entry.name}
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : null}
        <label htmlFor="hunt-cwd">Another directory</label>
        <input
          id="hunt-cwd"
          className={FIELD}
          value={cwd}
          onChange={(event) => setCwd(event.target.value)}
          placeholder="/Users/you/project"
        />
        <button type="submit" className={BUTTON} disabled={!cwd.trim()}>
          Start a hunt
        </button>
        {error ? <p className="text-red-700">{error}</p> : null}
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
