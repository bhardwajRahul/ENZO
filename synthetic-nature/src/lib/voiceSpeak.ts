// voiceSpeak — the TTS half of ENZO's voice chat. Browser-native
// speechSynthesis only: free, offline-capable, zero deps, no server.
//
// "Humanized" delivery (the ask: proper pauses, a session of doubt, natural
// inconsistencies) is done in three layers:
//   1. markdown is stripped — never read fences/asterisks/links aloud
//   2. utterance-per-sentence with real gaps between them (the first sentence
//      of a paragraph gets the longest gap; a sentence ending in an ellipsis
//      or dash gives the next one the "doubt" gap) — the "proper pauses"
//   3. subtle rate/pitch jitter per sentence — the "speech inconsistencies"
//
// Chrome pauses long single utterances (~15s) — per-sentence avoids it.
// Voices load async on Chrome (voiceschanged) — resolved at speak time.

export interface SpeakOpts {
  onDone?: () => void
}

const PREFER = [
  'premium',            // macOS "Premium" voices — the most expressive local set
  'natural',            // Microsoft Edge "Natural" / macOS "Natural" voices
  'enhanced',           // Apple "Enhanced" voices
  'google us english',  // Chrome's cloud voice
  'samantha',           // macOS default
  'google uk english female',
  'aria',
  'zoe',
]

/** Best available English voice, by quality-name heuristic. Premium and
 *  Enhanced voices carry real prosody — the difference between robotic and
 *  human-sounding is almost always the voice, not the text. */
export function pickVoice(): SpeechSynthesisVoice | null {
  if (typeof window === 'undefined' || !window.speechSynthesis) return null
  const voices = window.speechSynthesis.getVoices()
  if (!voices.length) return null
  const en = voices.filter((v) => v.lang?.toLowerCase().startsWith('en'))
  const pool = en.length ? en : voices
  for (const want of PREFER) {
    // prefer the highest-named-quality match; local voices beat remote ones
    // (no network dependency, and macOS local voices are the expressive set)
    const hit = pool.find((v) => v.name.toLowerCase().includes(want) && v.localService)
      ?? pool.find((v) => v.name.toLowerCase().includes(want))
    if (hit) return hit
  }
  return pool.find((v) => v.localService) ?? pool[0]
}

/** Strip markdown so TTS reads clean prose: fences, code, tables, emphasis, links, headers. */
export function speechText(md: string): string {
  if (!md) return ''
  let out = md
  out = out.replace(/```[\s\S]*?```/g, ' ') // fenced code — never read aloud
  out = out.replace(/`[^`\n]+`/g, (m) => m.slice(1, -1)) // inline code → bare
  out = out.replace(/^\s*\|.*\|\s*$/gm, ' ') // table rows — unreadable aloud
  out = out.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ') // images
  out = out.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // links → label
  out = out.replace(/^\s{0,3}#{1,6}\s+/gm, '') // headers → plain
  out = out.replace(/(\*\*\*|\*\*|__|\*|~~)/g, '') // emphasis markers
  out = out.replace(/^\s*[-*+]\s+/gm, '') // list bullets
  out = out.replace(/^\s*>\s?/gm, '') // quotes
  return out.replace(/[ \t]{2,}/g, ' ').trim()
}

// pause lengths (ms) — the "proper pauses" ladder
const GAP_SENTENCE = 170
const GAP_PARAGRAPH = 420
const GAP_DOUBT = 380

export interface SpeakSegment {
  text: string
  /** Silence before this sentence (ms). */
  gap: number
}

/** True when a sentence ends in an ellipsis/dash — the "session of doubt" pause. */
export function isDoubtEnding(s: string): boolean {
  return /[…]|—|--|\.\.\.$/.test(s.trim())
}

/**
 * Markdown → speakable sentences with a per-sentence gap hint. Paragraph
 * structure survives (paragraphs split first), then sentences inside.
 */
export function speechSegments(md: string): SpeakSegment[] {
  const paragraphs = speechText(md)
    .split(/\n{2,}|\n(?=\s*[-*+>])/) // blank lines / list starts = paragraph bounds
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
  const segs: SpeakSegment[] = []
  let nextGap = GAP_PARAGRAPH // first paragraph gets the paragraph gap
  for (const para of paragraphs) {
    const parts = para.match(/[^.!?…]+[.!?…]+["')\]]*|[^.!?…]+$/g) || [para]
    for (const rawPart of parts) {
      const part = rawPart.trim()
      if (!part) continue
      segs.push({ text: part, gap: nextGap })
      nextGap = isDoubtEnding(part) ? GAP_DOUBT : GAP_SENTENCE
    }
  }
  return segs
}

let speakingRef = false
let cancelledRef = false
let pendingSegs: SpeakSegment[] = []
let doneCbs: (() => void)[] = []

export function isSpeaking(): boolean {
  return speakingRef
}

/** Cancel any in-flight speech immediately and clear the queue. */
export function stopSpeaking(): void {
  cancelledRef = true
  speakingRef = false
  pendingSegs = []
  doneCbs = []
  if (typeof window !== 'undefined' && window.speechSynthesis) {
    try { window.speechSynthesis.cancel() } catch { /* not running */ }
  }
}

function drainQueue(): void {
  const synth = typeof window !== 'undefined' ? window.speechSynthesis : null
  if (!synth) {
    speakingRef = false
    pendingSegs = []
    const cbs = doneCbs
    doneCbs = []
    cbs.forEach((cb) => cb())
    return
  }
  if (cancelledRef) return
  if (!pendingSegs.length) {
    speakingRef = false
    const cbs = doneCbs
    doneCbs = []
    cbs.forEach((cb) => cb())
    return
  }
  const seg = pendingSegs[0]
  const u = new SpeechSynthesisUtterance(seg.text)
  // voice is resolved per segment so late-loaded voices apply mid-session
  const voice = pickVoice()
  if (voice) {
    u.voice = voice
    u.lang = voice.lang
  }
  // subtle per-sentence jitter — the "speech inconsistencies"
  u.rate = 0.98 + (Math.random() * 0.06 - 0.03)
  u.pitch = 1.0 + (Math.random() * 0.05 - 0.02)
  u.onend = () => {
    pendingSegs = pendingSegs.slice(1)
    window.setTimeout(drainQueue, seg.gap)
  }
  u.onerror = () => {
    pendingSegs = pendingSegs.slice(1)
    window.setTimeout(drainQueue, 60)
  }
  try {
    synth.speak(u)
  } catch {
    pendingSegs = pendingSegs.slice(1)
    window.setTimeout(drainQueue, 60)
  }
}

function queue(segs: SpeakSegment[], opts: SpeakOpts, fresh: boolean): void {
  if (!segs.length) {
    opts.onDone?.()
    return
  }
  if (fresh) stopSpeaking()
  cancelledRef = false
  pendingSegs.push(...segs)
  if (opts.onDone) doneCbs.push(opts.onDone)
  if (!speakingRef) {
    speakingRef = true
    drainQueue()
  }
}

/**
 * Speak markdown text with humanized pacing — a FRESH utterance: clears
 * whatever was speaking/queued first. Fires onDone when everything queued
 * finished (or was cancelled).
 */
export function speakNaturally(md: string, opts: SpeakOpts = {}): void {
  const segs = speechSegments(md)
  queue(segs, opts, true)
}

/**
 * APPEND more speech without cutting what is already speaking — the
 * streaming-speak half: completed sentences land here as the reply streams,
 * queued after the current one so the voice never changes mid-sentence.
 */
export function speakMore(text: string, opts: SpeakOpts = {}): void {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (!clean) {
    opts.onDone?.()
    return
  }
  const parts = clean.match(/[^.!?…]+[.!?…]+["')\]]*|[^.!?]+$/g) || [clean]
  const segs: SpeakSegment[] = []
  for (const rawPart of parts) {
    const part = rawPart.trim()
    if (!part) continue
    // the pause before each appended sentence comes from the previous one's
    // ending: an ellipsis/dash = the longer "doubt" gap
    const prev = segs.length ? segs[segs.length - 1].text : pendingSegs[pendingSegs.length - 1]?.text
    segs.push({
      text: part,
      gap: prev && isDoubtEnding(prev) ? GAP_DOUBT : GAP_SENTENCE,
    })
  }
  queue(segs, opts, false)
}

// ponytail: runnable check — asserts the strip/split/pause ladder under tsx
// (no real speech in Node; the synth-dependent path is UI-tested).
export function demo(): void {
  const md = '## Hello\n\nThis **works** great. Does it…\n\n- a `list` item\n[link](https://x.com)\n\n```js\nconst hidden = true\n```'
  const clean = speechText(md)
  console.assert(!clean.includes('##'), 'headers stripped')
  console.assert(!clean.includes('**'), 'emphasis stripped')
  console.assert(!clean.includes('```'), 'fences stripped')
  console.assert(!clean.includes('const hidden'), 'code never read')
  console.assert(clean.includes('works'), 'prose kept')
  console.assert(clean.includes('link'), 'link label kept')
  const segs = speechSegments('## Hello\n\nOne two. Three?\n\nFour… Five')
  console.assert(segs[0].gap === 420, `first sentence gets paragraph gap, got ${segs[0].gap}`)
  console.assert(segs[segs.length - 1].text === 'Five', 'split kept all sentences')
  const doubtIdx = segs.findIndex((s) => s.text === 'Four…')
  console.assert(doubtIdx >= 0, 'ellipsis sentence present')
  console.assert(segs[doubtIdx + 1]?.gap === 380, 'sentence after ellipsis gets the doubt gap')
  console.assert(isDoubtEnding('Really…'), 'ellipsis = doubt ending')
  console.assert(isDoubtEnding('Wait,') === false, 'comma is not a doubt ending')
  console.assert(segs.length === 5, `five segments total, got ${segs.length}`)
  console.log('voiceSpeak demo ok')
}
