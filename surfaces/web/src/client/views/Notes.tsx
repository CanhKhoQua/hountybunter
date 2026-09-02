import { useEffect, useState, type FormEvent } from 'react'
import { api, type Note, type NoteHit } from '../api.js'
import { Pager } from '../ui/Pager.js'
import { BACK, FIELD, MUTED, ROW, TALLY } from '../ui/styles.js'

/** Notes per page. */
const PAGE = 50

export function Notes() {
  const [hits, setHits] = useState<NoteHit[] | null>(null)
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [query, setQuery] = useState('')
  const [searched, setSearched] = useState('')
  const [open, setOpen] = useState<Note | null>(null)

  useEffect(() => {
    // A search is ranked by relevance rather than ordered, so the server does
    // not page it and sends no total. Paging into rank is not a window a reader
    // can hold, so a search shows its one page of best matches.
    api.notes(searched || undefined, searched ? undefined : { limit: PAGE, offset }).then((data) => {
      setHits(data.notes)
      setTotal(data.total ?? data.notes.length)
    })
  }, [searched, offset])

  function search(event: FormEvent) {
    event.preventDefault()
    setOpen(null)
    // Back to the first page: an offset carried into a differently ordered
    // result set asks for a window that means nothing.
    setOffset(0)
    setSearched(query.trim())
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

      {/* Not while a note is open, and not over a search: a search returns its
          one page of best matches, so there is no second page to offer. */}
      {!open && !searched ? (
        <Pager offset={offset} limit={PAGE} total={total} onOffset={setOffset} />
      ) : null}
    </div>
  )
}

function Detail({ note, onBack }: { note: Note; onBack: () => void }) {
  return (
    <article>
      <button type="button" className={`${BACK} mb-3`} onClick={onBack}>
        Back to notes
      </button>

      <h3 className="m-0 text-base font-semibold">{note.title}</h3>

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
