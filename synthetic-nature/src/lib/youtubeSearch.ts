// Resolve a free-text song query ("Artist - Song") to a playable YouTube video,
// keyless and unlimited. The actual work happens server-side in the backend
// proxy /api/music-search: the public open-source YouTube frontends (Piped,
// Invidious) send no CORS headers, so the browser can't call them directly (the
// preview proved every instance blocks the origin). Node fetch has no
// same-origin policy, so the proxy queries them and returns the first hit. The
// IFrame Player then plays the returned id. No key, no quota.

export interface YtHit {
  videoId: string
  title: string
  channel: string
}

/** First playable YouTube match for a query, or null if the proxy found none. */
export async function searchYouTube(query: string): Promise<YtHit | null> {
  const q = query.trim()
  if (!q) return null
  try {
    const r = await fetch(`/api/music-search?q=${encodeURIComponent(q)}`)
    if (!r.ok) return null
    const j = await r.json()
    return j?.videoId
      ? { videoId: String(j.videoId), title: j.title || q, channel: j.channel || '' }
      : null
  } catch {
    return null
  }
}

/** Up to a dozen matches for the in-player catalog. Reads the proxy's `results`
 *  array; falls back to the single-result shape if only that came back. */
export async function searchYouTubeList(query: string): Promise<YtHit[]> {
  const q = query.trim()
  if (!q) return []
  try {
    const r = await fetch(`/api/music-search?q=${encodeURIComponent(q)}`)
    if (!r.ok) return []
    const j = await r.json()
    const raw = Array.isArray(j?.results) ? j.results : j?.videoId ? [j] : []
    return raw
      .filter((h: any) => h?.videoId)
      .map((h: any) => ({ videoId: String(h.videoId), title: h.title || q, channel: h.channel || '' }))
  } catch {
    return []
  }
}
