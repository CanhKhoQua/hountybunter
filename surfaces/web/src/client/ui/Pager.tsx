import { BACK, TALLY } from './styles.js'

/**
 * One window onto a longer list, and the way to move it.
 *
 * Every list in the app reads through this, including the ones that are short
 * today — it renders nothing until there is a second page, so applying it
 * everywhere costs nothing and means no list can quietly outgrow its screen.
 *
 * The total is the load-bearing part. Before it, each list was served a capped
 * page and said nothing: a session of thousands of activities showed its first
 * 500 directly beneath a row reporting the true count.
 */
export function Pager({
  offset,
  limit,
  total,
  onOffset,
}: {
  offset: number
  limit: number
  total: number
  onOffset: (next: number) => void
}) {
  if (total <= limit) return null

  const last = Math.min(offset + limit, total)

  return (
    <nav aria-label="Pages" className="flex items-center gap-2 pt-3">
      <span className={`text-[13px] ${TALLY}`}>
        {offset + 1}–{last} of {total}
      </span>
      <button
        type="button"
        className={`${BACK} disabled:cursor-not-allowed disabled:text-ink-soft`}
        // Clamped, not merely guarded: an offset the page size does not divide
        // would otherwise step off the front of the list.
        onClick={() => onOffset(Math.max(0, offset - limit))}
        disabled={offset === 0}
      >
        Previous
      </button>
      <button
        type="button"
        className={`${BACK} disabled:cursor-not-allowed disabled:text-ink-soft`}
        onClick={() => onOffset(offset + limit)}
        disabled={last >= total}
      >
        Next
      </button>
    </nav>
  )
}
