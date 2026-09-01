import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { RecordForm } from '../../src/client/views/RecordForm.js'
import { slugify } from '../../src/client/slug.js'

afterEach(cleanup)

let posted: unknown

beforeEach(() => {
  posted = null
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
    posted = init?.body ? JSON.parse(String(init.body)) : null
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ note: { id: '2026-08-31-dung-nen-ban-do-nao' } }),
    })
  }))
})

function open() {
  const onRecorded = vi.fn()
  render(<RecordForm sessionId="005a845f" date="2026-08-31" onRecorded={onRecorded} />)
  return { onRecorded }
}

function type(label: RegExp, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
}

describe('RecordForm', () => {
  it('will not submit until the two required fields are there', () => {
    open()
    const submit = screen.getByRole('button', { name: /record/i }) as HTMLButtonElement
    expect(submit.disabled).toBe(true)

    type(/question/i, 'Dùng nền bản đồ nào?')
    expect(submit.disabled).toBe(true)

    type(/choose/i, 'OpenFreeMap')
    expect(submit.disabled).toBe(false)
  })

  it('shows the id it is about to write, with Vietnamese folded to readable letters', () => {
    open()
    type(/question/i, 'Dùng nền bản đồ nào?')
    expect(screen.getByText('2026-08-31-dung-nen-ban-do-nao')).toBeTruthy()
  })

  it('sends what lost along with what won', async () => {
    open()
    type(/question/i, 'Dùng nền bản đồ nào?')
    type(/choose/i, 'OpenFreeMap')
    type(/what lost/i, 'CARTO')
    type(/why/i, 'giới hạn request gói free')

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /record/i }))
    })

    expect(posted).toMatchObject({
      sessionId: '005a845f',
      question: 'Dùng nền bản đồ nào?',
      chosen: 'OpenFreeMap',
      rejected: [{ option: 'CARTO', why_not: 'giới hạn request gói free' }],
    })
  })

  it('omits rejected entirely when nothing was rejected, rather than sending a blank', async () => {
    open()
    type(/question/i, 'q')
    type(/choose/i, 'c')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /record/i }))
    })
    expect((posted as { rejected: unknown[] }).rejected).toEqual([])
  })

  it('reports the note it wrote without a page reload', async () => {
    const { onRecorded } = open()
    type(/question/i, 'q')
    type(/choose/i, 'c')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /record/i }))
    })
    expect(onRecorded).toHaveBeenCalledWith('2026-08-31-dung-nen-ban-do-nao')
  })
})

describe('slugify', () => {
  it('matches what core writes, so the preview is not a lie', () => {
    expect(slugify('Dùng nền bản đồ nào?')).toBe('dung-nen-ban-do-nao')
    expect(slugify('Đối trừ công nợ')).toBe('doi-tru-cong-no')
    expect(slugify('Which DB?  Postgres vs. SQLite!')).toBe('which-db-postgres-vs-sqlite')
  })
})
