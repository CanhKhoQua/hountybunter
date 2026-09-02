/**
 * Class strings used by more than one component.
 *
 * Constants rather than `@apply`: Tailwind's own guidance is that `@apply`
 * rebuilds the indirection utilities exist to remove. A plain string keeps the
 * utilities readable at the call site while leaving one place to edit them.
 */

export const ROW =
  'grid w-full grid-cols-[92px_minmax(0,1fr)_auto_auto] items-baseline gap-2.5 ' +
  'cursor-pointer border-0 border-b border-line bg-transparent px-1.5 py-2 ' +
  'text-left font-[inherit] text-inherit hover:bg-raised'

/** Only a guess is labelled; certainty needs no badge. */
export const BADGE =
  'rounded-full border border-warn px-1.5 py-px text-[11px] uppercase text-warn'

export const BACK =
  'mb-3 cursor-pointer rounded border border-line bg-raised px-2.5 py-1 ' +
  'font-[inherit] text-inherit'

export const FIELD =
  'rounded border border-line bg-raised px-2.5 py-1.5 font-[inherit] text-inherit'

export const BUTTON =
  'cursor-pointer self-start rounded border border-accent bg-accent px-3.5 py-1.5 ' +
  'font-[inherit] text-paper disabled:cursor-not-allowed disabled:border-line ' +
  'disabled:bg-line disabled:text-ink-soft'

export const MUTED = 'text-ink-soft'

export const TALLY = 'text-ink-soft tabular-nums'
