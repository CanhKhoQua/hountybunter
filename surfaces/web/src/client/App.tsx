import { useState } from 'react'
import { Menu } from './ui/Menu.js'

const TITLES: Record<string, string> = {
  hunt: 'The hunt',
  notes: "Hunter's notes",
  sessions: 'Sessions',
  regions: 'Regions',
  bounties: 'Bounties',
}

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
        </section>
      </main>
    </div>
  )
}
