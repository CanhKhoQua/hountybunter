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
    <div
      className={
        'grid h-screen transition-[grid-template-columns] duration-150 ' +
        (menuOpen ? 'grid-cols-[var(--spacing-menu)_1fr]' : 'grid-cols-[0_1fr]')
      }
    >
      <Menu current={view} onSelect={setView} />

      {/* Collapsed, never unmounted: this tab is the only way back. */}
      <button
        type="button"
        className={
          // 24px wide, not 18: this is the only way back to a collapsed menu,
          // and below 24px it is under the minimum target size.
          'fixed top-1/2 z-2 -mt-6 flex h-12 w-6 cursor-pointer items-center ' +
          'justify-center rounded-r border border-l-0 border-line bg-raised ' +
          'text-ink-soft transition-[left] duration-150 ' +
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ' +
          (menuOpen ? 'left-[var(--spacing-menu)]' : 'left-0')
        }
        aria-label={menuOpen ? 'Collapse menu' : 'Expand menu'}
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((open) => !open)}
      >
        {menuOpen ? '‹' : '›'}
      </button>

      <main className="flex min-w-0 flex-col overflow-hidden">
        {/* The scene band. A plain panel until phase 7; the layout must survive
            never getting art, so it is capped rather than sized by content. */}
        <div className="max-h-[22vh] shrink-0" />
        <section className="min-h-0 flex-1 overflow-auto px-6 pt-4 pb-8">
          {/* Full-strength ink. Muted, the page's own title was quieter than
              the menu item pointing at it — and when the menu is collapsed to
              nothing, this line is the only thing saying where you are. */}
          <h2 className="mb-4 text-[15px] font-semibold tracking-wide uppercase text-ink">
            {TITLES[view]}
          </h2>
          {view === 'hunt' ? <Hunt timeZone={TIME_ZONE} /> : null}
          {view === 'sessions' ? <Sessions timeZone={TIME_ZONE} /> : null}
          {view === 'notes' ? <Notes /> : null}
          {view === 'regions' ? <Regions /> : null}
          {view === 'bounties' ? (
            <p className="py-3 text-ink-soft">
              Not built yet. Until it is, GitHub issues are the source of truth, and a note
              can point at one with evidence of kind <code>url</code>.
            </p>
          ) : null}
        </section>
      </main>
    </div>
  )
}
