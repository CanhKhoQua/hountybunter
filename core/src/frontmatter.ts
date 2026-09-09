export function str(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value)
}

/**
 * Frontmatter dates need care. YAML 1.1 parses an unquoted `2026-08-12` into a
 * Date anchored at UTC midnight, and String(date) would render it in the
 * machine's local zone — shifting the calendar day west of UTC. Take the UTC
 * date components, which are exactly the day the file's author wrote.
 */
export function dateStr(value: unknown): string {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? '' : value.toISOString().slice(0, 10)
  }
  return str(value)
}
