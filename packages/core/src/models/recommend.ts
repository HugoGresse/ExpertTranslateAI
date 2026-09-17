import type { ModelInfo, Role, RoleModels } from '../types.ts'

export type ModelPreset = 'economy' | 'balanced' | 'best'

export interface ModelRecommendation {
  models: RoleModels
  /** One line per role explaining the pick, for the UI. */
  reasons: Record<Role, string>
}

interface Family {
  /** Matches the model id. */
  pattern: RegExp
  family: string
  /** Rough translation-quality tier, 0–100, from public benchmarks and experience; refreshed by hand. */
  quality: number
}

/** Ordered by preference within a tier; unknown models get a middling tier and compete on price. */
const FAMILIES: Family[] = [
  { pattern: /^anthropic\/claude-(opus|fable)/, family: 'anthropic', quality: 96 },
  { pattern: /^anthropic\/claude-sonnet/, family: 'anthropic', quality: 92 },
  { pattern: /^openai\/gpt-5(?!.*(mini|nano))/, family: 'openai', quality: 92 },
  { pattern: /^google\/gemini-(2\.5|3)[^/]*pro/, family: 'google', quality: 90 },
  { pattern: /^openai\/gpt-4\.1(?!.*(mini|nano))/, family: 'openai', quality: 86 },
  { pattern: /^deepseek\/deepseek-(v3|v4|chat)/, family: 'deepseek', quality: 84 },
  { pattern: /^mistralai\/mistral-(large|medium)/, family: 'mistral', quality: 80 },
  { pattern: /^qwen\/qwen3?-(235b|max|plus)/, family: 'qwen', quality: 78 },
  { pattern: /^meta-llama\/llama-4-maverick/, family: 'meta', quality: 74 },
  { pattern: /^anthropic\/claude-haiku/, family: 'anthropic', quality: 78 },
  { pattern: /^google\/gemini-(2\.5|3)[^/]*flash(?!-lite)/, family: 'google', quality: 78 },
  { pattern: /^openai\/gpt-(5|4\.1)-mini/, family: 'openai', quality: 74 },
  { pattern: /^google\/gemini-[^/]*flash-lite/, family: 'google', quality: 66 },
  { pattern: /^openai\/gpt-(5|4\.1)-nano/, family: 'openai', quality: 62 },
  { pattern: /^mistralai\/mistral-small/, family: 'mistral', quality: 66 },
]

/** `:batch`, `:free`, `:online`, `:nitro`, `:thinking`… are routing variants, not plain chat models. */
const EXCLUDE = /:[a-z-]+$|preview|exp-|-beta|instruct-|vision|embed|whisper|tts|image|audio/i

interface Rated {
  model: ModelInfo
  family: string
  quality: number
  /** Completion price in USD per million tokens (what dominates translation cost). */
  price: number
}

const familyOf = (id: string): string => id.split('/')[0] ?? id

function rate(model: ModelInfo): Rated | null {
  if (EXCLUDE.test(model.id) || model.pricing.completionUsdPerToken < 0) return null
  const hit = FAMILIES.find((f) => f.pattern.test(model.id))
  return {
    model,
    family: hit?.family ?? familyOf(model.id),
    quality: hit?.quality ?? 50,
    price: model.pricing.completionUsdPerToken * 1e6,
  }
}

interface RoleSpec {
  role: Role
  minQuality: number
  /** Price ceiling per preset, USD per million completion tokens. */
  ceiling: Record<ModelPreset, number>
  /** Prefer a family not used by these roles. */
  differentFrom: Role[]
  cheapest?: boolean
}

const SPECS: RoleSpec[] = [
  {
    role: 'translatorA',
    minQuality: 80,
    ceiling: { economy: 3, balanced: 20, best: 1000 },
    differentFrom: [],
  },
  {
    role: 'translatorB',
    minQuality: 78,
    ceiling: { economy: 3, balanced: 20, best: 1000 },
    differentFrom: ['translatorA'],
  },
  {
    role: 'translatorC',
    minQuality: 74,
    ceiling: { economy: 3, balanced: 20, best: 1000 },
    differentFrom: ['translatorA', 'translatorB'],
  },
  {
    role: 'reviewer',
    minQuality: 84,
    ceiling: { economy: 3, balanced: 20, best: 1000 },
    differentFrom: ['translatorA'],
  },
  {
    role: 'judge',
    minQuality: 84,
    ceiling: { economy: 3, balanced: 20, best: 1000 },
    differentFrom: [],
  },
  {
    role: 'finalizer',
    minQuality: 84,
    ceiling: { economy: 3, balanced: 20, best: 1000 },
    differentFrom: [],
  },
  {
    role: 'scorer',
    minQuality: 74,
    ceiling: { economy: 1, balanced: 5, best: 20 },
    differentFrom: [],
    cheapest: true,
  },
  {
    role: 'backTranslator',
    minQuality: 74,
    ceiling: { economy: 1, balanced: 5, best: 20 },
    differentFrom: [],
    cheapest: true,
  },
  {
    role: 'helper',
    minQuality: 66,
    ceiling: { economy: 1, balanced: 5, best: 20 },
    differentFrom: [],
    cheapest: true,
  },
]

const byBest = (a: Rated, b: Rated): number => b.quality - a.quality || a.price - b.price
const byCheapest = (a: Rated, b: Rated): number => a.price - b.price || b.quality - a.quality

/**
 * Picks a model per pipeline role from the live catalog: strongest affordable translators from
 * different families, strong reviewer/judge/finalizer, cheap fast helpers. Deterministic; the
 * user can still override any role afterwards.
 */
export function recommendModels(catalog: ModelInfo[], preset: ModelPreset): ModelRecommendation {
  const rated = catalog.map(rate).filter((r): r is Rated => r !== null)
  const chosen: Partial<Record<Role, Rated>> = {}
  const reasons: Partial<Record<Role, string>> = {}
  for (const spec of SPECS) {
    const ceiling = spec.ceiling[preset]
    const avoid = new Set(spec.differentFrom.map((r) => chosen[r]?.family).filter(Boolean))
    const eligible = rated.filter((r) => r.price <= ceiling && r.quality >= spec.minQuality)
    const ranked = [...eligible].sort(spec.cheapest ? byCheapest : byBest)
    const pick =
      ranked.find((r) => !avoid.has(r.family)) ??
      ranked[0] ??
      [...rated].sort(spec.cheapest ? byCheapest : byBest)[0]
    if (!pick) continue
    chosen[spec.role] = pick
    reasons[spec.role] =
      `${pick.model.name} · quality ${pick.quality} · $${pick.price.toFixed(2)}/M out` +
      (avoid.size > 0 && !avoid.has(pick.family) ? ' · different family' : '')
  }
  const fallback = chosen.translatorA ?? [...rated].sort(byBest)[0]
  if (!fallback) throw new Error('No usable model in the catalog')
  const id = (role: Role): string => (chosen[role] ?? fallback).model.id
  return {
    models: {
      translatorA: id('translatorA'),
      translatorB: id('translatorB'),
      translatorC: id('translatorC'),
      reviewer: id('reviewer'),
      judge: id('judge'),
      finalizer: id('finalizer'),
      scorer: id('scorer'),
      backTranslator: id('backTranslator'),
      helper: id('helper'),
    },
    // Every role got a reason above or falls back to translatorA's.
    reasons: Object.fromEntries(
      SPECS.map((s) => s.role).map((r) => [
        r,
        reasons[r] ?? reasons.translatorA ?? fallback.model.name,
      ]),
    ) as Record<Role, string>,
  }
}
