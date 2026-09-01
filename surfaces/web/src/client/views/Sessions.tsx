import { useEffect, useState } from 'react'
import { api, calendarDate, type ActivityRow, type SessionRow } from '../api.js'

export function Sessions({ timeZone }: { timeZone: string }) {
  const [rows, setRows] = useState<SessionRow[] | null>(null)
  const [open, setOpen] = useState<{ session: SessionRow; activities: ActivityRow[] } | null>(null)

  useEffect(() => {
    api.sessions().then((data) => setRows(data.sessions))
  }, [])

  if (open) return <Detail detail={open} timeZone={timeZone} onBack={() => setOpen(null)} />
  if (!rows) return <p className="loading">Reading the index…</p>

  return (
    <div className="rows">
      {rows.map((session) => (
        <button
          key={session.id}
          type="button"
          className="row"
          onClick={() => api.session(session.id).then(setOpen)}
        >
          {/* An absent start time is shown as absent, never as today. */}
          <span className="when">{calendarDate(session.started_at, timeZone) ?? 'undated'}</span>
          <span className="what">{session.title ?? 'untitled session'}</span>
          <span className="branch">{session.branch ?? 'no branch'}</span>
          <span className="tail">{session.activities} activities</span>
          {/* Only a guess is labelled; certainty needs no badge. */}
          {session.correlation === 'guessed' ? <span className="badge">guessed</span> : null}
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

  return (
    <div className="detail">
      <button type="button" className="back" onClick={onBack}>
        Back to sessions
      </button>

      <h3>{session.title ?? 'untitled session'}</h3>
      <p className="sub">
        {calendarDate(session.started_at, timeZone) ?? 'undated'} · {session.activities} activities
        {session.correlation === 'guessed' ? ' · correlation guessed' : ''}
      </p>

      <ul className="activities">
        {activities.map((activity) => (
          <li key={activity.id}>
            <span className="seq">{activity.seq}</span>
            <span className="kind">{activity.kind}</span>
            {activity.tool_name ? <span className="tool">{activity.tool_name}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  )
}
