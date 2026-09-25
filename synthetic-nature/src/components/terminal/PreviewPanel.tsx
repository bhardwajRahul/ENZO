/**
 * PreviewPanel.tsx — the live code-preview side panel.
 *
 * Black paper: near-black base, wrinkle + grain textures, slow drifting
 * smears, deep shadows, one-shot sheen on open. Portaled to <body> so it
 * escapes ancestor transforms/overflow and always renders ABOVE the app header
 * + terminal chrome (viewport-level stacking). The dock/reflow math lives in
 * TerminalSection (it owns the grid this panel docks beside); this component
 * owns the look and the choreography.
 */

import { createPortal } from 'react-dom'
import { motion, AnimatePresence, type Variants } from 'framer-motion'
import { Monitor, Download, ExternalLink, Copy, Check, RefreshCw, X } from 'lucide-react'

export interface PreviewData {
  id: string
  url: string
  title: string
  isProject?: boolean
  files?: { path: string; size: number }[]
}

interface PreviewPanelProps {
  preview: PreviewData | null
  open: boolean
  sideDrawerOpen: boolean
  maximized: boolean
  lowPower: boolean
  copied: boolean
  frameKey: number
  storedTask: { id: string } | null
  storedFileCount: number
  absoluteUrl: string
  onZip: () => void
  onCopyUrl: () => void
  onReload: () => void
  onClose: () => void
  onReopen: () => void
}

const panelVariants: Variants = {
  hidden: { opacity: 0, x: 64, scale: 0.955, filter: 'blur(8px)' },
  show: {
    opacity: 1,
    x: 0,
    scale: 1,
    filter: 'blur(0px)',
    transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1], staggerChildren: 0.07, delayChildren: 0.1 },
  },
  dimmed: { opacity: 0, x: 56, scale: 0.97, transition: { duration: 0.25, ease: 'easeIn' } },
  exit: { opacity: 0, x: 48, scale: 0.975, filter: 'blur(4px)', transition: { duration: 0.28, ease: 'easeIn' } },
}

const sectionVariants: Variants = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] } },
  dimmed: { opacity: 0, transition: { duration: 0.15 } },
  exit: { opacity: 0, y: 8, transition: { duration: 0.2, ease: 'easeIn' } },
}

export default function PreviewPanel({
  preview,
  open,
  sideDrawerOpen,
  maximized,
  lowPower,
  copied,
  frameKey,
  storedTask,
  storedFileCount,
  absoluteUrl,
  onZip,
  onCopyUrl,
  onReload,
  onClose,
  onReopen,
}: PreviewPanelProps) {
  if (!preview) return null

  return createPortal(
    <>
      {/* Paper texture filter defs — rendered as an inline <svg><rect>
          (not a CSS filter url()) so every engine, Safari included,
          rasterizes them. Lives inside the portal so the id is always in
          the same document as the panel. */}
      <svg width="0" height="0" aria-hidden="true" className="absolute">
        <defs>
          <filter id="enzo-paper-wrinkle" x="-5%" y="-5%" width="110%" height="110%">
            <feTurbulence type="fractalNoise" baseFrequency="0.011 0.016" numOctaves="4" seed="11" result="bumps" />
            <feDiffuseLighting in="bumps" lightingColor="#ffffff" surfaceScale="2.2" diffuseConstant="1.05">
              <feDistantLight azimuth="235" elevation="58" />
            </feDiffuseLighting>
          </filter>
          <filter id="enzo-paper-grain">
            <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="4" />
            <feColorMatrix type="saturate" values="0" />
          </filter>
        </defs>
      </svg>

      {/* Floating reopen tab — shown when a preview exists but the panel is
          closed so the user can summon it back without re-asking the model.
          The vertical centering lives inside framer's transform (y: '-50%')
          because framer's inline transform would defeat the old class. */}
      <AnimatePresence>
        {!open && preview && (
          <motion.button
            type="button"
            initial={{ opacity: 0, x: 44, y: '-50%', scale: 0.9 }}
            animate={{ opacity: sideDrawerOpen ? 0 : 1, x: 0, y: '-50%', scale: 1 }}
            exit={{ opacity: 0, x: 44, scale: 0.9, transition: { duration: 0.2, ease: 'easeIn' } }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            whileTap={{ scale: 0.94 }}
            onClick={onReopen}
            className={`fixed top-1/2 right-0 z-[9997] flex items-center gap-2 rounded-l-xl border border-r-0 border-white/[0.10] bg-[#0a0a0c]/95 backdrop-blur-md px-3 py-2.5 text-white/70 hover:text-white hover:border-white/25 shadow-[0_10px_36px_rgba(0,0,0,0.65),inset_0_1px_0_rgba(255,255,255,0.07)] cursor-pointer ${sideDrawerOpen ? 'pointer-events-none' : ''}`}
          >
            <Monitor size={14} className="text-white/70" />
            <span className="text-[10px] font-mono uppercase tracking-widest">Preview</span>
          </motion.button>
        )}
      </AnimatePresence>

      {/* The `dimmed` variant replaces a Tailwind opacity-0 toggle — an inline
          framer opacity always beat that class, so the panel never actually
          faded when a drawer opened. */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial="hidden"
            animate={sideDrawerOpen ? 'dimmed' : 'show'}
            exit="exit"
            variants={panelVariants}
            style={{ pointerEvents: sideDrawerOpen ? 'none' : 'auto' }}
            whileTap={{ scale: 0.997 }}
            className={`fixed ${maximized ? 'top-2' : 'top-20'} bottom-2 right-2 z-[9998] w-[min(46vw,640px)] min-w-[360px] flex flex-col overflow-hidden rounded-xl transition-[top] duration-300 will-change-transform ring-1 ring-white/[0.07] shadow-[0_30px_90px_-12px_rgba(0,0,0,0.9),0_12px_36px_rgba(0,0,0,0.7),inset_0_1px_0_rgba(255,255,255,0.09),inset_0_-1px_0_rgba(0,0,0,0.65)]`}
          >
            {/* Paper base + textures + smears — z-0, under the content */}
            <div
              aria-hidden
              className="absolute inset-0 z-0 bg-[radial-gradient(130%_110%_at_18%_0%,#1a1a1c_0%,#0c0c0d_48%,#060607_100%)]"
            />
            <svg aria-hidden className="absolute inset-0 z-0 h-full w-full opacity-[0.16] mix-blend-screen">
              <rect width="100%" height="100%" filter="url(#enzo-paper-wrinkle)" />
            </svg>
            <svg aria-hidden className="absolute inset-0 z-0 h-full w-full opacity-[0.05] mix-blend-screen">
              <rect width="100%" height="100%" filter="url(#enzo-paper-grain)" />
            </svg>
            {!lowPower && (
              <>
                <motion.div
                  aria-hidden
                  className="absolute -left-20 top-10 z-0 h-64 w-64 rounded-full blur-2xl"
                  style={{ background: 'radial-gradient(closest-side, rgba(255,255,255,0.055), transparent)' }}
                  animate={{ x: [0, 28, -10, 0], y: [0, -16, 12, 0] }}
                  transition={{ duration: 27, repeat: Infinity, ease: 'easeInOut' }}
                />
                <motion.div
                  aria-hidden
                  className="absolute right-10 bottom-24 z-0 h-80 w-80 rounded-full blur-2xl"
                  style={{ background: 'radial-gradient(closest-side, rgba(255,255,255,0.045), transparent)' }}
                  animate={{ x: [0, -34, 14, 0], y: [0, 18, -12, 0] }}
                  transition={{ duration: 33, repeat: Infinity, ease: 'easeInOut', delay: 4 }}
                />
                <motion.div
                  aria-hidden
                  className="absolute left-1/3 top-1/2 z-0 h-52 w-72 rounded-full blur-2xl"
                  style={{ background: 'radial-gradient(closest-side, rgba(255,255,255,0.04), transparent)' }}
                  animate={{ x: [0, 22, 18, 0], y: [0, 12, -14, 0] }}
                  transition={{ duration: 24, repeat: Infinity, ease: 'easeInOut', delay: 9 }}
                />
              </>
            )}

            {/* Panel header — mild glass strip over the paper */}
            <motion.div
              variants={sectionVariants}
              className="relative z-10 flex items-center justify-between gap-2 border-b border-white/[0.07] px-3.5 py-2.5 bg-white/[0.04] backdrop-blur-md"
            >
              <div className="flex items-center gap-2 min-w-0">
                <Monitor size={13} className="text-white/70 shrink-0" />
                <span className="text-[10px] font-mono uppercase tracking-widest text-white/60 truncate">
                  {preview.title || 'Live Preview'}
                </span>
                {preview.isProject && (
                  <span className="shrink-0 rounded-full bg-white/[0.06] border border-white/[0.08] px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-widest text-white/70">
                    {preview.files?.length ?? 0} files
                  </span>
                )}
                {storedFileCount > 0 && (
                  <span className="shrink-0 rounded-full bg-white/[0.06] border border-white/[0.08] px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-widest text-white/70">
                    saved {storedFileCount}
                  </span>
                )}
                <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-white/[0.06] border border-white/[0.08] px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-widest text-white/70">
                  <motion.span
                    aria-hidden
                    className="h-1 w-1 rounded-full bg-white/80"
                    animate={{ opacity: [1, 0.25, 1] }}
                    transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
                  />
                  running
                </span>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={onZip}
                  disabled={!storedTask}
                  title="Download these files as a .zip"
                  className={`flex items-center gap-1.5 rounded-xl border px-2 py-1.5 text-[10px] font-mono uppercase tracking-widest transition-all cursor-pointer ${
                    storedTask
                      ? 'border-white/[0.10] text-white/70 hover:text-white hover:border-white/25 hover:bg-white/[0.06]'
                      : 'border-white/[0.06] text-white/30 cursor-not-allowed'
                  }`}
                >
                  <Download size={10} />
                  ZIP
                </button>
                <a
                  href={absoluteUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Open in a new tab"
                  className="flex items-center gap-1.5 rounded-xl border border-white/[0.10] px-2 py-1.5 text-[10px] font-mono uppercase tracking-widest text-white/70 hover:text-white hover:border-white/25 hover:bg-white/[0.06] transition-all cursor-pointer"
                >
                  <ExternalLink size={10} />
                  Open new tab
                </a>
                <button
                  type="button"
                  onClick={onCopyUrl}
                  title="Copy preview URL"
                  className="flex items-center gap-1 rounded-xl border border-white/[0.08] px-2 py-1.5 text-[10px] font-mono uppercase tracking-widest text-white/50 hover:text-white hover:border-white/25 transition-all cursor-pointer"
                >
                  {copied ? <Check size={10} className="text-white/85" /> : <Copy size={10} />}
                  {copied ? 'Copied' : 'URL'}
                </button>
                <button
                  type="button"
                  onClick={onReload}
                  title="Reload preview"
                  className="w-7 h-7 flex items-center justify-center rounded-xl border border-white/[0.08] text-white/50 hover:text-white hover:border-white/25 transition-all cursor-pointer"
                >
                  <RefreshCw size={11} />
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  title="Close preview"
                  className="w-7 h-7 flex items-center justify-center rounded-xl border border-white/[0.08] text-white/50 hover:text-white hover:border-white/25 hover:bg-white/[0.06] transition-all cursor-pointer"
                >
                  <X size={12} />
                </button>
              </div>
            </motion.div>

            {/* File tree strip (multi-file projects) */}
            {preview.isProject && preview.files && preview.files.length > 0 && (
              <motion.div
                variants={sectionVariants}
                className="relative z-10 flex items-center gap-1.5 overflow-x-auto scrollbar-none border-b border-white/[0.07] px-3 py-1.5 bg-white/[0.03] backdrop-blur-sm"
              >
                {preview.files.map((f) => (
                  <span
                    key={f.path}
                    className="shrink-0 rounded-full border border-white/[0.08] bg-white/[0.04] px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-white/55"
                    title={f.path}
                  >
                    {f.path}
                  </span>
                ))}
              </motion.div>
            )}

            {/* Preview body — clean white print mounted on the paper */}
            <motion.div variants={sectionVariants} className="relative z-10 flex-1 min-h-0 p-1.5">
              {/* NOTE: do not add allow-same-origin here. The code in this
                  frame is written by an LLM and served from our own origin,
                  so allow-scripts + allow-same-origin together let it reach
                  window.parent.localStorage — every provider key and the
                  auth token — and the two tokens combined are documented as
                  removing protections "in the same way" as no sandbox at all.
                  Without it the frame gets an opaque origin: parent access
                  throws SecurityError, while relative fetch, forms, popups
                  and pointer lock all still work. The backend mirrors this
                  via a `Content-Security-Policy: sandbox` header on
                  /api/preview, so the open-in-new-tab path is isolated too. */}
              <div className="h-full w-full overflow-hidden rounded-lg bg-white shadow-[inset_0_0_0_1px_rgba(0,0,0,0.08),0_1px_0_rgba(255,255,255,0.04)]">
                <iframe
                  key={frameKey}
                  title="ENZO live preview"
                  src={preview.url}
                  sandbox="allow-scripts allow-forms allow-modals allow-popups allow-pointer-lock"
                  className="h-full w-full border-0"
                />
              </div>
            </motion.div>

            {/* Paper edge vignette — above the body but faint enough to
                keep the preview content clean */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 z-20 rounded-xl shadow-[inset_0_0_34px_rgba(0,0,0,0.38)]"
            />

            {/* One-shot sheen sweep on open — screen blend, so it only
                reads on the dark paper and never washes the preview */}
            <motion.div
              aria-hidden
              initial={{ x: '-170%', skewX: -16 }}
              animate={{ x: '340%' }}
              transition={{ duration: 1.15, delay: 0.55, ease: [0.3, 0, 0.2, 1] }}
              className="pointer-events-none absolute inset-y-0 z-30 w-1/3"
              style={{
                background:
                  'linear-gradient(90deg, transparent, rgba(255,255,255,0.09) 42%, rgba(255,255,255,0.15) 50%, rgba(255,255,255,0.09) 58%, transparent)',
                mixBlendMode: 'screen',
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </>,
    document.body,
  )
}
