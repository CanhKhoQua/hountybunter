import { useEffect, useRef, useState } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import { api, calendarDate, type HuntRow, type RegionRow } from '../api.js'
import { BACK, BADGE, BUTTON, FIELD, MUTED, TALLY } from '../ui/styles.js'

/**
 * A live agent session, in a real terminal.
 *
 * The terminal is the whole point: this is the same `claude` binary the user
 * runs themselves, with their plugins, skills and hooks, drawing its own
 * interface. Nothing here re-implements a chat window over it.
 */
/**
 * A place to work: its name, and when it was last worked in.
 *
 * `ROW` leads with a fixed 92px column, which is right for Sessions where the
 * date is the sort key and wrong here, where the name is the answer.
 */
const PLACE =
  'grid w-full grid-cols-[minmax(0,1fr)_auto] items-baseline gap-2.5 ' +
  'cursor-pointer border-0 border-b border-line bg-transparent px-1.5 py-2 ' +
  'text-left font-[inherit] text-inherit hover:bg-raised ' +
  'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent'

/** `--color-pit` from app.css, which xterm cannot read for itself. */
const PIT = '#14120f'

/** Quiet, but bordered in warn: stopping an agent is not an idle click. */
const STOP = `${BACK} border-warn text-warn`

/** How many places are worth calling recent before the list needs asking for. */
const RECENT = 8

export function Hunt({ timeZone }: { timeZone: string }) {
  const [cwd, setCwd] = useState('')
  const [grounds, setGrounds] = useState<RegionRow[]>([])
  const [showAllGrounds, setShowAllGrounds] = useState(false)
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
    // Leaving this view unmounts it and the terminal goes with it, but the
    // agent does not: the server holds the process and replays its last output
    // to a new subscriber. So on arrival, ask what is still running rather than
    // offering to start something — a session that is alive must not be shown
    // as gone. This also covers a reload and a second tab, which keeping the
    // component mounted would not.
    api
      .hunts()
      .then((data) => {
        const live = data.hunts
          .filter((row) => row.exitCode === null && row.killedAt === null)
          // Newest, when more than one is running: the one just left behind.
          .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
        if (live[0]) setHunt(live[0])
      })
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    if (!hunt) return
    const element = host.current
    if (!element) return

    const term = new Terminal({
      convertEol: false,
      fontSize: 13,
      cursorBlink: true,
      // xterm paints its own background over the element it is opened in, so
      // the wrapper's colour was never the one on screen — only its padding
      // frame showed. It parses colours itself and cannot read a custom
      // property, so `--color-pit` is repeated here and a test holds the two
      // together.
      theme: { background: PIT, foreground: '#ece8e3' },
    })
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

  // Signalled, not assumed dead: the exit arrives on the stream like any other,
  // so the terminal keeps whatever the agent says on its way out.
  const stop = () => {
    if (!hunt) return
    setError(null)
    api.stopHunt(hunt.id).catch((cause: Error) => setError(cause.message))
  }

  /** Lets go of a hunt that has ended, which is the only way back to the form. */
  const dismiss = () => {
    setHunt(null)
    setExit(null)
    setBinding(null)
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
          </div>
        </div>

        {/*
          On its own line, not in the row above. The label carries the directory
          name, so it grows a character at a time as the field is typed into —
          sharing a row with the input made both jump on every keystroke.
        */}
        <button type="submit" className={BUTTON} disabled={!target}>
          {/* A control says what it does, and where. The path beside it is long
              enough to be read past. */}
          {named ? `Start hunt in ${named}` : 'Start hunt'}
        </button>

        {grounds.length > 0 ? (
          <div className="flex flex-col">
            <h2 className={`m-0 pb-1 text-[12px] uppercase tracking-wide ${MUTED}`}>
              Where you work
            </h2>
            {/*
              Capped rather than paged. This is a picker inside a form and it is
              the *recent* list: page three of "recent" answers nobody's
              question, and a long one would push the form off the screen.
            */}
            {/* The app's own list row, not buttons: a screen of filled accent
                bars leaves no primary action on it. */}
            {(showAllGrounds ? grounds : grounds.slice(0, RECENT)).map((ground) => (
              <button
                key={ground.path}
                type="button"
                className={PLACE}
                onClick={() => setCwd(ground.path!)}
              >
                {/* The project, said plainly. It is what the user is looking
                    for, so it reads first; the path it stands for lands in the
                    field on click, which is where a path belongs. */}
                <span className="truncate">{ground.name}</span>
                <span className={`text-[12px] ${TALLY}`}>
                  {calendarDate(ground.lastSeenAt, timeZone)}
                </span>
              </button>
            ))}

            {!showAllGrounds && grounds.length > RECENT ? (
              <button
                type="button"
                className={`${BACK} mt-2 self-start`}
                onClick={() => setShowAllGrounds(true)}
              >
                Show all {grounds.length} places
              </button>
            ) : null}
          </div>
        ) : null}

        {error ? <p className="m-0 text-[13px] text-warn">{error}</p> : null}
      </form>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-1.5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className={`m-0 truncate text-[13px] ${MUTED}`}>
            <code className="text-ink">{hunt.command}</code> in{' '}
            <code className="text-ink">{hunt.cwd}</code>
          </p>
          <p className={`m-0 flex items-center gap-2 text-[13px] ${MUTED}`}>
            {binding ? (
              <>
                session <code className="text-ink">{binding.sessionId}</code>
                {/* Only a guess is labelled. Certainty needs no badge, and a
                    guess must never be shown as anything else. */}
                {binding.correlation === 'guessed' ? <span className={BADGE}>guessed</span> : null}
              </>
            ) : (
              'not bound to a transcript yet'
            )}
          </p>
        </div>

        {/*
          One control, and which one says which state this is in. Running, the
          only thing worth offering is a way out — without it, killing the
          server was the only way to stop an agent. Ended, the terminal is a
          transcript nothing will write to again, and dismissing it is the only
          way back to the form; there was none, so starting another meant
          reloading the page.
        */}
        <div className="flex shrink-0 items-center gap-2">
          {exit === null ? (
            <button type="button" className={STOP} onClick={stop}>
              Stop hunt
            </button>
          ) : (
            <button type="button" className={BUTTON} onClick={dismiss}>
              Start another hunt
            </button>
          )}
        </div>
      </div>

      {/* Said in a line of its own. Tucked into the end of the command line, in
          the same muted grey, a process dying read as decoration. */}
      {exit === null ? null : (
        <p className="m-0 text-[13px] text-warn">
          Exited with {exit}. What is below is what it left behind.
        </p>
      )}

      {error ? <p className="m-0 text-[13px] text-warn">{error}</p> : null}
      {/*
        A real box to measure. xterm's fit addon reads this element's size;
        without a height it computes a nonsense grid, so `min-h-80 flex-1` is
        load-bearing, not decoration.
      */}
      <div className="min-h-80 flex-1 rounded border border-line bg-pit p-2" ref={host} />
    </div>
  )
}
