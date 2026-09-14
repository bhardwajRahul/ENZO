// Device-local listening ledger for the "For You" recommender. localStorage
// only — no PII, no server, no network. Keyed by "<title> — <channel>". The
// backend /api/music-recommend turns summary() into song seeds; nothing here
// ever leaves the device except that one compact digest the user triggers.

export interface TasteTrack {
  title: string
  channel: string
}

type Event = 'play' | 'complete' | 'skip' | 'replay' | 'liked'

interface Row {
  title: string
  channel: string
  plays: number
  completes: number
  skips: number
  replays: number
  liked: boolean
}

const KEY = 'enzo.music.taste'

function load(): Record<string, Row> {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}')
  } catch {
    return {}
  }
}

function save(rows: Record<string, Row>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(rows))
  } catch {
    /* storage full/unavailable — ledger is best-effort */
  }
}

function idOf(t: TasteTrack): string {
  return `${t.title} — ${t.channel}`.toLowerCase()
}

/** Tally one behavior event for a track (creates the row on first sight). */
export function record(event: Event, t: TasteTrack): void {
  if (!t?.title) return
  const rows = load()
  const id = idOf(t)
  const r =
    rows[id] ??
    { title: t.title, channel: t.channel, plays: 0, completes: 0, skips: 0, replays: 0, liked: false }
  if (event === 'liked') r.liked = true
  else r[`${event}s` as 'plays' | 'completes' | 'skips' | 'replays'] += 1
  rows[id] = r
  save(rows)
}

/** Compact top-N taste digest for the recommender prompt (empty if no history). */
export function summary(): string {
  const rows = Object.values(load())
  if (!rows.length) return ''
  const label = (r: Row) => `${r.title} — ${r.channel}`
  const topBy = (sel: (r: Row) => number, n = 6) =>
    rows.filter((r) => sel(r) > 0).sort((a, b) => sel(b) - sel(a)).slice(0, n).map(label)
  const liked = rows.filter((r) => r.liked).map(label).slice(0, 8)
  const completed = topBy((r) => r.completes)
  const skipped = topBy((r) => r.skips)
  const parts: string[] = []
  if (liked.length) parts.push(`LIKED: ${liked.join('; ')}`)
  if (completed.length) parts.push(`OFTEN FINISHED: ${completed.join('; ')}`)
  if (skipped.length) parts.push(`OFTEN SKIPPED (avoid these): ${skipped.join('; ')}`)
  return parts.join('\n')
}

// ponytail: runnable check — shims localStorage, asserts tallies + digest.
// Run demo() directly under tsx (it restores the real localStorage after).
export function demo(): void {
  const mem: Record<string, string> = {}
  const g = globalThis as any
  const prev = g.localStorage
  g.localStorage = { getItem: (k: string) => mem[k] ?? null, setItem: (k: string, v: string) => { mem[k] = v } }
  try {
    const t = { title: 'Midnight', channel: 'Coldplay' }
    record('play', t); record('play', t); record('complete', t); record('liked', t)
    const rows = JSON.parse(mem[KEY])
    const row = Object.values(rows)[0] as Row
    console.assert(row.plays === 2, 'plays should tally to 2')
    console.assert(row.completes === 1, 'completes should tally to 1')
    console.assert(row.liked === true, 'liked should flip true')
    console.assert(summary().includes('LIKED: Midnight'), 'summary should list liked track')
    console.log('musicTaste demo ok')
  } finally {
    g.localStorage = prev
  }
}
