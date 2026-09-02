import { useEffect, useState } from 'react'
import { api, calendarDate, type ActivityRow, type SessionRow } from '../api.js'
import { Pager } from '../ui/Pager.js'
import { BACK, BADGE, MUTED, ROW, TALLY } from '../ui/styles.js'
import { RecordForm } from './RecordForm.js'

/** Sessions per page. The index runs to hundreds on a machine in daily use. */
const PAGE = 50

/**
 * Activities per page. The longest transcripts run to thousands of rows, which
 * is what used to be cut to 500 and served without a word.
 */
const ACTIVITY_PAGE = 100

export function Sessions({ timeZone }: { timeZone: string }) {
  const [rows, setRows] = useState<SessionRow[] | null>(null)
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  // The id, not the record: the record is whatever the current activity page
  // answered with, so one fetch owns it rather than a click and an effect both
  // writing it.
  const [openId, setOpenId] = useState<string | null>(null)
  const [detail, setDetail] = useState<Detail | null>(null)
  const [activityOffset, setActivityOffset] = useState(0)

  useEffect(() => {
    // From the server, keyed on the offset: the list this is a window onto is
    // longer than anything the client is ever sent, so a page cannot be a
    // slice of what is already here.
    api.sessions({ limit: PAGE, offset }).then((data) => {
      setRows(data.sessions)
      setTotal(data.total)
    })
  }, [offset])

  useEffect(() => {
    if (!openId) return
    api.session(openId, { limit: ACTIVITY_PAGE, offset: activityOffset }).then(setDetail)
  }, [openId, activityOffset])

  const close = () => {
    setOpenId(null)
    setDetail(null)
  }

  if (openId) {
    if (!detail) return <p className={`py-3 ${MUTED}`}>Reading the session…</p>
    return (
      <SessionDetail
        detail={detail}
        timeZone={timeZone}
        offset={activityOffset}
        onOffset={setActivityOffset}
        onBack={close}
      />
    )
  }
  if (!rows) return <p className={`py-3 ${MUTED}`}>Reading the index…</p>
  // An empty index and a broken one look identical when the answer to both is
  // a blank page. The one that is fixable has to say so.
  if (rows.length === 0) {
    return (
      <p className={`py-3 ${MUTED}`}>
        No sessions indexed yet. Run <code>hb ingest</code> to read the transcripts on this
        machine.
      </p>
    )
  }

  return (
    <div className="flex flex-col">
      {rows.map((session) => (
        <button
          key={session.id}
          type="button"
          className={ROW}
          onClick={() => {
            setActivityOffset(0)
            setOpenId(session.id)
          }}
        >
          {/* An absent start time is shown as absent, never as today. */}
          <span className={TALLY}>{calendarDate(session.started_at, timeZone) ?? 'undated'}</span>
          <span className="overflow-hidden text-ellipsis whitespace-nowrap">
            {session.title ?? 'untitled session'}
          </span>
          <span className={`text-[13px] ${MUTED}`}>{session.branch ?? 'no branch'}</span>
          {/* One cell, not two: the row grid has four columns, and a badge given
              its own fell past the last one onto an implicit row, doubling the
              height of exactly the rows that carry it. */}
          <span className="flex items-baseline gap-2">
            <span className={TALLY}>{session.activities} activities</span>
            {/* Only a guess is labelled; certainty needs no badge. */}
            {session.correlation === 'guessed' ? <span className={BADGE}>guessed</span> : null}
          </span>
        </button>
      ))}
      <Pager offset={offset} limit={PAGE} total={total} onOffset={setOffset} />
    </div>
  )
}

/** One session with the page of its transcript that is currently on screen. */
interface Detail {
  session: SessionRow
  activities: ActivityRow[]
  total: number
}

function SessionDetail({
  detail,
  timeZone,
  offset,
  onOffset,
  onBack,
}: {
  detail: Detail
  timeZone: string
  offset: number
  onOffset: (next: number) => void
  onBack: () => void
}) {
  const { session, activities, total } = detail
  const [recorded, setRecorded] = useState<string | null>(null)
  const date = calendarDate(session.started_at, timeZone)

  return (
    <div>
      <button type="button" className={`${BACK} mb-3`} onClick={onBack}>
        Back to sessions
      </button>

      <h3 className="m-0 text-base font-semibold">{session.title ?? 'untitled session'}</h3>
      <p className={`mt-1 mb-0 text-[13px] ${MUTED}`}>
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

      {/* The one list in the app still drawn by the browser: default bullets and
          default indent, sitting beside rows that set their own everything. */}
      <ul className="m-0 mt-4 list-none p-0">
        {activities.map((activity) => (
          <li
            key={activity.id}
            className={
              'grid grid-cols-[3rem_6rem_minmax(0,1fr)] items-baseline gap-2.5 ' +
              'border-b border-line py-1.5 text-[13px]'
            }
          >
            <span className={TALLY}>{activity.seq}</span>
            <span>{activity.kind}</span>
            <span className={`truncate ${MUTED}`}>{activity.tool_name ?? ''}</span>
          </li>
        ))}
      </ul>
      <Pager offset={offset} limit={ACTIVITY_PAGE} total={total} onOffset={onOffset} />
    </div>
  )
}
