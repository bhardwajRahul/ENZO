// Equalizer model for the music player's Enhanced engine.
//
// Five standard bands (lowshelf → 3 peaking → highshelf), a preamp to make room
// for boosts, and named presets. Device-local only: `enzo.music.eq` is a plain
// UI-preference key (musicTaste.ts sets the precedent — keyVault manages
// "enzo.keys.*" secrets, not UI prefs), so localStorage is correct here.

export interface EqState {
  /** master dB applied before the band chain — prevents clipping when boosting */
  preamp: number
  /** band gains in dB, ordered low → high */
  bands: number[]
  preset: string
}

export const EQ_BAND_HZ = [80, 350, 1400, 4000, 10000] as const
export const EQ_BAND_LABELS = ['BASS', 'LOW-MID', 'MID', 'PRES', 'AIR'] as const
export const EQ_RANGE = 12 // ±12 dB per band
export const EQ_STORAGE_KEY = 'enzo.music.eq'

export const EQ_PRESETS: Record<string, number[]> = {
  Flat: [0, 0, 0, 0, 0],
  'Bass Boost': [7, 4, 0, 0, 1],
  'Vocal Clarity': [-1, 0, 3, 4, 2],
  Warm: [4, 2, -1, -2, -1],
  Crisp: [-2, -1, 0, 3, 5],
}

const DEFAULT_EQ: EqState = { preamp: 0, bands: [...EQ_PRESETS.Flat], preset: 'Flat' }

export function loadEq(): EqState {
  try {
    const raw = localStorage.getItem(EQ_STORAGE_KEY)
    if (!raw) return { ...DEFAULT_EQ }
    const j = JSON.parse(raw)
    const bands = Array.isArray(j?.bands) && j.bands.length === EQ_BAND_HZ.length
      ? j.bands.map((n: unknown) => Math.max(-EQ_RANGE, Math.min(EQ_RANGE, Number(n) || 0)))
      : [...EQ_PRESETS.Flat]
    return {
      preamp: Math.max(-12, Math.min(12, Number(j?.preamp) || 0)),
      bands,
      preset: typeof j?.preset === 'string' && j.preset in EQ_PRESETS ? j.preset : 'Flat',
    }
  } catch {
    return { ...DEFAULT_EQ }
  }
}

export function saveEq(eq: EqState): void {
  try {
    localStorage.setItem(EQ_STORAGE_KEY, JSON.stringify(eq))
  } catch {
    /* private mode etc — EQ just won't persist */
  }
}

/** Distance from Flat, so the UI can mark a preset inactive after slider edits. */
export function eqMatchesPreset(eq: EqState, name: string): boolean {
  const p = EQ_PRESETS[name]
  if (!p) return false
  return eq.bands.every((g, i) => g === p[i]) && (name === 'Flat' ? eq.preamp === 0 : true)
}
