// Device-local listening ledger for the "For You" recommender. localStorage
// only — no PII, no server, no network. Keyed by "<title> — <channel>". The
// backend /api/music-recommend turns summary() into song seeds; nothing here
// ever leaves the device except that one compact digest the user triggers.
// The search log (recentSearches) is the same deal: device-local, capped,
// shown as clickable chips in the player's search panel.

export interface TasteTrack {
  title: string
  channel: string
  videoId?: string
}

type Event = 'play' | 'complete' | 'skip' | 'replay' | 'liked'

interface Row {
  title: string
  channel: string
  videoId?: string
  plays: number
  completes: number
  skips: number
  replays: number
  liked: boolean
}

const KEY = 'enzo.music.taste'
const SEARCH_KEY = 'enzo.music.searches'
const SEARCH_CAP = 12

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
  if (t.videoId) r.videoId = t.videoId
  if (event === 'liked') r.liked = true
  else r[`${event}s` as 'plays' | 'completes' | 'skips' | 'replays'] += 1
  rows[id] = r
  save(rows)
}

/** Like/unlike toggle — unlike actually clears the flag (record() only sets). */
export function setLiked(t: TasteTrack, on: boolean): void {
  if (!t?.title) return
  const rows = load()
  const id = idOf(t)
  const r =
    rows[id] ??
    { title: t.title, channel: t.channel, plays: 0, completes: 0, skips: 0, replays: 0, liked: false }
  if (t.videoId) r.videoId = t.videoId
  r.liked = on
  rows[id] = r
  save(rows)
}

/** Composite ledger key for a track — the player hydrates its heart from these. */
export function keyOf(t: TasteTrack): string {
  return idOf(t)
}

/** Liked tracks, ledger order (oldest first — the natural playlist order). */
export function likedTracks(): TasteTrack[] {
  return Object.values(load())
    .filter((r) => r.liked)
    .map((r) => ({ title: r.title, channel: r.channel, videoId: r.videoId }))
}

/**
 * Artists worth suggesting, weighted by behavior: liked > finished > played,
 * skips ignored. Channel names double as search queries ("Central Cee").
 */
export function topArtists(n = 6): string[] {
  const rows = Object.values(load())
  const weight = (r: Row) => (r.liked ? 6 : 0) + r.completes * 3 + r.plays
  const byChannel = new Map<string, number>()
  for (const r of rows) {
    if (!r.channel || r.skips > r.completes + r.plays) continue
    byChannel.set(r.channel, (byChannel.get(r.channel) || 0) + weight(r))
  }
  return [...byChannel.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([c]) => c)
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

/* ------------------------------------------------------- search log --- */

/** Log one search (deduped, newest first, capped). */
export function recordSearch(q: string): void {
  const query = q.trim().slice(0, 120)
  if (!query) return
  let list: string[] = []
  try {
    list = JSON.parse(localStorage.getItem(SEARCH_KEY) || '[]')
  } catch {
    list = []
  }
  list = [query, ...list.filter((x) => x.toLowerCase() !== query.toLowerCase())].slice(0, SEARCH_CAP)
  try {
    localStorage.setItem(SEARCH_KEY, JSON.stringify(list))
  } catch {
    /* best-effort */
  }
}

/** Recent searches, newest first. */
export function recentSearches(): string[] {
  try {
    const list = JSON.parse(localStorage.getItem(SEARCH_KEY) || '[]')
    return Array.isArray(list) ? list.filter((x) => typeof x === 'string') : []
  } catch {
    return []
  }
}

export function clearSearches(): void {
  try {
    localStorage.removeItem(SEARCH_KEY)
  } catch {
    /* best-effort */
  }
}

// ponytail: runnable check — shims localStorage, asserts tallies + digest.
// Run demo() directly under tsx (it restores the real localStorage after).
export function demo(): void {
  const mem: Record<string, string> = {}
  const g = globalThis as any
  const prev = g.localStorage
  g.localStorage = { getItem: (k: string) => mem[k] ?? null, setItem: (k: string, v: string) => { mem[k] = v }, removeItem: (k: string) => { delete mem[k] } }
  try {
    const t = { title: 'Midnight', channel: 'Coldplay', videoId: 'abc123' }
    record('play', t); record('play', t); record('complete', t); record('liked', t)
    const rows = JSON.parse(mem[KEY])
    const row = Object.values(rows)[0] as Row
    console.assert(row.plays === 2, 'plays should tally to 2')
    console.assert(row.completes === 1, 'completes should tally to 1')
    console.assert(row.liked === true, 'liked should flip true')
    console.assert(row.videoId === 'abc123', 'videoId should persist')
    console.assert(summary().includes('LIKED: Midnight'), 'summary should list liked track')
    setLiked(t, false)
    console.assert(likedTracks().length === 0, 'unlike should clear the liked list')
    setLiked(t, true)
    console.assert(likedTracks()[0].videoId === 'abc123', 'likedTracks should carry videoId')
    console.assert(topArtists()[0] === 'Coldplay', 'topArtists should rank the played artist')
    recordSearch('central cee'); recordSearch('lofi'); recordSearch('Central Cee')
    console.assert(recentSearches().length === 2, 'search log should dedupe case-insensitively')
    console.assert(recentSearches()[0] === 'Central Cee', 'search log should be newest-first')
    clearSearches()
    console.assert(recentSearches().length === 0, 'clearSearches should empty the log')
    console.log('musicTaste demo ok')
  } finally {
    g.localStorage = prev
  }
}
