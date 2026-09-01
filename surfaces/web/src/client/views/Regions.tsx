import { useEffect, useState } from 'react'
import { api, type RegionRow } from '../api.js'

export function Regions() {
  const [rows, setRows] = useState<RegionRow[] | null>(null)

  useEffect(() => {
    api.regions().then((data) => setRows(data.regions))
  }, [])

  if (!rows) return <p className="loading">Reading the index…</p>

  return (
    <div className="region-grid">
      {rows.map((region) => (
        <article key={region.project} className={region.notes ? 'region-card' : 'region-card fogged'}>
          <h3>{region.project}</h3>
          {/* Both counts, always: a region with many sessions and no notes is
              the interesting case, and one number alone hides it. */}
          <span className="tally">
            {region.sessions} sessions · {region.notes} notes
          </span>
          <span className="state">{region.notes ? 'surveyed' : 'unsurveyed'}</span>
        </article>
      ))}
    </div>
  )
}
