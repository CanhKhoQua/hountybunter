import { useEffect, useState } from 'react'
import { api, calendarDate, type ActivityRow, type SessionRow } from '../api.js'
import { BACK, BADGE, MUTED, ROW, TALLY } from '../ui/styles.js'
import { RecordForm } from './RecordForm.js'

export function Sessions({ timeZone }: { timeZone: string }) {
  const [rows, setRows] = useState<SessionRow[] | null>(null)
  const [open, setOpen] = useState<{ session: SessionRow; activities: ActivityRow[] } | null>(null)

  useEffect(() => {
    api.sessions().then((data) => setRows(data.sessions))
  }, [])

  if (open) return <Detail detail={open} timeZone={timeZone} onBack={() => setOpen(null)} />
  if (!rows) return <p className={`py-3 ${MUTED}`}>Reading the index…</p>

  return (
    <div className="flex flex-col">
      {rows.map((session) => (
        <button
          key={session.id}
          type="button"
          className={ROW}
          onClick={() => api.session(session.id).then(setOpen)}
        >
          {/* An absent start time is shown as absent, never as today. */}
          <span className={TALLY}>{calendarDate(session.started_at, timeZone) ?? 'undated'}</span>
          <span className="overflow-hidden text-ellipsis whitespace-nowrap">
            {session.title ?? 'untitled session'}
          </span>
          <span className={`text-[13px] ${MUTED}`}>{session.branch ?? 'no branch'}</span>
          <span className={TALLY}>{session.activities} activities</span>
          {/* Only a guess is labelled; certainty needs no badge. */}
          {session.correlation === 'guessed' ? <span className={BADGE}>guessed</span> : null}
        </button>
      ))}
    </div>
  )
}

function Detail({
  detail,
  timeZone,
  onBack,
}: {
  detail: { session: SessionRow; activities: ActivityRow[] }
  timeZone: string
  onBack: () => void
}) {
  const { session, activities } = detail
  const [recorded, setRecorded] = useState<string | null>(null)
  const date = calendarDate(session.started_at, timeZone)

  return (
    <div>
      <button type="button" className={BACK} onClick={onBack}>
        Back to sessions
      </button>

      <h3>{session.title ?? 'untitled session'}</h3>
      <p className={`text-[13px] ${MUTED}`}>
        {calendarDate(session.started_at, timeZone) ?? 'undated'} · {session.activities} activities
        {session.correlation === 'guessed' ? ' · correlation guessed' : ''}
      </p>

      {/* The decision is recorded against the session that produced it, dated
          from when that session ran — not from when it was written up. */}
      {recorded ? (
        <p className="text-accent">Recorded as {recorded}.</p>
      ) : date ? (
        <RecordForm sessionId={session.id} date={date} onRecorded={setRecorded} />
      ) : (
        <p className={`py-3 ${MUTED}`}>
          This session has no start time, so a decision recorded from it would have no
          date to stand on. Re-run <code>hb ingest</code> first.
        </p>
      )}

      <ul className="mt-4">
        {activities.map((activity) => (
          <li key={activity.id}>
            <span className={`mr-2 ${TALLY}`}>{activity.seq}</span>
            <span className={`mr-2 text-[13px] ${MUTED}`}>{activity.kind}</span>
            {activity.tool_name ? (
              <span className={`text-[13px] ${MUTED}`}>{activity.tool_name}</span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  )
}
