/** Current instant as ISO 8601 UTC. The clock is injectable so tests are fixed. */
export function nowIso(clock: () => Date = () => new Date()): string {
  return clock().toISOString()
}

/**
 * The calendar date an instant falls on, in an explicit IANA timezone.
 * `en-CA` is used because it formats as YYYY-MM-DD.
 */
export function calendarDate(instantIso: string, timeZone: string): string {
  const date = new Date(instantIso)
  if (Number.isNaN(date.getTime())) throw new Error(`invalid instant: ${instantIso}`)
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

export function resolveTimeZone(env: NodeJS.ProcessEnv = process.env): string {
  return env.HOUNTYBUNTER_TZ ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC'
}
