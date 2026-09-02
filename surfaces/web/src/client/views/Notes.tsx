import { useEffect, useState, type FormEvent } from 'react'
import { api, type Note, type NoteHit } from '../api.js'
import { BACK, FIELD, MUTED, ROW, TALLY } from '../ui/styles.js'

export function Notes() {
  const [hits, setHits] = useState<NoteHit[] | null>(null)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<Note | null>(null)

  useEffect(() => {
    api.notes().then((data) => setHits(data.notes))
  }, [])

  function search(event: FormEvent) {
    event.preventDefault()
    api.notes(query.trim() || undefined).then((data) => {
      setOpen(null)
      setHits(data.notes)
    })
  }

  return (
    <div>
      <form onSubmit={search} role="search">
        <input
          type="search"
          className={`mb-3 w-full max-w-160 ${FIELD}`}
          value={query}
          placeholder="Search decisions, including the reasons options lost"
          onChange={(e) => setQuery(e.target.value)}
        />
      </form>

      {open ? <Detail note={open} onBack={() => setOpen(null)} /> : null}

      {!open && hits && hits.length === 0 ? (
        <p className={`py-3 ${MUTED}`}>No matches.</p>
      ) : null}

      {!open && hits
        ? hits.map((hit) => (
            <button
              key={hit.id}
              type="button"
              className={ROW}
              onClick={() => api.note(hit.id).then((data) => setOpen(data.note))}
            >
              <span className="col-span-2 overflow-hidden text-ellipsis whitespace-nowrap">
                {hit.title}
              </span>
              <span className={TALLY}>{hit.status}</span>
            </button>
          ))
        : null}
    </div>
  )
}

function Detail({ note, onBack }: { note: Note; onBack: () => void }) {
  return (
    <article>
      <button type="button" className={BACK} onClick={onBack}>
        Back to notes
      </button>

      <h3>{note.title}</h3>

      <dl>
        <dt className={`mt-2.5 text-xs ${MUTED}`}>Question</dt>
        <dd className="m-0">{note.question}</dd>
        <dt className={`mt-2.5 text-xs ${MUTED}`}>Chosen</dt>
        <dd className="m-0">{note.chosen}</dd>
      </dl>

      {/* What lost is shown at the same weight as what won: it is the half of
          the record that git cannot reconstruct. */}
      {note.rejected.map((option) => (
        <p key={option.option} className={`py-1 ${MUTED}`}>
          <b>{option.option}</b> <span>lost — {option.why_not}</span>
        </p>
      ))}

      <ul className={`mt-3 text-[13px] ${MUTED}`}>
        {note.evidence.map((item) => (
          <li key={`${item.kind}:${item.ref}`}>
            {item.kind}:{item.ref}
          </li>
        ))}
      </ul>
    </article>
  )
}
