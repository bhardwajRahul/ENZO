import { ReactNode } from 'react'

import { Badge } from './badge'
import { Card, CardContent, CardFooter, CardHeader } from './card'
import { cn } from '../../lib/utils'

/** Cheap stable string hash — pins a model to the same light direction. */
function hash(seed: string): number {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0
  return Math.abs(h)
}

/**
 * Brand colour per platform, keyed lowercase so provider casing can't miss.
 *
 * The catalogue is served by a closed set of seven platforms (see
 * /api/v1/models), so the cover is their own brand mark rather than a stock
 * photo. LLM7 has no published brand colour; it gets the neutral slate.
 */
const PROVIDER_BRAND: Record<string, string> = {
  nvidia: '#76b900',
  huggingface: '#ffd21e',
  pollinations: '#b24bf3',
  openrouter: '#6467f2',
  puter: '#2b77e4',
  groq: '#f55036',
  llm7: '#64748b',
}
const BRAND_FALLBACK = '#8b8b93'

/**
 * The platform's own cover art, normalised to 768x320 in public/model_covers.
 *
 * Pollinations is deliberately absent — it has no published banner, so it
 * falls back to the brand plate plus favicon below.
 */
const PROVIDER_COVER: Record<string, string> = {
  nvidia: '/model_covers/nvidia.jpg',
  huggingface: '/model_covers/huggingface.jpg',
  openrouter: '/model_covers/openrouter.jpg',
  puter: '/model_covers/puter.jpg',
  groq: '/model_covers/groq.jpg',
  llm7: '/model_covers/llm7.jpg',
}

const PROVIDER_DOMAIN: Record<string, string> = {
  nvidia: 'nvidia.com',
  huggingface: 'huggingface.co',
  pollinations: 'pollinations.ai',
  openrouter: 'openrouter.ai',
  puter: 'puter.com',
  groq: 'groq.com',
  llm7: 'llm7.io',
}

/**
 * The platform's own logo, pulled from Google's favicon service.
 *
 * Keyless, no account and no practical rate limit, and it resolves for any
 * domain — so a new provider only needs a line in PROVIDER_DOMAIN, not a
 * committed asset. `sz=256` asks for the largest icon the site publishes
 * (256px for HuggingFace and OpenRouter, 180px for most, 48px for NVIDIA),
 * all of which are oversampled for the 44px mark. Returns undefined for
 * unknown providers, and the plate alone carries the tile.
 */
function providerLogo(provider: string): string | undefined {
  const domain = PROVIDER_DOMAIN[provider.toLowerCase()]
  return domain && `https://www.google.com/s2/favicons?domain=${domain}&sz=256`
}

/**
 * The platform's brand plate, rendered at low alpha over the card's own black.
 *
 * Kept dim on purpose: `grayscale` drops the whole tile — plate and logo — to
 * grey at rest and hover restores the brand hue, so colour is a response to
 * the cursor instead of fifteen competing gradients in the grid. It also
 * carries the tile on its own when the logo can't be reached (air-gapped
 * self-host, ad blocker, corporate proxy). The seeded hairlines and sweep
 * angle give same-provider cards their own surface.
 */
function brandPlate(provider: string, seed: string): string {
  const c = PROVIDER_BRAND[provider.toLowerCase()] ?? BRAND_FALLBACK
  const h = hash(seed)
  const gap = 7 + ((h >> 16) % 6)
  return (
    `repeating-linear-gradient(${(h >> 8) % 180}deg, rgba(255,255,255,0.05) 0 1px, transparent 1px ${gap}px), ` +
    `linear-gradient(${100 + (h % 70)}deg, ${c}59, ${c}1c 58%, ${c}0a)`
  )
}

export interface ModelCardProps {
  name: string
  description?: string
  /** Platform name — also picks the cover's brand plate. */
  provider: string
  /** Friendly modality, e.g. "Multimodal". Rendered as the badge. */
  type?: string
  /** Preformatted context window, e.g. "33K ctx". */
  context?: string
  /** "Free", or a per-token price string. */
  price?: string
  tags?: string[]
  status?: 'online' | 'offline' | 'checking'
  /** Preformatted probe latency, e.g. "412ms". */
  latency?: string
  statusTitle?: string
  active?: boolean
  actionLabel?: string
  onSelect?: () => void
  onEnter?: () => void
  onLeave?: () => void
  tourStep?: string
  className?: string
  /** Absolutely-positioned overlays (the telemetry popover) — the card root is
   *  the positioning context, and is deliberately not `overflow-hidden`. */
  children?: ReactNode
}

export function ModelCard({
  name,
  description,
  provider,
  type,
  context,
  price,
  tags,
  status = 'checking',
  latency,
  statusTitle,
  active,
  actionLabel = 'Chat',
  onSelect,
  onEnter,
  onLeave,
  tourStep,
  className,
  children,
}: ModelCardProps) {
  const meta = [context, type, price].filter(Boolean)
  const visibleTags = (tags ?? []).slice(0, 2)
  const cover = PROVIDER_COVER[provider.toLowerCase()]
  const logo = providerLogo(provider)

  return (
    <Card
      data-model-card
      data-tour-step={tourStep}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      className={cn(
        'group relative flex w-full flex-col gap-2.5 rounded-3xl border p-3 transition-colors duration-300',
        // ponytail: hover:z-50 is load-bearing. backdrop-blur-xl makes this card
        // a stacking context, so the telemetry popover's own z-50 is trapped
        // inside it and the whole card sorts at z-auto — below the Catalog AI
        // Advisor's z-30, which then paints through the popover. Lifting the
        // card above 30 while hovered fixes it. Capped by the z-10 transformed
        // ancestor both share, so it can't escape over the z-40 nav.
        'hover:z-50',
        'border-white/[0.07] bg-[#08090b]/60 backdrop-blur-xl hover:border-white/20',
        active && 'border-white/30',
        className,
      )}
    >
      {children}

      <CardHeader className="p-0">
        <div className="relative h-32 w-full overflow-hidden rounded-2xl bg-[#0b0c0f]">
          {cover ? (
            /* Dimmed as well as desaturated: the banners sit on their own
               backgrounds (white for HuggingFace, orange for Groq), so grayscale
               alone would still leave the grid unevenly lit at rest. */
            <img
              src={cover}
              alt={provider}
              loading="lazy"
              decoding="async"
              className="absolute inset-0 h-full w-full object-cover opacity-[0.6] grayscale transition-all duration-500 group-hover:scale-[1.04] group-hover:opacity-100 group-hover:grayscale-0"
            />
          ) : (
            <>
              {/* One filter on the wrapper grades plate and logo together. */}
              <div className="absolute inset-0 grayscale transition-all duration-500 group-hover:grayscale-0">
                <div
                  className="absolute inset-0 transition-transform duration-500 group-hover:scale-[1.04]"
                  style={{ backgroundImage: brandPlate(provider, name) }}
                />
                {logo && (
                  <img
                    src={logo}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className="absolute left-1/2 top-1/2 h-11 w-11 -translate-x-1/2 -translate-y-[70%] object-contain opacity-80 transition-opacity duration-500 group-hover:opacity-100"
                    // Falls back to the plate and wordmark, not a broken-image icon.
                    onError={(e) => {
                      e.currentTarget.style.display = 'none'
                    }}
                  />
                )}
              </div>

              <span className="absolute bottom-4 left-0 right-0 text-center font-mono-display text-[9px] uppercase tracking-[0.28em] text-white/45 transition-colors duration-500 group-hover:text-white/80">
                {provider}
              </span>
            </>
          )}

          {/* Pill backing: the light banners (HuggingFace, LLM7) would swallow a white dot. */}
          <div
            className="absolute right-2.5 top-2.5 flex items-center gap-2 rounded-full bg-black/45 px-2 py-1 backdrop-blur-sm"
            title={statusTitle}
          >
            {latency && <span className="font-mono text-[9px] text-white/55">{latency}</span>}
            <span
              className={cn(
                'h-1.5 w-1.5 rounded-full',
                status === 'checking' && 'animate-pulse bg-white/40',
                status === 'online' && 'bg-white/85',
                status === 'offline' && 'bg-[#f0968a]/80',
              )}
            />
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex-grow p-2 pt-0">
        {meta.length > 0 && (
          <div className="mb-2 flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.12em] text-white/40">
            {type && (
              <Badge className="rounded-full border-white/10 bg-white/[0.06] px-2 py-0 font-mono-display text-[8px] font-normal uppercase tracking-[0.12em] text-white/60">
                {type}
              </Badge>
            )}
            {context && <span>{context}</span>}
            {context && price && <span className="text-white/15">/</span>}
            {price && <span className={price === 'Free' ? 'text-white/70' : undefined}>{price}</span>}
          </div>
        )}

        <h3 className="truncate font-sans text-[15px] font-semibold leading-snug text-white/95" title={name}>
          {name}
        </h3>

        {description && (
          <p className="mt-1.5 line-clamp-2 font-sans text-[12px] leading-[1.6] text-white/45">{description}</p>
        )}
      </CardContent>

      <CardFooter className="flex items-center justify-between gap-3 p-2 pt-0">
        <div className="flex flex-wrap gap-1.5">
          {visibleTags.map((tag) => (
            <span
              key={tag}
              className="rounded-full border border-white/[0.09] px-2 py-[3px] font-mono-display text-[8px] uppercase tracking-[0.1em] text-white/45"
            >
              {tag}
            </span>
          ))}
        </div>

        <button
          type="button"
          onClick={onSelect}
          className="btn-chitchat flex-shrink-0"
        >
          <span>{actionLabel}</span>
        </button>
      </CardFooter>
    </Card>
  )
}
