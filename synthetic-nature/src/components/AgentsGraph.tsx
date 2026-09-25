/**
 * AgentsGraph.tsx — the agents tab's neural-layer tree.
 *
 * A "Graph" button opens this overlay: every saved agent as a first-level node,
 * its strongest learned associations as leaves sized by weight, and the
 * training totals (local cycles, deep tunes). The state lives server-side per
 * agent (GET /api/agents/:id/neural), so it survives logins — this view just
 * draws it. Mono theme: white on near-black, no color.
 */

import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { X } from 'lucide-react'
import { mintVaultToken } from '../lib/vaultToken'

interface NeuralAgent {
  id: string
  name: string
  neural?: {
    weightsTop: Array<{ term: string; weight: number }>
    cycles: number
    deepTunes: number
    pendingTraffic?: number
    lastTrainedAt?: number
  }
}

async function api(path: string): Promise<any> {
  const token = await mintVaultToken()
  const res = await fetch(path, { headers: token ? { 'x-vault-token': token } : {} })
  let json: any = null
  try { json = await res.json() } catch { /* empty body */ }
  return json
}

const AGENT_GAP = 150     // vertical px per agent row (fits 5 leaf rows)
const NODE_R = 9
const LEAVES = 5          // strongest terms drawn per agent
const LEAF_MAX_R = 24     // leaf radius at weight 60 (the backend's CAP_W)

export default function AgentsGraph({ onClose }: { onClose: () => void }) {
  const [agents, setAgents] = useState<NeuralAgent[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let live = true
    ;(async () => {
      const list = await api('/api/agents')
      if (!live) return
      const entries: NeuralAgent[] = list?.agents || []
      const withNeural = await Promise.all(
        entries.map(async (a) => {
          const n = await api(`/api/agents/${a.id}/neural`)
          return { ...a, neural: n?.neural }
        }),
      )
      if (live) { setAgents(withNeural); setLoaded(true) }
    })()
    return () => { live = false }
  }, [])

  const totalCycles = agents.reduce((s, a) => s + (a.neural?.cycles ?? 0), 0)
  const totalTunes = agents.reduce((s, a) => s + (a.neural?.deepTunes ?? 0), 0)
  const height = Math.max(420, agents.length * AGENT_GAP + 120)

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
      className="fixed inset-0 z-[9990] flex items-center justify-center p-4 sm:p-8 bg-black/85 backdrop-blur-md"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 18 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 10 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        onClick={(e) => e.stopPropagation()}
        className="relative flex w-full max-w-4xl max-h-full flex-col overflow-hidden rounded-2xl bg-[#0a0a0b] ring-1 ring-white/[0.08] shadow-[0_30px_90px_-12px_rgba(0,0,0,0.9),inset_0_1px_0_rgba(255,255,255,0.07)]"
      >
        <div className="flex items-center justify-between gap-3 border-b border-white/[0.07] bg-white/[0.03] px-5 py-3.5">
          <div className="min-w-0">
            <div className="font-mono-display text-[10px] uppercase tracking-[0.3em] text-white/40">Neural layer</div>
            <div className="mt-0.5 font-mono text-[13px] text-white/80">
              {loaded
                ? `${agents.length} agent${agents.length === 1 ? '' : 's'} · ${totalCycles} training cycles · ${totalTunes} deep tunes`
                : 'loading…'}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            title="Close graph"
            className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-full border border-white/[0.08] text-white/50 transition-all hover:border-white/25 hover:text-white"
          >
            <X size={12} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto scrollbar-thin p-5">
          {!loaded ? (
            <div className="grid h-40 place-items-center font-mono-display text-[10px] uppercase tracking-widest text-white/30">
              Reading the layer…
            </div>
          ) : agents.length === 0 ? (
            <div className="grid h-40 place-items-center text-sm text-white/40">
              No agents yet — the layer grows as agents learn.
            </div>
          ) : (
            <svg viewBox={`0 0 860 ${height}`} className="w-full" style={{ minWidth: 640 }}>
              <g>
                <circle cx={56} cy={height / 2} r={14} fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth={1.4} />
                <text x={56} y={height / 2 + 32} textAnchor="middle" fill="rgba(255,255,255,0.45)" style={{ fontSize: 9, letterSpacing: '0.18em', textTransform: 'uppercase' }}>
                  brain
                </text>
              </g>
              {agents.map((a, ai) => {
                const cy = 90 + ai * AGENT_GAP
                const ax = 200
                const terms = (a.neural?.weightsTop ?? []).slice(0, LEAVES)
                const weightSum = terms.reduce((s, t) => s + t.weight, 0)
                return (
                  <motion.g
                    key={a.id}
                    initial={{ opacity: 0, x: -14 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.08 + ai * 0.07, duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
                  >
                    <motion.path
                      d={`M 70 ${height / 2} C 130 ${height / 2}, 140 ${cy}, ${ax - NODE_R - 3} ${cy}`}
                      fill="none"
                      stroke="rgba(255,255,255,0.22)"
                      strokeWidth={1.1}
                      initial={{ pathLength: 0 }}
                      animate={{ pathLength: 1 }}
                      transition={{ delay: 0.12 + ai * 0.07, duration: 0.5, ease: 'easeOut' }}
                    />
                    <circle cx={ax} cy={cy} r={NODE_R} fill="#0a0a0b" stroke="rgba(255,255,255,0.75)" strokeWidth={1.4} />
                    <text x={ax + NODE_R + 8} y={cy + 4} fill="rgba(255,255,255,0.85)" style={{ fontSize: 12 }}>{a.name}</text>
                    <text x={ax + NODE_R + 8} y={cy + 19} fill="rgba(255,255,255,0.35)" style={{ fontSize: 9, fontFamily: 'monospace' }}>
                      {`w ${weightSum.toFixed(1)} · ${a.neural?.cycles ?? 0} cycles`}
                    </text>
                    {terms.map((t, ti) => {
                      const ty = cy - ((terms.length - 1) * 24) / 2 + ti * 24
                      const tx = 560
                      const r = 4 + (t.weight / 60) * (LEAF_MAX_R - 4)
                      return (
                        <g key={t.term}>
                          <motion.line
                            x1={ax + NODE_R + 3} y1={cy} x2={tx - r - 3} y2={ty}
                            stroke="rgba(255,255,255,0.16)" strokeWidth={1}
                            initial={{ pathLength: 0 }} animate={{ pathLength: 1 }}
                            transition={{ delay: 0.2 + ai * 0.07 + ti * 0.03, duration: 0.4, ease: 'easeOut' }}
                          />
                          <motion.circle
                            cx={tx} cy={ty} r={r}
                            fill="rgba(255,255,255,0.10)" stroke="rgba(255,255,255,0.45)" strokeWidth={1}
                            initial={{ scale: 0 }} animate={{ scale: 1 }}
                            transition={{ delay: 0.24 + ai * 0.07 + ti * 0.03, duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                            style={{ transformOrigin: `${tx}px ${ty}px` }}
                          />
                          <text x={tx + r + 6} y={ty + 3.5} fill="rgba(255,255,255,0.6)" style={{ fontSize: 10, fontFamily: 'monospace' }}>
                            {t.term}
                          </text>
                        </g>
                      )
                    })}
                  </motion.g>
                )
              })}
            </svg>
          )}
        </div>
      </motion.div>
    </motion.div>
  )
}
