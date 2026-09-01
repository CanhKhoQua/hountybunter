import { useState, type FormEvent } from 'react'
import { slugify } from '../slug.js'

export function RecordForm({
  sessionId,
  date,
  onRecorded,
}: {
  sessionId: string
  date: string
  onRecorded: (noteId: string) => void
}) {
  const [question, setQuestion] = useState('')
  const [chosen, setChosen] = useState('')
  const [option, setOption] = useState('')
  const [whyNot, setWhyNot] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const ready = question.trim() !== '' && chosen.trim() !== ''
  const preview = question.trim() ? `${date}-${slugify(question.trim())}` : ''

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!ready || saving) return
    setSaving(true)
    setError(null)

    // A rejected option with no reason is worth less than none at all, so both
    // halves are required before one is sent.
    const rejected =
      option.trim() && whyNot.trim()
        ? [{ option: option.trim(), why_not: whyNot.trim() }]
        : []

    try {
      const res = await fetch('/api/notes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId, question: question.trim(), chosen: chosen.trim(), rejected }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(String(data.error ?? res.status))
      onRecorded(data.note.id)
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="record-form" onSubmit={submit}>
      <label>
        What was the question?
        <input value={question} onChange={(e) => setQuestion(e.target.value)} />
      </label>

      <label>
        What did you choose?
        <input value={chosen} onChange={(e) => setChosen(e.target.value)} />
      </label>

      <label>
        What lost?
        <input value={option} onChange={(e) => setOption(e.target.value)} />
      </label>

      <label>
        Why did it lose?
        <input value={whyNot} onChange={(e) => setWhyNot(e.target.value)} />
      </label>

      <div className="form-foot">
        <button type="submit" disabled={!ready || saving}>
          {saving ? 'Recording…' : 'Record'}
        </button>
        {preview ? <span className="preview">{preview}</span> : null}
      </div>

      {error ? <p className="error">Could not record it: {error}</p> : null}
    </form>
  )
}
