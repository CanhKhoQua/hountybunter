import { useEffect, useState, type FormEvent } from 'react'
import { api, type Note, type NoteHit } from '../api.js'

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
    <div className="notes-view">
      <form onSubmit={search} role="search">
        <input
          type="search"
          value={query}
          placeholder="Search decisions, including the reasons options lost"
          onChange={(e) => setQuery(e.target.value)}
        />
      </form>

      {open ? <Detail note={open} onBack={() => setOpen(null)} /> : null}

      {!open && hits && hits.length === 0 ? <p className="empty">No matches.</p> : null}

      {!open && hits
        ? hits.map((hit) => (
            <button
              key={hit.id}
              type="button"
              className="row"
              onClick={() => api.note(hit.id).then((data) => setOpen(data.note))}
            >
              <span className="what">{hit.title}</span>
              <span className="tail">{hit.status}</span>
            </button>
          ))
        : null}
    </div>
  )
}

function Detail({ note, onBack }: { note: Note; onBack: () => void }) {
  return (
    <article className="note-detail">
      <button type="button" className="back" onClick={onBack}>
        Back to notes
      </button>

      <h3>{note.title}</h3>

      <dl>
        <dt>Question</dt>
        <dd>{note.question}</dd>
        <dt>Chosen</dt>
        <dd>{note.chosen}</dd>
      </dl>

      {/* What lost is shown at the same weight as what won: it is the half of
          the record that git cannot reconstruct. */}
      {note.rejected.map((option) => (
        <p key={option.option} className="lost">
          <b>{option.option}</b> <span>lost — {option.why_not}</span>
        </p>
      ))}

      <ul className="evidence">
        {note.evidence.map((item) => (
          <li key={`${item.kind}:${item.ref}`}>
            {item.kind}:{item.ref}
          </li>
        ))}
      </ul>
    </article>
  )
}
