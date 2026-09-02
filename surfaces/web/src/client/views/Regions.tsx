import { useEffect, useState } from 'react'
import { api, type RegionRow } from '../api.js'
import { Pager } from '../ui/Pager.js'
import { MUTED, TALLY } from '../ui/styles.js'

/** Regions per page. A grid row holds four at the width the panel is capped to. */
const PAGE = 24

export function Regions() {
  const [rows, setRows] = useState<RegionRow[] | null>(null)
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)

  useEffect(() => {
    api.regions({ limit: PAGE, offset }).then((data) => {
      setRows(data.regions)
      setTotal(data.total)
    })
  }, [offset])

  if (!rows) return <p className={`py-3 ${MUTED}`}>Reading the index…</p>
  // An empty index and a broken one look identical when the answer to both is
  // a blank page. The one that is fixable has to say so.
  if (rows.length === 0) {
    return (
      <p className={`py-3 ${MUTED}`}>
        No regions indexed yet. Run <code>hb ingest</code> to read the transcripts on this
        machine.
      </p>
    )
  }

  return (
    <>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
        {rows.map((region) => (
          <article
            key={region.project}
            className="flex flex-col gap-1 rounded border border-line bg-raised p-3"
          >
            <h3 className="m-0 truncate text-sm font-semibold">{region.project}</h3>
            {/* Both counts, always: a region with many sessions and no notes is
                the interesting case, and one number alone hides it. */}
            <span className={TALLY}>
              {region.sessions} sessions · {region.notes} notes
            </span>
            {/*
              Said in a word, not by fading the card. Dimming took the whole
              card — its own heading and counts included — below the contrast
              floor, to repeat what this line already says.
            */}
            <span className={MUTED}>{region.notes ? 'surveyed' : 'unsurveyed'}</span>
          </article>
        ))}
      </div>
      <Pager offset={offset} limit={PAGE} total={total} onOffset={setOffset} />
    </>
  )
}
