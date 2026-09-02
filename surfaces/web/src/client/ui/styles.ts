/**
 * Class strings used by more than one component.
 *
 * Constants rather than `@apply`: Tailwind's own guidance is that `@apply`
 * rebuilds the indirection utilities exist to remove. A plain string keeps the
 * utilities readable at the call site while leaving one place to edit them.
 *
 * Every interactive style here names its own `focus-visible` ring. These are
 * all custom-painted controls, and the ring a browser draws by default is lost
 * against `bg-accent` and `bg-raised` — so keyboard focus has to be painted
 * deliberately or it cannot be followed at all.
 */

/** Drawn just outside the control, on paper, where it is legible on any fill. */
const RING = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'

/** Rows sit flush against each other, so their ring is drawn inside instead. */
const INSET_RING =
  'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent'

export const ROW =
  'grid w-full grid-cols-[92px_minmax(0,1fr)_auto_auto] items-baseline gap-2.5 ' +
  'cursor-pointer border-0 border-b border-line bg-transparent px-1.5 py-2 ' +
  'text-left font-[inherit] text-inherit hover:bg-raised ' +
  INSET_RING

/** Only a guess is labelled; certainty needs no badge. */
export const BADGE =
  'rounded-full border border-warn px-1.5 py-px text-[11px] uppercase text-warn'

/**
 * The quiet counterpart to `BUTTON`: back, browse, stop. It carries no outer
 * margin, so the callers that want one add it — reused beside an input, a
 * baked-in `mb-3` lifted the button off the baseline of its own row.
 */
export const BACK =
  'cursor-pointer rounded border border-line bg-raised px-2.5 py-1 ' +
  'font-[inherit] text-inherit ' +
  RING

export const FIELD =
  'rounded border border-line bg-raised px-2.5 py-1.5 font-[inherit] text-inherit ' +
  RING

export const BUTTON =
  'cursor-pointer self-start rounded border border-accent bg-accent px-3.5 py-1.5 ' +
  'font-[inherit] text-paper disabled:cursor-not-allowed disabled:border-line ' +
  'disabled:bg-line disabled:text-ink-soft ' +
  RING

export const MUTED = 'text-ink-soft'

export const TALLY = 'text-ink-soft tabular-nums'
