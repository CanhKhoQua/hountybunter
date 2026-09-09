import { readFile } from 'node:fs/promises'

export interface Exchange {
  prompt: string | null
  reply: string | null
}

function textOf(content: unknown): string | null {
  if (typeof content === 'string') return content.trim() || null
  if (!Array.isArray(content)) return null
  const parts = content
    .filter((b): b is { type: string; text: string } =>
      typeof b === 'object' && b !== null && (b as { type?: string }).type === 'text',
    )
    .map((b) => b.text)
  return parts.join('\n').trim() || null
}

/**
 * The last thing said in each direction, read from the archived transcript.
 *
 * Read rather than stored: §4 of the design keeps SQLite to the index and the
 * event log, and the archive is already on disk with a known path.
 */
export async function readLastExchange(path: string): Promise<Exchange> {
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch {
    return { prompt: null, reply: null }
  }

  let prompt: string | null = null
  let reply: string | null = null
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    let record: { type?: string; message?: { content?: unknown } }
    try {
      record = JSON.parse(line)
    } catch {
      continue
    }
    const text = textOf(record.message?.content)
    if (!text) continue
    if (record.type === 'user') prompt = text
    if (record.type === 'assistant') reply = text
  }
  return { prompt, reply }
}
