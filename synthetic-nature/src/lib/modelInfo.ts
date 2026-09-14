// Background facts for a catalog model, from three keyless public endpoints.
//
//  - openrouter.ai/api/v1/models — one request for the whole OpenRouter
//    catalog, which also publishes each model's authoritative
//    `hugging_face_id`, knowledge cutoff and Artificial Analysis scores.
//    Covers every OpenRouter id and, because Puter and Pollinations proxy the
//    same slugs, most of theirs as well.
//  - huggingface.co/api/models/{repo} — exact repo lookup, for real
//    download/like counts, pipeline tag, licence and publish date.
//  - api.duckduckgo.com Instant Answer — one paragraph of Wikipedia-backed
//    prose about the model *family*.
//
// The repo is never guessed. An earlier version searched HuggingFace by
// display name and got confident lookalikes back: "ALLAM-2-7B" resolved to
// EdBerg/ALlama-2-7B, "alphafold2" to MurrellLab/AlphaFold2.jl, and the
// Pollinations community model "agnes-2.5-flash" to an unrelated
// Agnes-AI/Agnes-2.5-Flash-Base — so the panel showed another project's
// download counts as if they were this model's. The repo now comes only from
// an `hf/` catalog id or OpenRouter's own mapping, both exact. Models with no
// public record say so instead.
//
// DDG is queried by family, not by model name: its Instant Answer index only
// covers encyclopedia topics, so "Llama 3.3 70B Instruct" returns nothing
// while "Llama language model" returns the Meta AI article. All three
// endpoints send CORS headers and need no key, so this runs in the browser.

export interface ModelInfo {
  /** HuggingFace repo id, e.g. "meta-llama/Llama-3.3-70B-Instruct". */
  repo?: string
  downloads?: number
  likes?: number
  pipeline?: string
  license?: string
  tags?: string[]
  /** ISO date the repo was first published. */
  createdAt?: string
  /** Wikipedia-backed paragraph about the model family. */
  abstract?: string
  abstractSource?: string
  abstractUrl?: string
  /** OpenRouter's own prose — richer than the gateway boilerplate the
   *  catalog carries for Puter, Pollinations, LLM7 and HuggingFace models. */
  summary?: string
  /** OpenRouter model id, e.g. "deepseek/deepseek-v4-flash". */
  orId?: string
  /** e.g. "text->text", "text+image->text". */
  modality?: string
  tokenizer?: string
  maxCompletion?: number
  knowledgeCutoff?: string
  /** Artificial Analysis indices, where published. */
  intelligence?: number
  coding?: number
}

/**
 * Family name → a DDG query that actually resolves to an article.
 *
 * The bare family word is ambiguous for most of these ("llama" is the animal,
 * "mistral" is a wind, "phi" is a letter), so each carries a disambiguating
 * suffix. Every term here was checked against the live endpoint; families
 * whose article DDG doesn't surface are simply absent, and the panel renders
 * without the prose block.
 */
const FAMILY_QUERY: Record<string, string> = {
  llama: 'Llama language model',
  qwen: 'Qwen',
  deepseek: 'DeepSeek',
  mistral: 'Mistral AI',
  mixtral: 'Mistral AI',
  codestral: 'Mistral AI',
  gemma: 'Gemma language model',
  gemini: 'Gemini language model',
  phi: 'Phi language model',
  gpt: 'GPT-4',
  claude: 'Claude language model',
  flux: 'FLUX.1',
  'stable-diffusion': 'Stable Diffusion',
  stablediffusion: 'Stable Diffusion',
  sdxl: 'Stable Diffusion',
}

/** The first known family keyword in the model name, if any. */
function familyQuery(name: string): string | undefined {
  const hay = name.toLowerCase()
  for (const key of Object.keys(FAMILY_QUERY)) {
    if (hay.includes(key)) return FAMILY_QUERY[key]
  }
  return undefined
}

/** Catalog ids are provider-prefixed: "puter/aion-2.0", "hf/swiss-ai/…". */
const PROVIDER_PREFIX = /^(hf|openrouter|groq|puter|llm7|pollinations|nvidia|google|cloudflare)\//

interface OrModel {
  id: string
  canonical_slug?: string
  description?: string
  hugging_face_id?: string
  knowledge_cutoff?: string
  architecture?: { modality?: string; tokenizer?: string }
  top_provider?: { max_completion_tokens?: number }
  benchmarks?: { artificial_analysis?: { intelligence_index?: number; coding_index?: number } }
}

// ponytail: the whole OpenRouter catalog in one request (~450 models),
// fetched on first dialog open and shared by every model after. Per-model
// GETs would be 2000 requests for the same payload. Swap to
// /api/v1/models/{id} only if the list response ever gets too big to hold.
let orIndex: Promise<Map<string, OrModel>> | null = null

function openRouterIndex(): Promise<Map<string, OrModel>> {
  orIndex ??= fetch('https://openrouter.ai/api/v1/models')
    .then((r) => (r.ok ? r.json() : { data: [] }))
    .then(({ data }: { data: OrModel[] }) => {
      const idx = new Map<string, OrModel>()
      // First writer wins, so an exact id is never shadowed by another
      // model's shortened alias.
      const put = (key: string | undefined, m: OrModel) => {
        if (key && !idx.has(key)) idx.set(key, m)
      }
      for (const m of data ?? []) {
        put(m.id, m)
        put(m.canonical_slug, m)
        // Puter drops the vendor ("puter/aion-2.0" for "aion-labs/aion-2.0"),
        // and several gateways drop the ":free" variant suffix.
        const tail = m.id.split('/').slice(1).join('/')
        put(tail, m)
        put(tail.replace(/:.*$/, ''), m)
      }
      return idx
    })
    .catch(() => {
      // Don't cache the failure: a reload mid-flight aborts this request, and
      // a stuck empty index would silently strip every later dossier for the
      // rest of the session. Next dialog retries.
      orIndex = null
      return new Map<string, OrModel>()
    })
  return orIndex
}

/**
 * The OpenRouter record for a catalog id, matched on exact slug equality.
 *
 * Tried unstripped first so a catalog id that already is an OpenRouter id
 * ("google/gemini-2.0-flash") can't be mangled by prefix removal.
 */
async function fetchOpenRouter(id: string): Promise<Partial<ModelInfo>> {
  const idx = await openRouterIndex()
  const bare = id.replace(PROVIDER_PREFIX, '')
  const m =
    idx.get(id) ?? idx.get(bare) ?? idx.get(bare.replace(/:.*$/, ''))
  if (!m) return {}
  const aa = m.benchmarks?.artificial_analysis
  return {
    orId: m.id,
    repo: m.hugging_face_id || undefined,
    summary: m.description,
    modality: m.architecture?.modality,
    tokenizer: m.architecture?.tokenizer,
    maxCompletion: m.top_provider?.max_completion_tokens,
    knowledgeCutoff: m.knowledge_cutoff,
    intelligence: aa?.intelligence_index,
    coding: aa?.coding_index,
  }
}

/**
 * Exact HuggingFace repo paths to try for a catalog id, best first.
 *
 * Every candidate is a path the id itself asserts — OpenRouter's own mapping,
 * or the id with its gateway prefix removed. Nothing is searched or
 * reconstructed, so a path no one published just 401s and we move on.
 *
 * NVIDIA needs the second candidate: its NIM ids are
 * "nvidia/{upstream-publisher}/{model}", so stripping the prefix leaves the
 * upstream repo path verbatim ("nvidia/google/deplot" → "google/deplot").
 * NVIDIA's own NIMs are single-segment and published under the `nvidia` org,
 * so there the whole id is the path. HuggingFace resolves these
 * case-insensitively and answers with the canonical id, which is what gets
 * stored — "nvidia/cosmos3-nano" comes back as "nvidia/Cosmos3-Nano".
 */
function repoCandidates(id: string, orRepo?: string): string[] {
  const bare = id.replace(PROVIDER_PREFIX, '')
  const fromId = bare.includes('/') ? bare : id.startsWith('nvidia/') ? id : undefined
  return [orRepo, fromId].filter((c): c is string => !!c)
}

async function fetchHf(repo: string): Promise<Partial<ModelInfo>> {
  const res = await fetch(`https://huggingface.co/api/models/${repo}`)
  // 401 is HuggingFace's answer for "no such repo" as well as for gated ones.
  if (!res.ok) return {}
  const m = (await res.json()) as any
  if (!m?.id) return {}
  return {
    repo: m.id,
    downloads: m.downloads,
    likes: m.likes,
    pipeline: m.pipeline_tag,
    license: m.cardData?.license,
    createdAt: m.createdAt,
    // The raw tag list carries plumbing ("safetensors", "region:us", "arxiv:…")
    // alongside the useful ones; keep the human-readable head.
    tags: (m.tags ?? []).filter((t: string) => !t.includes(':')).slice(0, 8),
  }
}

async function fetchDdg(name: string): Promise<Partial<ModelInfo>> {
  const q = familyQuery(name)
  if (!q) return {}
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_html=1&skip_disambig=1`
  const res = await fetch(url)
  if (!res.ok) return {}
  const j = await res.json()
  if (!j?.AbstractText) return {}
  return { abstract: j.AbstractText, abstractSource: j.AbstractSource, abstractUrl: j.AbstractURL }
}

// ponytail: plain Map, no TTL. These are stable facts about published models
// and the cache dies with the tab — add expiry only if a session ever runs
// long enough for download counts to matter.
const cache = new Map<string, Promise<ModelInfo>>()

/**
 * Everything known about one catalog model, merged.
 *
 * OpenRouter resolves first because it supplies the HuggingFace repo for
 * models whose own id doesn't carry one; the HF call then runs only against
 * paths the id already asserts, exact. Any leg failing (offline, blocked,
 * rate-limited) yields its half empty rather than rejecting — a partial panel
 * beats an error state for what is supplementary information.
 */
export function fetchModelInfo(id: string, name: string): Promise<ModelInfo> {
  const hit = cache.get(id)
  if (hit) return hit

  const job = Promise.all([
    fetchOpenRouter(id).catch(() => ({} as Partial<ModelInfo>)),
    fetchDdg(name).catch(() => ({} as Partial<ModelInfo>)),
  ]).then(async ([or, ddg]) => {
    let hf: Partial<ModelInfo> = {}
    for (const repo of repoCandidates(id, or.repo)) {
      hf = await fetchHf(repo).catch(() => ({}))
      if (hf.repo) break
    }
    return { ...or, ...ddg, ...hf }
  })

  cache.set(id, job)
  return job
}

/** 901750 → "901.8K". Download counts are the one place the numbers get long. */
export function compactNumber(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return String(n)
}
