import { useEffect, useState } from 'react'
import { api, type RegionRow } from '../api.js'
import { MUTED, TALLY } from '../ui/styles.js'

export function Regions() {
  const [rows, setRows] = useState<RegionRow[] | null>(null)

  useEffect(() => {
    api.regions().then((data) => setRows(data.regions))
  }, [])

  if (!rows) return <p className={`py-3 ${MUTED}`}>Reading the index…</p>

  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
      {rows.map((region) => (
        <article
          key={region.project}
          className={
            'flex flex-col gap-1 rounded border border-line bg-raised p-3 ' +
            // A region nobody has recorded a decision in is dimmed, not hidden.
            (region.notes ? '' : 'opacity-60')
          }
        >
          <h3 className="m-0 truncate text-sm font-semibold">{region.project}</h3>
          {/* Both counts, always: a region with many sessions and no notes is
              the interesting case, and one number alone hides it. */}
          <span className={TALLY}>
            {region.sessions} sessions · {region.notes} notes
          </span>
          <span className={MUTED}>{region.notes ? 'surveyed' : 'unsurveyed'}</span>
        </article>
      ))}
    </div>
  )
}
