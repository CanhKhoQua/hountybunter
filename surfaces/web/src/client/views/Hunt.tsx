import { useEffect, useRef, useState } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import { api, calendarDate, type HuntRow, type Listing, type RegionRow } from '../api.js'
import { BADGE, BUTTON, FIELD, MUTED, ROW, TALLY } from '../ui/styles.js'

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

  // The field is the only place that says where the list is looking: everything
  // up to its last slash is the directory, so browsing and typing are one act.
  const cut = cwd.lastIndexOf('/')
  const dir = cut >= 0 ? cwd.slice(0, cut + 1) : undefined

  useEffect(() => {
    api
      .directories(dir)
      .then((data) => setListing(data.listing))
      // A path that cannot be listed leaves the list where it was. Emptying it
      // would read as "nothing in here" for what is only a half-typed name.
      .catch(() => undefined)
  }, [dir])

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
    const filter = cwd.slice(cwd.lastIndexOf('/') + 1).toLowerCase()
    const worked = grounds.filter((g) => g.name!.toLowerCase().includes(filter))
    const inside = (listing?.entries ?? []).filter((e) => e.name.toLowerCase().includes(filter))

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
              placeholder={listing?.path ?? '/Users/you/project'}
              spellCheck={false}
              autoComplete="off"
            />
            <button type="submit" className={BUTTON} disabled={!target}>
              {/* A control says what it does, and where. The path above is long
                  enough to be read past. */}
              {named ? `Start hunt in ${named}` : 'Start hunt'}
            </button>
          </div>
          <p className={`m-0 text-[12px] ${MUTED}`}>
            Type or paste a path. Anything after the last slash filters the list.
          </p>
        </div>

        {/* One list, one column of names. Rows are the app's own list row, not
            buttons: a screen of filled accent bars has no primary action left. */}
        <ul className="m-0 flex max-h-96 list-none flex-col overflow-y-auto p-0">
          {worked.map((ground) => (
            <li key={ground.path}>
              <button type="button" className={ROW} onClick={() => setCwd(ground.path!)}>
                <span className={TALLY}>{calendarDate(ground.lastSeenAt, timeZone)}</span>
                <span className="truncate">{ground.name}</span>
                <span className={`truncate text-[12px] ${MUTED}`}>{ground.path}</span>
              </button>
            </li>
          ))}
          {listing?.parent && !filter ? (
            <li>
              <button
                type="button"
                className={ROW}
                onClick={() => setCwd(`${listing.parent}/`.replace(/\/+$/, '/'))}
              >
                <span className={TALLY} />
                <span className={MUTED}>up a level</span>
              </button>
            </li>
          ) : null}
          {inside.map((entry) => (
            <li key={entry.path}>
              <button
                type="button"
                className={ROW}
                onClick={() => setCwd(`${entry.path}/`)}
              >
                {/* Blank, so directory names line up under the worked-in ones. */}
                <span className={TALLY} />
                <span className="truncate">{entry.name}</span>
              </button>
            </li>
          ))}
        </ul>

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
