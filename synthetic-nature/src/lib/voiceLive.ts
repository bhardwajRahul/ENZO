// voiceLive — TRUE speech-to-speech via Gemini's Live API (native audio
// dialog). The same architecture as ChatGPT's voice mode: ONE model hears
// audio tokens and speaks audio tokens, so human pacing/emotion is native to
// the model — not a STT→LLM→TTS chain.
//
// Free tier: the user's own Google AI key (already sealed in ENZO's vault).
// The key goes straight to Google over WSS — browser → provider, the ENZO
// server is never touched (the relay-free extreme of the BYOK pitch).
//
// Protocol (v1alpha, verified against googleapis/js-genai live.ts +
// _live_converters.ts + the cookbook's Get_started_LiveAPI_NativeAudio.py):
//   wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.
//     v1alpha.GenerativeService.BidiGenerateContent?key=<KEY>
//   client: {"setup": {model, generationConfig:{responseModalities:["AUDIO"]},
//                       systemInstruction, inputAudioTranscription:{},
//                       outputAudioTranscription:{}}}
//           {"realtimeInput": {"mediaChunks": [{mimeType: "audio/pcm;rate=16000", data}]}}
//   server: {"setupComplete": {}}
//           {"serverContent": {"interrupted": true}}            ← native barge-in
//           {"serverContent": {"modelTurn": {"parts": [{inlineData:
//              {mimeType: "audio/pcm;rate=24000", data}}]}}}    ← speech
//           {"serverContent": {"inputTranscription": {text}}}
//           {"serverContent": {"outputTranscription": {text}}}
//           {"serverContent": {"turnComplete": true}}
// Audio: mic 16 kHz int16 in → model speech 24 kHz int16 out. Every frame is
// JSON (audio rides inline as base64 — no binary frames in this API version).
//
// Headphones note (same as Google's own example): without headphones the mic
// hears the model's own voice — echo cancellation in getUserMedia helps but
// isn't perfect; Google's demo tells users the same thing.

export interface VoiceLiveHandlers {
  onOpen: () => void
  /** One chunk of model speech (24 kHz int16 mono PCM, raw ArrayBuffer). */
  onAudio: (pcm: ArrayBuffer) => void
  /** Native barge-in: the user spoke over the model — drop playback now. */
  onInterrupted: () => void
  onInputTranscript: (text: string) => void
  onOutputTranscript: (text: string) => void
  onTurnComplete: () => void
  onClose: (why: string) => void
  onError: (why: string) => void
}

export interface VoiceLiveSession {
  sendAudio: (pcm16k: ArrayBuffer) => void
  close: () => void
}

const WS_BASE =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent'
const MODEL = 'models/gemini-3.8-live'
const SEND_RATE = 16000

// ENZO's voice persona — conversational by default; the native model already
// speaks with human pacing, so the instruction is about tone, not pauses.
const SYSTEM_INSTRUCTION = `You are ENZO, a friendly voice assistant. Talk like a person on a call:
- Keep replies short and conversational — you are being SPOKEN, not read.
- Plain language, no markdown, no lists, no emojis.
- If a request needs text output (code, a table), say briefly that you dropped it into the chat instead of reading it.
- Wrap up with a short follow-up question to keep the conversation flowing.`

export function connectVoiceLive(apiKey: string, handlers: VoiceLiveHandlers): VoiceLiveSession {
  const ws = new WebSocket(`${WS_BASE}?key=${encodeURIComponent(apiKey)}`)
  let closedByUs = false

  ws.onopen = () => {
    const setup = {
      setup: {
        model: MODEL,
        generationConfig: {
          responseModalities: ['AUDIO'],
          temperature: 0.9,
        },
        systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
        inputAudioTranscription: {},
        outputAudioTranscription: {},
      },
    }
    ws.send(JSON.stringify(setup))
    handlers.onOpen()
  }

  ws.onmessage = (event: MessageEvent) => {
    let msg: any
    try {
      if (event.data instanceof Blob) {
        // legacy shape — JSON text inside the blob
        void event.data.text().then((t) => {
          try { handle(JSON.parse(t)) } catch { /* unparsable frame */ }
        })
        return
      }
      const raw = event.data instanceof ArrayBuffer ? new TextDecoder().decode(event.data) : String(event.data)
      msg = JSON.parse(raw)
    } catch {
      return
    }
    handle(msg)
  }

  function handle(msg: any): void {
    if (msg?.setupComplete !== undefined) return
    const sc = msg?.serverContent
    if (sc?.interrupted) {
      handlers.onInterrupted()
    }
    if (sc?.inputTranscription?.text) {
      handlers.onInputTranscript(String(sc.inputTranscription.text))
    }
    if (sc?.outputTranscription?.text) {
      handlers.onOutputTranscript(String(sc.outputTranscription.text))
    }
    const parts = sc?.modelTurn?.parts
    if (Array.isArray(parts)) {
      for (const part of parts) {
        const inline = part?.inlineData
        if (inline?.data && String(inline.mimeType || '').includes('audio/pcm')) {
          const bin = atobToBytes(String(inline.data))
          if (bin) handlers.onAudio(bin)
        }
      }
    }
    if (sc?.turnComplete) {
      handlers.onTurnComplete()
    }
  }

  ws.onerror = () => {
    handlers.onError('Live connection error (key, network, or free-tier limit)')
  }

  ws.onclose = (event) => {
    handlers.onClose(
      closedByUs ? 'closed' : `connection closed${event?.reason ? `: ${event.reason}` : ''}`,
    )
  }

  return {
    sendAudio: (pcm16k) => {
      if (ws.readyState !== WebSocket.OPEN) return
      const msg = {
        realtimeInput: {
          mediaChunks: [{ mimeType: `audio/pcm;rate=${SEND_RATE}`, data: bytesToAtob(new Uint8Array(pcm16k)) }],
        },
      }
      ws.send(JSON.stringify(msg))
    },
    close: () => {
      closedByUs = true
      try { ws.close() } catch { /* not open */ }
    },
  }
}

function bytesToAtob(bytes: Uint8Array): string {
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

function atobToBytes(b64: string): ArrayBuffer | null {
  try {
    const binary = atob(b64)
    const out = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
    return out.buffer
  } catch {
    return null
  }
}

// ── Mic capture (16 kHz int16) + gapless playback (24 kHz) ─────────────────

export interface MicCapture {
  stop: () => void
}

/** Start capturing the mic as 16 kHz int16 chunks, handed to onChunk. */
export async function startMicCapture(onChunk: (pcm: ArrayBuffer) => void): Promise<MicCapture | null> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    })
    const ctx = new AudioContext({ sampleRate: SEND_RATE })
    const source = ctx.createMediaStreamSource(stream)
    // Inline AudioWorklet via blob URL — no build step, no extra file.
    const workletCode = `
class Capture extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(2048); this.n = 0 }
  process(inputs) {
    const ch = inputs[0][0]
    if (!ch) return true
    for (let i = 0; i < ch.length; i++) {
      this.buf[this.n++] = ch[i]
      if (this.n === 2048) {
        const out = new Int16Array(2048)
        for (let j = 0; j < 2048; j++) {
          const s = Math.max(-1, Math.min(1, this.buf[j]))
          out[j] = s < 0 ? s * 0x8000 : s * 0x7fff
        }
        this.port.postMessage(out.buffer, [out.buffer])
        this.n = 0
      }
    }
    return true
  }
}
registerProcessor('enzo-capture', Capture)
`
    const url = URL.createObjectURL(new Blob([workletCode], { type: 'application/javascript' }))
    await ctx.audioWorklet.addModule(url)
    const node = new AudioWorkletNode(ctx, 'enzo-capture')
    node.port.onmessage = (e) => onChunk(e.data as ArrayBuffer)
    source.connect(node)
    // node → NOT connected to destination (no mic feedback loop)
    return {
      stop: () => {
        try {
          node.port.onmessage = null
          node.disconnect()
          source.disconnect()
          stream.getTracks().forEach((t) => t.stop())
          void ctx.close()
          URL.revokeObjectURL(url)
        } catch { /* already torn down */ }
      },
    }
  } catch {
    // permission denied / no mic / no AudioWorklet
    return null
  }
}

/** Gapless queue for the model's 24 kHz speech — scheduled sequentially. */
export class SpeechPlayer {
  private ctx: AudioContext
  private nextAt = 0
  private sources: AudioBufferSourceNode[] = []
  private onLevel?: (level: number) => void

  constructor(opts: { onLevel?: (level: number) => void } = {}) {
    this.ctx = new AudioContext({ sampleRate: 24000 })
    this.onLevel = opts.onLevel
  }

  async resume(): Promise<void> {
    if (this.ctx.state === 'suspended') await this.ctx.resume()
  }

  /** Queue one 24 kHz int16 chunk; plays gapless after whatever is queued. */
  enqueue(pcm: ArrayBuffer): void {
    const ints = new Int16Array(pcm)
    if (!ints.length) return
    // RMS level (0..1) of this chunk — the chatbar glow breathes with it.
    if (this.onLevel) {
      let sum = 0
      for (let i = 0; i < ints.length; i++) {
        const s = ints[i] / 0x7fff
        sum += s * s
      }
      const rms = Math.sqrt(sum / ints.length)
      this.onLevel(Math.min(1, rms * 4))
    }
    const buf = this.ctx.createBuffer(1, ints.length, 24000)
    const ch = buf.getChannelData(0)
    for (let i = 0; i < ints.length; i++) ch[i] = ints[i] / 0x7fff
    const src = this.ctx.createBufferSource()
    src.buffer = buf
    src.connect(this.ctx.destination)
    const now = this.ctx.currentTime
    if (this.nextAt < now) this.nextAt = now
    src.start(this.nextAt)
    this.nextAt += buf.duration
    this.sources.push(src)
    src.onended = () => {
      this.sources = this.sources.filter((s) => s !== src)
    }
  }

  get busy(): boolean {
    return this.sources.length > 0 || this.nextAt > this.ctx.currentTime
  }

  /** Drop everything queued instantly (native barge-in / interrupt). */
  stop(): void {
    for (const s of this.sources) {
      try { s.stop() } catch { /* already ended */ }
    }
    this.sources = []
    this.nextAt = 0
  }

  destroy(): void {
    this.stop()
    void this.ctx.close()
  }
}
