// MusicPlayer — monochrome dock (bottom-left) for the marketplace surface.
//
// The pasted 21st.dev widget's rich visuals are kept verbatim — the 10×10
// dot-matrix ScalesMixer, the spinning click-to-zoom Disc with directional
// burst + layered cover crossfade, and the layered TrackInfo slide — but the
// <audio>+FFT engine is replaced with the YouTube IFrame Player (keyless, no
// quota). The widget's ScalesMixer already falls back to a time-driven mode
// when no frequency data is supplied (energy=1.0), so dropping FFT loses none
// of the choreography — it just isn't beat-reactive (YouTube exposes no audio
// frames). Recolored to the WeatherWidget glass shell: white + the one coral
// (#f0968a), used only on the progress fill, active shuffle/loop, and filled ♥.
// A "For You" button asks the backend (the user's own provider keys) for
// personalized seeds. The search panel logs searches and shows taste-based
// suggestions (liked tracks, played artists, recent searches) device-locally.
// Layout CSS lives in src/index.css (`.mp-*`).

import React, { memo, useCallback, useEffect, useId, useRef, useState } from 'react'
import { searchYouTube, searchYouTubeList, type YtHit } from '../lib/youtubeSearch'
import {
  record,
  setLiked,
  keyOf,
  likedTracks,
  topArtists,
  recordSearch,
  recentSearches,
  clearSearches,
  summary,
  type TasteTrack,
} from '../lib/musicTaste'
import { getProviderKeys } from '../lib/keyStore'
import { Slider } from './ui/slider'
import {
  EQ_BAND_HZ,
  EQ_BAND_LABELS,
  EQ_PRESETS,
  EQ_RANGE,
  loadEq,
  saveEq,
  eqMatchesPreset,
  type EqState,
} from '../lib/musicEq'

interface Track {
  videoId: string
  title: string
  channel: string
}
type Direction = 'next' | 'prev' | null

// ponytail: RM sampled once at load; a runtime toggle needs a reload. Gates the
// JS-driven rAF animations (Disc spin, ScalesMixer) — CSS motion is gated by the
// media query in index.css.
const REDUCE_MOTION =
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

// ponytail: ambient typings for just the IFrame methods we call — expand if
// the engine grows. Full @types/youtube would be a dependency for ~8 methods.
interface YTPlayer {
  playVideo(): void
  pauseVideo(): void
  seekTo(seconds: number, allowSeekAhead: boolean): void
  getCurrentTime(): number
  getDuration(): number
  loadVideoById(id: string): void
  cueVideoById(id: string): void
}

const DEFAULT_SEEDS = ['lofi hip hop', 'jazz piano', 'ambient chill']
const cover = (id: string) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`

/* ---------------------------------------------------------------- engine --- */

// Memoized singleton — inject the IFrame API script once, resolve when YouTube
// calls the global ready hook (mirrors modelInfo.ts openRouterIndex()).
let ytApi: Promise<any> | null = null
function loadYouTubeApi(): Promise<any> {
  const w = window as any
  if (w.YT?.Player) return Promise.resolve(w.YT)
  ytApi ??= new Promise((resolve) => {
    const prev = w.onYouTubeIframeAPIReady
    w.onYouTubeIframeAPIReady = () => {
      prev?.()
      resolve(w.YT)
    }
    if (!document.getElementById('mp-yt-api')) {
      const s = document.createElement('script')
      s.id = 'mp-yt-api'
      s.src = 'https://www.youtube.com/iframe_api'
      document.head.appendChild(s)
    }
  })
  // ponytail: failure isn't cached/rejected — if the script is blocked the
  // promise just never resolves and the dock stays idle (no crash).
  return ytApi
}

/** rAF loop passing (now, dt); runs while `active` (default true = while mounted). */
function useRafLoop(cb: (now: number, dt: number) => void, active = true) {
  const cbRef = useRef(cb)
  cbRef.current = cb
  useEffect(() => {
    if (!active) return
    let raf = 0
    let last = performance.now()
    const loop = (now: number) => {
      const dt = now - last
      last = now
      cbRef.current(now, dt)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [active])
}

/** Tiny WebAudio blip on track change (standalone, unrelated to YouTube audio). */
function useTransitionSound() {
  const ctxRef = useRef<AudioContext | null>(null)
  return useCallback(() => {
    try {
      const AC = window.AudioContext || (window as any).webkitAudioContext
      if (!AC) return
      const ctx = (ctxRef.current ??= new AC())
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.type = 'triangle'
      o.frequency.setValueAtTime(560, ctx.currentTime)
      o.frequency.exponentialRampToValueAtTime(373, ctx.currentTime + 0.09)
      g.gain.setValueAtTime(0.0001, ctx.currentTime)
      g.gain.exponentialRampToValueAtTime(0.05, ctx.currentTime + 0.012)
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.16)
      o.connect(g)
      g.connect(ctx.destination)
      o.start()
      o.stop(ctx.currentTime + 0.18)
    } catch {
      /* audio unavailable — silent */
    }
  }, [])
}

interface Engine {
  ready: boolean
  isPlaying: boolean
  progress: number
  current: number
  duration: number
  load: (videoId: string, autoplay: boolean) => void
  toggle: () => void
  seekFrac: (f: number) => void
  nudge: (sec: number) => void
  replay: () => void
  currentTimeNow: () => number
}

// One YT.Player mounted into the always-present #mp-yt div. Event handlers are
// ref-bounced so the once-created player never reads a stale closure.
function useYouTubePlayer(handlers: { onEnded: () => void; onFirstPlay: (videoId: string) => void }): Engine {
  const playerRef = useRef<YTPlayer | null>(null)
  const videoRef = useRef('')
  const playedRef = useRef('')
  const hRef = useRef(handlers)
  hRef.current = handlers

  const [ready, setReady] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(0)

  useEffect(() => {
    let cancelled = false
    loadYouTubeApi().then((YT) => {
      if (cancelled || playerRef.current) return
      playerRef.current = new YT.Player('mp-yt', {
        height: '100%',
        width: '100%',
        playerVars: { controls: 0, disablekb: 1, modestbranding: 1, rel: 0, playsinline: 1 },
        events: {
          onReady: () => setReady(true),
          onStateChange: (e: any) => {
            const s = e.data // 1 playing, 2 paused, 0 ended
            setIsPlaying(s === 1)
            if (s === 1 && videoRef.current && playedRef.current !== videoRef.current) {
              playedRef.current = videoRef.current
              hRef.current.onFirstPlay(videoRef.current)
            }
            if (s === 0) hRef.current.onEnded()
          },
        },
      })
    })
    return () => {
      cancelled = true
    }
  }, [])

  // Progress poll, throttled to 4fps (Disc/ScalesMixer are memoized, so only
  // the bar/time re-render here).
  const qRef = useRef(-1)
  useRafLoop(() => {
    const p = playerRef.current
    if (!p) return
    const t = p.getCurrentTime() || 0
    const q = Math.floor(t * 4)
    if (q === qRef.current) return
    qRef.current = q
    const d = p.getDuration() || 0
    setCurrent(t)
    setDuration(d)
    setProgress(d ? t / d : 0)
  }, isPlaying && ready)

  return {
    ready,
    isPlaying,
    progress,
    current,
    duration,
    load: (videoId, autoplay) => {
      videoRef.current = videoId
      playedRef.current = ''
      if (autoplay) playerRef.current?.loadVideoById(videoId)
      else playerRef.current?.cueVideoById(videoId)
    },
    toggle: () => {
      const p = playerRef.current
      if (!p) return
      isPlaying ? p.pauseVideo() : p.playVideo()
    },
    seekFrac: (f) => playerRef.current?.seekTo(f * (playerRef.current?.getDuration() || 0), true),
    nudge: (sec) => {
      const p = playerRef.current
      if (!p) return
      p.seekTo(Math.max(0, p.getCurrentTime() + sec), true)
    },
    replay: () => {
      const p = playerRef.current
      if (!p) return
      p.seekTo(0, true)
      p.playVideo()
    },
    currentTimeNow: () => playerRef.current?.getCurrentTime() || 0,
  }
}

/* --------------------------------------------------- Enhanced EQ audio engine */
// Web Audio replacement for the IFrame when the user turns the equalizer on:
// the backend /api/music-stream/:videoId/audio relay feeds a same-origin
// <audio> element (googlevideo URLs are CORS-tainted; MediaElementAudioSource
// from a tainted element outputs silence), whose output runs through a
// preamp gain + 5-band BiquadFilter chain (EQ_BAND_HZ) before destination.
//
// googlevideo currently hands keyless resolves only the first ~1MB of a file
// (PO-token era), so a track longer than the window can relay degrades: the
// element fires an error/stall, the engine reports `available: false` for that
// videoId, and the player falls back to the IFrame — the EQ stays honest
// per-track instead of glitching mid-song. Swap in a fuller resolver behind
// the same endpoint and this lights up everywhere.
function useEnhancedEngine(
  eq: { preamp: number; bands: number[] },
  enabled: boolean,
  handlers: { onEnded: () => void },
  resumeAtRef?: { current: number },
): Engine & { available: boolean } {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const chainRef = useRef<{ ctx: AudioContext; preamp: GainNode; filters: BiquadFilterNode[] } | null>(null)
  const videoRef = useRef('')
  const unavailableRef = useRef<Set<string>>(new Set())
  const hRef = useRef(handlers)
  hRef.current = handlers
  const eqRef = useRef(eq)
  eqRef.current = eq

  const [ready] = useState(true)
  const [isPlaying, setIsPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(0)
  const [available, setAvailable] = useState(true)

  // Build (once) the audio element + graph. The element has no `src` yet —
  // `load` sets it per track. `crossOrigin` stays unset: same-origin proxy.
  useEffect(() => {
    const a = new Audio()
    a.preload = 'auto'
    a.addEventListener('ended', () => hRef.current.onEnded())
    a.addEventListener('playing', () => setIsPlaying(true))
    a.addEventListener('pause', () => setIsPlaying(false))
    a.addEventListener('loadedmetadata', () => {
      setDuration(a.duration || 0)
      const resume = resumeAtRef?.current || 0
      if (resume > 1 && a.duration && resume < a.duration) a.currentTime = resume
    })
    a.addEventListener('error', () => {
      if (videoRef.current) unavailableRef.current.add(videoRef.current)
      setAvailable(false)
    })
    audioRef.current = a
    return () => {
      a.pause()
      a.src = ''
      audioRef.current = null
    }
  }, [])

  // The Web Audio graph needs a user gesture to start — created lazily on
  // first toggle() (play), never on mount.
  const ensureGraph = useCallback(() => {
    const a = audioRef.current
    if (!a || chainRef.current) return
    try {
      const AC = window.AudioContext || (window as any).webkitAudioContext
      if (!AC) return
      const ctx = new AC()
      const src = ctx.createMediaElementSource(a)
      const preamp = ctx.createGain()
      const filters = EQ_BAND_HZ.map((hz, i) => {
        const f = ctx.createBiquadFilter()
        // 0,4 = low/high shelf; middle three = peaking
        f.type = i === 0 ? 'lowshelf' : i === EQ_BAND_HZ.length - 1 ? 'highshelf' : 'peaking'
        f.frequency.value = hz
        if (f.type === 'peaking') f.Q.value = 1.1
        f.gain.value = eqRef.current.bands[i] ?? 0
        return f
      })
      // preamp → band0 → … → band4 → destination
      src.connect(preamp)
      let node: AudioNode = preamp
      for (const f of filters) {
        node.connect(f)
        node = f
      }
      node.connect(ctx.destination)
      preamp.gain.value = Math.pow(10, eqRef.current.preamp / 20)
      chainRef.current = { ctx, preamp, filters }
    } catch {
      /* Web Audio unavailable — EQ silently off, element plays dry */
    }
  }, [])

  // Live EQ updates: slider moves re-tune the running graph.
  useEffect(() => {
    const g = chainRef.current
    if (!g) return
    g.preamp.gain.value = Math.pow(10, eq.preamp / 20)
    eq.bands.forEach((db, i) => {
      if (g.filters[i]) g.filters[i].gain.value = db
    })
  }, [eq, enabled])

  // Re-check availability when the track changes (per-videoId memory).
  useEffect(() => {
    if (videoRef.current) setAvailable(!unavailableRef.current.has(videoRef.current))
  }, [videoRef.current])

  const qRef = useRef(-1)
  useRafLoop(() => {
    const a = audioRef.current
    if (!a) return
    const t = a.currentTime || 0
    const q = Math.floor(t * 4)
    if (q === qRef.current) return
    qRef.current = q
    const d = a.duration || 0
    setCurrent(t)
    setDuration(d)
    setProgress(d ? t / d : 0)
  }, isPlaying)

  return {
    ready,
    isPlaying,
    progress,
    current,
    duration,
    available,
    load: (videoId, autoplay) => {
      const a = audioRef.current
      if (!a) return
      videoRef.current = videoId
      setAvailable(!unavailableRef.current.has(videoId))
      a.src = `/api/music-stream/${videoId}/audio`
      a.load()
      if (autoplay) {
        ensureGraph()
        void chainRef.current?.ctx.resume()
        void a.play().catch(() => setAvailable(false))
      }
    },
    toggle: () => {
      const a = audioRef.current
      if (!a) return
      if (a.paused) {
        ensureGraph()
        void chainRef.current?.ctx.resume()
        void a.play().catch(() => setAvailable(false))
      } else {
        a.pause()
      }
    },
    seekFrac: (f) => {
      const a = audioRef.current
      if (a && a.duration) a.currentTime = f * a.duration
    },
    nudge: (sec) => {
      const a = audioRef.current
      if (a) a.currentTime = Math.max(0, a.currentTime + sec)
    },
    replay: () => {
      const a = audioRef.current
      if (!a) return
      a.currentTime = 0
      void a.play()
    },
    currentTimeNow: () => audioRef.current?.currentTime || 0,
  }
}

/* ------------------------------------------------------- ScalesMixer (10×10) */
// Ported verbatim from the widget, minus FFT: the original supplies energy=1.0
// when no frequency data is present, so this is the widget's own time-driven
// mode. tRef advances only while the loop runs (gated on `playing`) → animates
// while playing, freezes on pause.

const COLS = 10
const ROWS = 10
const sineOut = (x: number) => Math.sin((x * Math.PI) / 2)
const sineIn = (x: number) => 1 - Math.cos((x * Math.PI) / 2)
const sineInOut = (x: number) => -(Math.cos(Math.PI * x) - 1) / 2
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const PART_A_DUR = 1.5
const PART_A_TO = 11
const PART_A_STEP = 3 / (COLS - 1)
const PART_B_DUR = 1
const SCALE_FROM = 0.133
const SCALE_TO = 0.8

function partAColumnY(time: number, col: number): number {
  const local = time - col * PART_A_STEP
  const period = PART_A_DUR * 2
  const cyc = ((local % period) + period) % period
  if (cyc < PART_A_DUR) return PART_A_TO * sineInOut(cyc / PART_A_DUR)
  return PART_A_TO * sineInOut(1 - (cyc - PART_A_DUR) / PART_A_DUR)
}
function partBCircle(time: number, col: number, row: number): [number, number] {
  const frac = row / ROWS
  const yFrom = lerp(77, -77, frac)
  const yTo = lerp(col, -col, frac)
  const local = time - col / COLS
  const period = PART_B_DUR * 2
  const cyc = ((local % period) + period) % period
  const e = cyc < PART_B_DUR ? sineOut(cyc / PART_B_DUR) : sineIn(1 - (cyc - PART_B_DUR) / PART_B_DUR)
  return [lerp(yFrom, yTo, e), lerp(SCALE_FROM, SCALE_TO, e)]
}

const ScalesMixer = memo(function ScalesMixer({ playing }: { playing: boolean }) {
  const maskId = useId().replace(/:/g, '_')
  const colRefs = useRef<(SVGGElement | null)[]>([])
  const circleRefs = useRef<(SVGCircleElement | null)[][]>(Array.from({ length: COLS }, () => []))
  const tRef = useRef(50)

  useRafLoop((_, dt) => {
    tRef.current += dt / 1000
    const time = tRef.current
    for (let c = 0; c < COLS; c++) {
      const colEl = colRefs.current[c]
      if (colEl) colEl.style.transform = `translate(${c * 10}px, ${partAColumnY(time, c)}px)`
      for (let r = 0; r < ROWS; r++) {
        const circle = circleRefs.current[c][r]
        if (!circle) continue
        const [ty, s] = partBCircle(time, c, r)
        circle.style.transform = `translateY(${ty}px) scale(${s})`
      }
    }
  }, playing && !REDUCE_MOTION)

  return (
    <svg className="mp-scales" viewBox="0 0 98 108" aria-hidden="true">
      <mask id={maskId}>
        <rect width="10" height="10" fill="#fff" />
      </mask>
      {Array.from({ length: COLS }, (_, c) => (
        <g
          key={c}
          ref={(el) => {
            colRefs.current[c] = el
          }}
          style={{ transform: `translate(${c * 10}px, 0px)` }}
        >
          {Array.from({ length: ROWS }, (_, r) => (
            <g key={r} mask={`url(#${maskId})`} transform={`translate(0 ${r * 10})`}>
              <circle
                ref={(el) => {
                  circleRefs.current[c][r] = el
                }}
                cx="5"
                cy="5"
                r="5"
                style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
              />
            </g>
          ))}
        </g>
      ))}
    </svg>
  )
})

/* -------------------------------------------------------- Disc + cover layers */

const SPIN_MAX = 0.4375
const BURST_DURATION = 620

interface Layer {
  id: number
  track: Track
  dir: Direction
}

const Disc = memo(function Disc({
  layers,
  playing,
  zoomed,
  trackKey,
  direction,
  onZoom,
}: {
  layers: Layer[]
  playing: boolean
  zoomed: boolean
  trackKey: string
  direction: Direction
  onZoom: () => void
}) {
  const spinRef = useRef<HTMLDivElement>(null)
  const rotRef = useRef(0)
  const velRef = useRef(0)
  const burstRef = useRef({ from: 0, start: 0, active: false, pending: false })
  const lastKey = useRef(trackKey)

  useEffect(() => {
    if (trackKey !== lastKey.current) {
      lastKey.current = trackKey
      if (direction) {
        burstRef.current.from = direction === 'prev' ? 360 : -360
        burstRef.current.pending = true
      }
    }
  }, [trackKey, direction])

  useRafLoop((now) => {
    const el = spinRef.current
    if (!el) return
    if (playing) velRef.current += (SPIN_MAX - velRef.current) * 0.2
    else {
      velRef.current *= 0.96
      if (velRef.current < 0.001) velRef.current = 0
    }
    if (zoomed) {
      const target = Math.round(rotRef.current / 360) * 360
      const nx = rotRef.current + (target - rotRef.current) * 0.08
      rotRef.current = Math.abs(target - nx) < 0.1 ? target : nx
    } else {
      rotRef.current += velRef.current
    }
    const burst = burstRef.current
    if (burst.pending) {
      burst.start = now
      burst.pending = false
      burst.active = true
    }
    let b = 0
    if (burst.active) {
      const t = (now - burst.start) / BURST_DURATION
      if (t >= 1) burst.active = false
      else b = burst.from * Math.pow(1 - t, 3)
    }
    el.style.transform = `rotate(${rotRef.current + b}deg)`
  }, !REDUCE_MOTION)

  return (
    <div
      className={`mp-mask ${zoomed ? 'is-zoomed' : ''}`}
      onClick={(e) => {
        e.stopPropagation()
        onZoom()
      }}
    >
      <div className="mp-spin" ref={spinRef}>
        {layers.length ? (
          layers.map((l, i) => {
            const isNewest = i === layers.length - 1
            const cls = isNewest ? (l.dir ? 'mp-cover cover-enter' : 'mp-cover') : 'mp-cover cover-exit'
            return <img key={l.id} src={cover(l.track.videoId)} alt="" className={cls} draggable={false} />
          })
        ) : (
          <div className="mp-cover mp-cover-empty" />
        )}
      </div>
      <div className="mp-hole">
        <div className="mp-hole-inner" />
      </div>
    </div>
  )
})

/* ------------------------------------------------------- TrackInfo (layered) */

function TrackInfo({ layers, status }: { layers: Layer[]; status: string }) {
  if (!layers.length) {
    return (
      <div className="mp-track-info">
        <div className="mp-ti-layer">
          <p className="mp-artist" />
          <h2 className="mp-track">{status || 'Nothing queued'}</h2>
        </div>
      </div>
    )
  }
  return (
    <div className="mp-track-info">
      {layers.map((l, i) => {
        const isNewest = i === layers.length - 1
        const dx = l.dir === 'next' ? 14 : l.dir === 'prev' ? -14 : 0
        const state = isNewest ? (l.dir ? 'ti-enter' : '') : 'ti-exit'
        const style = { ['--dx' as string]: `${isNewest ? dx : -dx}px` } as React.CSSProperties
        return (
          <div key={l.id} className={`mp-ti-layer ${isNewest ? '' : 'mp-ti-abs'}`}>
            <p className={`mp-artist ${state}`} style={style}>
              {l.track.channel}
            </p>
            <h2 className={`mp-track ${state}`} style={style} title={l.track.title}>
              {l.track.title}
            </h2>
          </div>
        )
      })}
    </div>
  )
}

/* ---------------------------------------------------------------- icons --- */

const Ico = {
  play: <path d="M5 3.5v9l7.5-4.5z" />,
  pause: (
    <>
      <rect x="4.5" y="3.5" width="2.5" height="9" rx="0.5" />
      <rect x="9" y="3.5" width="2.5" height="9" rx="0.5" />
    </>
  ),
  prev: (
    <>
      <rect x="3.5" y="3.5" width="1.6" height="9" rx="0.4" />
      <path d="M12.5 3.5v9L6 8z" />
    </>
  ),
  next: (
    <>
      <path d="M3.5 3.5v9L10 8z" />
      <rect x="10.9" y="3.5" width="1.6" height="9" rx="0.4" />
    </>
  ),
  shuffle: (
    <path
      d="M2.5 4h2.2c0.9 0 1.5 0.5 2 1.2M13.5 4h-2c-1.6 0-2.4 1.6-3.2 3s-1.6 3-3.2 3H2.5M13.5 12h-2c-0.9 0-1.5-0.5-2-1.2M11.5 2.5L13.7 4l-2.2 1.5M11.5 10.5l2.2 1.5-2.2 1.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  loop: (
    <path
      d="M4 5h6.5c1.4 0 2.5 1.1 2.5 2.5S11.9 10 10.5 10H4m0 0l2-2m-2 2l2 2M12 5L10 3m2 2l-2 2"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  chevron: (
    <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
  ),
  search: (
    <>
      <circle cx="7" cy="7" r="4" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M10.2 10.2l3.3 3.3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </>
  ),
  close: (
    <path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  ),
  // vertical sliders glyph — the EQ button (stroked, matches the set's style)
  sliders: (
    <>
      <path d="M4 3v10M8 3v10M12 3v10" />
      <circle cx="4" cy="6" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="8" cy="10" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="12" cy="4.5" r="1.6" fill="currentColor" stroke="none" />
    </>
  ),
}

function Btn({
  label,
  active,
  onClick,
  disabled,
  className = '',
  children,
}: {
  label: string
  active?: boolean
  onClick?: () => void
  disabled?: boolean
  className?: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      className={`mp-ctrl ${active ? 'is-active' : ''} ${className}`}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
    >
      <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
        {children}
      </svg>
    </button>
  )
}

/* ----------------------------------------------------------------- root --- */

const fmt = (s: number) => {
  if (!Number.isFinite(s) || s < 0) return '0:00'
  const m = Math.floor(s / 60)
  const r = Math.floor(s % 60)
  return `${m}:${String(r).padStart(2, '0')}`
}

export default function MusicPlayer() {
  const [queue, setQueue] = useState<Track[]>([])
  const [index, setIndex] = useState(0)
  const [shuffle, setShuffle] = useState(false)
  const [loop, setLoop] = useState(false)
  const [expanded, setExpanded] = useState(false)
  // Heart state hydrates from the device-local ledger (composite title—channel
  // keys) so likes survive reloads; before this the Set reset on every mount.
  const [likedIds, setLikedIds] = useState<Set<string>>(() => new Set(likedTracks().map(keyOf)))
  const [foryou, setForyou] = useState<'idle' | 'loading' | 'empty'>('idle')
  const [status, setStatus] = useState('')
  const [direction, setDirection] = useState<Direction>(null)
  const [isZoomed, setIsZoomed] = useState(false)
  const [layers, setLayers] = useState<Layer[]>([])
  const [searching, setSearching] = useState(false)
  const [searchQ, setSearchQ] = useState('')
  const [results, setResults] = useState<YtHit[]>([])
  const [searchStatus, setSearchStatus] = useState<'idle' | 'loading' | 'empty'>('idle')
  // Taste panel content for the search overlay — liked tracks, top artists,
  // recent searches; refreshed whenever the panel opens or a like toggles.
  const [tasteList, setTasteList] = useState<TasteTrack[]>([])
  const [tasteArtists, setTasteArtists] = useState<string[]>([])
  const [recent, setRecent] = useState<string[]>([])
  const refreshTaste = useCallback(() => {
    setTasteList(likedTracks())
    setTasteArtists(topArtists())
    setRecent(recentSearches())
  }, [])

  // Equalizer: state persists device-locally; `enhance` selects which engine
  // plays. The enhanced engine is built once and both engines stay mounted —
  // the IFrame never unmounts (ToS) and stays idle while enhanced plays.
  const [eq, setEq] = useState<EqState>(() => loadEq())
  const [enhance, setEnhance] = useState(false)
  const [eqOpen, setEqOpen] = useState(false)

  const updateEq = useCallback((patch: Partial<EqState>) => {
    setEq((prev) => {
      const next = { ...prev, ...patch }
      saveEq(next)
      return next
    })
  }, [])

  const blip = useTransitionSound()
  const autoplayRef = useRef(false)
  const track = queue[index] as Track | undefined
  const queueRef = useRef(queue)
  queueRef.current = queue
  const idxRef = useRef(index)
  idxRef.current = index
  const loopRef = useRef(loop)
  loopRef.current = loop
  const shuffleRef = useRef(shuffle)
  shuffleRef.current = shuffle
  const directionRef = useRef(direction)
  directionRef.current = direction

  const advance = useCallback((dir: 1 | -1) => {
    setDirection(dir === 1 ? 'next' : 'prev')
    setIndex((i) => {
      const n = queueRef.current.length
      if (n <= 1) return i
      if (shuffleRef.current) {
        let r = i
        while (r === i) r = Math.floor(Math.random() * n)
        return r
      }
      return (i + dir + n) % n
    })
  }, [])

  const engine = useYouTubePlayer({
    onFirstPlay: (videoId) => {
      const t = queueRef.current.find((q) => q.videoId === videoId)
      if (t) record('play', t)
    },
    onEnded: () => {
      const t = queueRef.current[idxRef.current]
      if (t) record('complete', t)
      if (loopRef.current) {
        engineRef.current?.replay()
        if (t) record('replay', t)
      } else {
        advance(1)
      }
    },
  })
  // engine is used inside its own onEnded via a ref to dodge the init cycle.
  const engineRef = useRef(engine)
  engineRef.current = engine

  // Position captured when the engine flips mid-song; the enhanced element
  // seeks to it on loadedmetadata (declared before the hook that reads it).
  const resumeAtRef = useRef(0)

  // Enhanced engine — same Engine contract, mounted lazily behind the toggle.
  // onEnded mirrors the IFrame's handler (loop/replay or advance).
  const enhanced = useEnhancedEngine(eq, enhance, {
    onEnded: () => {
      const t = queueRef.current[idxRef.current]
      if (t) record('complete', t)
      if (loopRef.current) {
        enhancedRef.current?.replay()
        if (t) record('replay', t)
      } else {
        advance(1)
      }
    },
  }, resumeAtRef)
  const enhancedRef = useRef(engine)
  enhancedRef.current = enhanced

  // Active engine: enhanced when ON and its track relays; otherwise IFrame.
  // A mid-song engine flip hands the current position to the new engine so
  // the switch is seamless (the IFrame keeps its place for flip-back too).
  const active = enhance && enhanced.available ? enhanced : engine
  useEffect(() => {
    if (!track || !engine.ready) return
    const target = enhance && enhanced.available ? enhanced : engine
    if (target === enhanced) resumeAtRef.current = engine.currentTimeNow()
    target.load(track.videoId, autoplayRef.current)
    blip()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track?.videoId, engine.ready, enhance, enhanced.available])

  // Push a cover/title layer on every track change; drop it after the crossfade.
  const lastVidRef = useRef('')
  const idRef = useRef(1)
  useEffect(() => {
    if (!track) return
    if (track.videoId === lastVidRef.current) return
    lastVidRef.current = track.videoId
    const id = idRef.current++
    const dir = directionRef.current
    setLayers((prev) => [...prev, { id, track, dir }])
    const to = setTimeout(() => setLayers((prev) => prev.filter((l) => l.id === id)), 760)
    return () => clearTimeout(to)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track?.videoId])

  // Resolve default seeds on first mount so the dock isn't empty.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const hits = (await Promise.all(DEFAULT_SEEDS.map((q) => searchYouTube(q).catch(() => null)))).filter(
        Boolean,
      ) as YtHit[]
      if (cancelled) return
      if (hits.length) setQueue(hits.map((h) => ({ videoId: h.videoId, title: h.title, channel: h.channel })))
      else setStatus('Search unavailable — try again shortly')
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const play = () => {
    autoplayRef.current = true
    active.toggle()
  }
  const skip = (dir: 1 | -1) => {
    autoplayRef.current = true
    if (track && active.currentTimeNow() < 8) record('skip', track)
    advance(dir)
  }
  const like = () => {
    if (!track) return
    const k = keyOf(track)
    const on = !likedIds.has(k)
    setLiked(track, on)
    setLikedIds((s) => {
      const n = new Set(s)
      if (on) n.add(k)
      else n.delete(k)
      return n
    })
    refreshTaste()
  }

  // Taste panel refreshes when the search overlay opens (and after every like).
  useEffect(() => {
    if (searching) refreshTaste()
  }, [searching, refreshTaste])

  const hasKey = Object.values(getProviderKeys()).some(Boolean)
  const forYou = async () => {
    setForyou('loading')
    try {
      const r = await fetch('/api/music-recommend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ behavior: summary(), providerKeys: getProviderKeys() }),
      }).then((x) => x.json())
      const seeds: { q: string; why: string }[] = Array.isArray(r?.seeds) ? r.seeds : []
      if (!seeds.length) {
        setForyou('empty')
        return
      }
      const hits = (await Promise.all(seeds.map((s) => searchYouTube(s.q).catch(() => null)))).filter(
        Boolean,
      ) as YtHit[]
      if (!hits.length) {
        setForyou('empty')
        return
      }
      autoplayRef.current = true
      setDirection(null) // fresh queue — not a next/prev, so no burst/slide
      setQueue(hits.map((h) => ({ videoId: h.videoId, title: h.title, channel: h.channel })))
      setIndex(0)
      setForyou('idle')
    } catch {
      setForyou('empty')
    }
  }

  const runSearch = async (qOverride?: string) => {
    const q = (qOverride ?? searchQ).trim()
    if (!q) return
    recordSearch(q)
    setRecent(recentSearches())
    if (qOverride !== undefined) setSearchQ(q)
    setSearchStatus('loading')
    const hits = await searchYouTubeList(q)
    setResults(hits)
    setSearchStatus(hits.length ? 'idle' : 'empty')
  }
  // Play a taste pick: ledger rows carry the videoId when known; older rows
  // resolve it on demand. The full liked list becomes the queue so
  // prev/next walk the playlist, not just the one pick.
  const playTaste = async (t: TasteTrack, list: TasteTrack[]) => {
    setSearching(false)
    autoplayRef.current = true
    setDirection(null)
    const resolved = await Promise.all(
      list.map(async (x) => {
        if (x.videoId) return { videoId: x.videoId, title: x.title, channel: x.channel }
        const hits = await searchYouTubeList(`${x.channel} ${x.title}`.trim()).catch(() => [] as YtHit[])
        return hits[0] ? { videoId: hits[0].videoId, title: x.title, channel: x.channel } : null
      }),
    )
    const tracks = resolved.filter(Boolean) as Track[]
    if (!tracks.length) return
    const at = tracks.findIndex((x) => x.title === t.title && x.channel === t.channel)
    setQueue(tracks)
    setIndex(at >= 0 ? at : 0)
  }
  // Play a catalog hit: the whole result list becomes the queue (so prev/next
  // walk the search results) and the clicked track becomes current — the load
  // effect keyed on track.videoId autoplays it.
  const playResult = (i: number) => {
    autoplayRef.current = true
    setDirection(null)
    setQueue(results.map((h) => ({ videoId: h.videoId, title: h.title, channel: h.channel })))
    setIndex(i)
    setSearching(false)
  }

  // Keyboard scoped to the card (only when focus is inside) → no global Space
  // hijack, no conflict with the catalog search input.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement) return
    switch (e.key) {
      case ' ':
        e.preventDefault()
        play()
        break
      case 'ArrowLeft':
        e.preventDefault()
        e.shiftKey ? skip(-1) : active.nudge(-5)
        break
      case 'ArrowRight':
        e.preventDefault()
        e.shiftKey ? skip(1) : active.nudge(5)
        break
      case 's':
      case 'S':
        setShuffle((v) => !v)
        break
      case 'l':
      case 'L':
        setLoop((v) => !v)
        break
      case 'e':
      case 'E':
        setEqOpen((v) => !v)
        break
    }
  }

  const liked = track ? likedIds.has(keyOf(track)) : false

  return (
    <div className={`mp-dock ${expanded ? '' : 'mp-collapsed'}`}>
      {/* Always-mounted iframe host: kept present-but-minimal (1px) per ToS, and
          never unmounted so playback survives collapse. */}
      <div className="mp-yt-host" aria-hidden="true">
        <div id="mp-yt" />
      </div>

      {expanded ? (
        <section
          className={`mp-card ${active.isPlaying ? 'is-playing' : ''} ${isZoomed ? 'is-zoomed' : ''}`}
          role="region"
          aria-label="Music player"
          tabIndex={0}
          onKeyDown={onKeyDown}
          onClick={(e) => {
            if (!(e.target as HTMLElement).closest('.mp-mask')) setIsZoomed(false)
          }}
        >
          <header className="mp-head">
            <span className="mp-kicker">For You · YouTube</span>
            <button
              className={`mp-icon-btn ${searching ? 'is-active' : ''}`}
              aria-label="Search tracks"
              aria-pressed={searching}
              onClick={() => setSearching((s) => !s)}
            >
              <svg viewBox="0 0 16 16" width="14" height="14">
                {Ico.search}
              </svg>
            </button>
            <button
              className={`mp-icon-btn ${eqOpen ? 'is-active' : ''}`}
              aria-label="Equalizer"
              aria-pressed={eqOpen}
              onClick={() => setEqOpen((v) => !v)}
            >
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
                {Ico.sliders}
              </svg>
            </button>
            <button className="mp-icon-btn" aria-label="Collapse player" onClick={() => setExpanded(false)}>
              <svg viewBox="0 0 16 16" width="14" height="14">
                {Ico.chevron}
              </svg>
            </button>
          </header>

          {searching && (
            <div className="mp-search">
              <div className="mp-search-top">
                <svg className="mp-search-ico" viewBox="0 0 16 16" width="14" height="14">
                  {Ico.search}
                </svg>
                <input
                  className="mp-search-input"
                  autoFocus
                  autoComplete="off"
                  value={searchQ}
                  placeholder="Search a track…"
                  onChange={(e) => setSearchQ(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') runSearch()
                    else if (e.key === 'Escape') setSearching(false)
                  }}
                />
                <button className="mp-search-close" aria-label="Close search" onClick={() => setSearching(false)}>
                  <svg viewBox="0 0 16 16" width="14" height="14">
                    {Ico.close}
                  </svg>
                </button>
              </div>
              <div className="mp-results">
                {searchStatus === 'loading' && <div className="mp-results-note">Searching…</div>}
                {searchStatus === 'empty' && <div className="mp-results-note">No results — try another search</div>}
                {searchStatus === 'idle' && !results.length && !tasteList.length && !recent.length && (
                  <div className="mp-results-note">Search YouTube and press Enter to play</div>
                )}
                {/* Empty-state suggestions: taste-derived, never prefix-matched —
                    liked tracks first, then the artists he actually plays, then
                    his own recent searches. */}
                {!results.length && searchStatus !== 'loading' && (
                  <>
                    {tasteList.length > 0 && (
                      <div className="mp-taste-sec">
                        <span className="mp-taste-head">Based on your taste</span>
                        {tasteList.slice(0, 12).map((t, i) => (
                          <button
                            key={`taste-${i}`}
                            className="mp-result"
                            onClick={() => playTaste(t, tasteList.slice(0, 12))}
                          >
                            {t.videoId && (
                              <img className="mp-result-cover" src={cover(t.videoId)} alt="" draggable={false} />
                            )}
                            <span className="mp-result-meta">
                              <span className="mp-result-title">{t.title}</span>
                              {t.channel && <span className="mp-result-channel">{t.channel}</span>}
                            </span>
                            <svg className="mp-result-play" viewBox="0 0 16 16" width="12" height="12" fill="currentColor">
                              {Ico.play}
                            </svg>
                          </button>
                        ))}
                      </div>
                    )}
                    {tasteArtists.length > 0 && (
                      <div className="mp-taste-sec">
                        <span className="mp-taste-head">Artists you listen to</span>
                        <div className="mp-chips">
                          {tasteArtists.map((a) => (
                            <button key={a} className="mp-chip" onClick={() => runSearch(a)}>
                              {a}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    {recent.length > 0 && (
                      <div className="mp-taste-sec">
                        <span className="mp-taste-head">
                          Recent
                          <button
                            className="mp-chip-clear"
                            onClick={() => {
                              clearSearches()
                              setRecent([])
                            }}
                          >
                            clear
                          </button>
                        </span>
                        <div className="mp-chips">
                          {recent.map((s) => (
                            <button key={s} className="mp-chip" onClick={() => runSearch(s)}>
                              {s}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
                {results.map((h, i) => (
                  <button key={`${h.videoId}-${i}`} className="mp-result" onClick={() => playResult(i)}>
                    <img className="mp-result-cover" src={cover(h.videoId)} alt="" draggable={false} />
                    <span className="mp-result-meta">
                      <span className="mp-result-title">{h.title}</span>
                      {h.channel && <span className="mp-result-channel">{h.channel}</span>}
                    </span>
                    <svg className="mp-result-play" viewBox="0 0 16 16" width="12" height="12" fill="currentColor">
                      {Ico.play}
                    </svg>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Equalizer overlay — same full-card treatment as search. Enhance is
              opt-in (default OFF = untouched IFrame playback); the 5-band chain
              + preamp drive the Web Audio engine while ON. */}
          {eqOpen && (
            <div className="mp-eq">
              <div className="mp-eq-top">
                <span className="mp-eq-title">Equalizer</span>
                <button
                  className={`mp-eq-enhance ${enhance ? 'is-on' : ''}`}
                  role="switch"
                  aria-checked={enhance}
                  aria-label="Enhance audio"
                  onClick={() => setEnhance((v) => !v)}
                >
                  <span className="mp-eq-enhance-dot" />
                  {enhance ? 'Enhance on' : 'Enhance off'}
                </button>
                <button className="mp-search-close" aria-label="Close equalizer" onClick={() => setEqOpen(false)}>
                  <svg viewBox="0 0 16 16" width="14" height="14">
                    {Ico.close}
                  </svg>
                </button>
              </div>

              <div className="mp-eq-presets">
                {Object.keys(EQ_PRESETS).map((name) => (
                  <button
                    key={name}
                    className={`mp-eq-preset ${eqMatchesPreset(eq, name) ? 'is-active' : ''}`}
                    onClick={() => updateEq({ bands: [...EQ_PRESETS[name]], preset: name })}
                  >
                    {name}
                  </button>
                ))}
              </div>

              <div className="mp-eq-bands">
                {EQ_BAND_HZ.map((hz, i) => (
                  <div key={hz} className="mp-eq-band">
                    <Slider
                      aria-label={`${EQ_BAND_LABELS[i]} ${hz} Hz`}
                      min={-EQ_RANGE}
                      max={EQ_RANGE}
                      step={0.5}
                      value={eq.bands[i]}
                      orientation="vertical"
                      className="mp-eq-slider"
                      onValueChange={(v) =>
                        updateEq({ bands: eq.bands.map((g, j) => (j === i ? Number(v) : g)), preset: 'Custom' })
                      }
                    />
                    <span className="mp-eq-band-gain">{eq.bands[i] > 0 ? '+' : ''}{eq.bands[i]}</span>
                    <span className="mp-eq-band-label">{EQ_BAND_LABELS[i]}</span>
                  </div>
                ))}
              </div>

              <div className="mp-eq-preamp">
                <span className="mp-eq-band-label">Preamp</span>
                <Slider
                  aria-label="Preamp"
                  min={-12}
                  max={12}
                  step={0.5}
                  value={eq.preamp}
                  className="mp-eq-slider mp-eq-slider-preamp"
                  onValueChange={(v) => updateEq({ preamp: Number(v) })}
                />
                <span className="mp-eq-band-gain">{eq.preamp > 0 ? '+' : ''}{eq.preamp} dB</span>
              </div>

              {enhance && !enhanced.available && (
                <div className="mp-eq-note">
                  This track can't stream through the enhancer — playing via YouTube instead
                </div>
              )}
              {enhance && enhanced.available && (
                <div className="mp-eq-note is-on">Enhanced audio · 5-band equalizer live</div>
              )}
            </div>
          )}

          <div className="mp-hero">
            <Disc
              layers={layers}
              playing={active.isPlaying}
              zoomed={isZoomed}
              trackKey={track?.videoId || ''}
              direction={direction}
              onZoom={() => setIsZoomed((z) => !z)}
            />
            <ScalesMixer playing={active.isPlaying} />
          </div>

          <TrackInfo layers={layers} status={status} />

          <div
            className="mp-bar"
            role="slider"
            aria-label="Seek"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(active.progress * 100)}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect()
              active.seekFrac(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)))
            }}
          >
            <div className="mp-bar-fill" style={{ width: `${active.progress * 100}%` }} />
          </div>
          <div className="mp-time">
            <span>{fmt(active.current)}</span>
            <span>{fmt(active.duration)}</span>
          </div>

          <div className="mp-controls">
            <Btn label="Shuffle" active={shuffle} onClick={() => setShuffle((v) => !v)}>
              {Ico.shuffle}
            </Btn>
            <Btn label="Previous track" onClick={() => skip(-1)} disabled={queue.length < 2}>
              {Ico.prev}
            </Btn>
            <Btn label={active.isPlaying ? 'Pause' : 'Play'} onClick={play} disabled={!track} className="mp-play">
              {active.isPlaying ? Ico.pause : Ico.play}
            </Btn>
            <Btn label="Next track" onClick={() => skip(1)} disabled={queue.length < 2}>
              {Ico.next}
            </Btn>
            <Btn label="Loop" active={loop} onClick={() => setLoop((v) => !v)}>
              {Ico.loop}
            </Btn>
          </div>

          <div className="mp-actions">
            <button
              className={`mp-like ${liked ? 'is-liked' : ''}`}
              aria-label="Like this track"
              aria-pressed={liked}
              onClick={like}
              disabled={!track}
            >
              <svg viewBox="0 0 16 16" width="14" height="14" fill={liked ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.3">
                <path d="M8 13.5S2.5 9.8 2.5 6.2A2.7 2.7 0 018 4.6a2.7 2.7 0 015.5 1.6C13.5 9.8 8 13.5 8 13.5z" />
              </svg>
              <span>{liked ? 'Liked' : 'Like'}</span>
            </button>
            <button
              className="mp-foryou"
              onClick={forYou}
              disabled={!hasKey || foryou === 'loading'}
              title={hasKey ? 'Personalize from your listening' : 'Add a provider key to enable'}
            >
              {foryou === 'loading' ? 'Finding…' : foryou === 'empty' ? 'No picks — retry' : 'For You'}
            </button>
          </div>
          {!hasKey && <div className="mp-hint">Add a provider key to enable For You</div>}
        </section>
      ) : (
        <button className="mp-pill" aria-label="Open music player" onClick={() => setExpanded(true)}>
          <span className={`mp-pill-cover ${active.isPlaying ? 'is-playing' : ''}`}>
            {track ? <img src={cover(track.videoId)} alt="" draggable={false} /> : <span className="mp-cover-empty" />}
          </span>
          <span className={`mp-mini-eq ${active.isPlaying ? 'is-playing' : ''}`}>
            {Array.from({ length: 4 }).map((_, i) => (
              <span key={i} style={{ animationDelay: `${i * 0.13}s` }} />
            ))}
          </span>
        </button>
      )}
    </div>
  )
}
