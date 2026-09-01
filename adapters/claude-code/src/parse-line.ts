export type TranscriptRecord =
  | { ok: true; kind: string; raw: Record<string, unknown> }
  | { ok: false; reason: string }

/**
 * Parse one JSONL line. The transcript format is undocumented and may change,
 * so nothing here throws and no record type is rejected: an unrecognised type
 * is carried through with its payload intact.
 */
export function parseLine(line: string): TranscriptRecord {
  const trimmed = line.trim()
  if (!trimmed) return { ok: false, reason: 'empty line' }

  let value: unknown
  try {
    value = JSON.parse(trimmed)
  } catch (error) {
    return { ok: false, reason: `invalid JSON: ${(error as Error).message}` }
  }

  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, reason: 'line is not a JSON object' }
  }

  const raw = value as Record<string, unknown>
  const type = raw.type
  return { ok: true, kind: typeof type === 'string' && type ? type : 'unknown', raw }
}

/** Tool calls live in `message.content[]` blocks with `type: "tool_use"`. */
export function extractToolUses(raw: Record<string, unknown>): { name: string }[] {
  const message = raw.message
  if (message === null || typeof message !== 'object') return []
  const content = (message as Record<string, unknown>).content
  if (!Array.isArray(content)) return []

  return content.flatMap((block) => {
    if (block === null || typeof block !== 'object') return []
    const b = block as Record<string, unknown>
    if (b.type !== 'tool_use') return []
    const name = b.name
    if (typeof name !== 'string' || !name) return []
    return [{ name }]
  })
}
