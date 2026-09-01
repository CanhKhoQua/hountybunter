import { useState } from 'react'
import { Menu } from './ui/Menu.js'
import { Hunt } from './views/Hunt.js'
import { Notes } from './views/Notes.js'
import { Regions } from './views/Regions.js'
import { Sessions } from './views/Sessions.js'

const TITLES: Record<string, string> = {
  hunt: 'The hunt',
  notes: "Hunter's notes",
  sessions: 'Sessions',
  regions: 'Regions',
  bounties: 'Bounties',
}

/**
 * The zone every date on screen is computed in. Read once, explicitly, rather
 * than letting each component fall back to the browser's local time — the same
 * rule the server follows with HOUNTYBUNTER_TZ.
 */
const TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'

export function App() {
  const [view, setView] = useState('hunt')
  const [menuOpen, setMenuOpen] = useState(true)

  return (
    <div className={`app${menuOpen ? '' : ' menu-collapsed'}`}>
      <Menu current={view} onSelect={setView} />

      {/* Collapsed, never unmounted: this tab is the only way back. */}
      <button
        type="button"
        className="menu-tab"
        aria-label={menuOpen ? 'Collapse menu' : 'Expand menu'}
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((open) => !open)}
      >
        {menuOpen ? '‹' : '›'}
      </button>

      <main className="main">
        <div className="stage-wrap" />
        <section className="panel">
          <h2>{TITLES[view]}</h2>
          {view === 'hunt' ? <Hunt /> : null}
          {view === 'sessions' ? <Sessions timeZone={TIME_ZONE} /> : null}
          {view === 'notes' ? <Notes /> : null}
          {view === 'regions' ? <Regions /> : null}
          {view === 'bounties' ? (
            <p className="empty">
              Phase 8, not built. Until then GitHub issues are the source of truth, and a
              note can point at one with evidence of kind <code>url</code>.
            </p>
          ) : null}
        </section>
      </main>
    </div>
  )
}
