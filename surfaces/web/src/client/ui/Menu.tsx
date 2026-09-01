export interface MenuItem {
  key: string
  label: string
  tally?: string
}

export const MENU: MenuItem[] = [
  { key: 'hunt', label: 'The hunt' },
  { key: 'notes', label: "Hunter's notes" },
  { key: 'sessions', label: 'Sessions' },
  { key: 'regions', label: 'Regions' },
  { key: 'bounties', label: 'Bounties', tally: 'phase 8' },
]

export function Menu({
  current,
  onSelect,
}: {
  current: string
  onSelect: (key: string) => void
}) {
  return (
    <nav className="menu" aria-label="Camp">
      {MENU.map((item) => (
        <button
          key={item.key}
          type="button"
          className="menu-item"
          aria-current={current === item.key ? 'true' : 'false'}
          onClick={() => onSelect(item.key)}
        >
          <span>{item.label}</span>
          {item.tally ? <span className="tally">{item.tally}</span> : null}
        </button>
      ))}
    </nav>
  )
}
