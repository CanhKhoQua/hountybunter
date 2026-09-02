import { useState, type FormEvent } from 'react'
import { BUTTON, FIELD, MUTED } from '../ui/styles.js'
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
    <form className="flex max-w-160 flex-col gap-2" onSubmit={submit}>
      <label className="flex flex-col gap-1">
        What was the question?
        <input className={FIELD} value={question} onChange={(e) => setQuestion(e.target.value)} />
      </label>

      <label className="flex flex-col gap-1">
        What did you choose?
        <input className={FIELD} value={chosen} onChange={(e) => setChosen(e.target.value)} />
      </label>

      <label className="flex flex-col gap-1">
        What lost?
        <input className={FIELD} value={option} onChange={(e) => setOption(e.target.value)} />
      </label>

      <label className="flex flex-col gap-1">
        Why did it lose?
        <input className={FIELD} value={whyNot} onChange={(e) => setWhyNot(e.target.value)} />
      </label>

      <div className="flex items-center gap-2.5">
        <button type="submit" className={BUTTON} disabled={!ready || saving}>
          {saving ? 'Recording…' : 'Record'}
        </button>
        {preview ? <span className={MUTED}>{preview}</span> : null}
      </div>

      {error ? <p className="text-red-700">Could not record it: {error}</p> : null}
    </form>
  )
}
