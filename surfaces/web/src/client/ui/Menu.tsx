import { TALLY } from './styles.js'

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
    <nav className="overflow-x-hidden overflow-y-auto border-r border-line bg-raised py-4" aria-label="Camp">
      {MENU.map((item) => (
        <button
          key={item.key}
          type="button"
          className={
            'flex w-full cursor-pointer items-baseline justify-between gap-2 ' +
            'border-0 border-l-3 bg-transparent px-4 py-2.5 text-left font-[inherit] ' +
            (current === item.key
              ? 'border-l-accent font-semibold text-ink'
              : 'border-l-transparent text-ink-soft hover:text-ink')
          }
          aria-current={current === item.key ? 'true' : 'false'}
          onClick={() => onSelect(item.key)}
        >
          <span>{item.label}</span>
          {item.tally ? <span className={TALLY}>{item.tally}</span> : null}
        </button>
      ))}
    </nav>
  )
}
