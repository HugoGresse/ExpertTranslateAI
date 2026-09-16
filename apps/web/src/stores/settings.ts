import type { Domain, ReasoningEffort, RoleModels, RouterRule, Target } from '@experttranslate/core'
import { persistentAtom, persistentMap } from '@nanostores/persistent'

export type Settings = {
  translatorModel: string
  translatorBModel: string
  translatorCModel: string
  reviewerModel: string
  judgeModel: string
  finalizerModel: string
  scorerModel: string
  helperModel: string
  difficulty: 'auto' | 'simple' | 'normal' | 'hard'
  domain: Domain | 'auto'
  budgetUsd: string
  reasoningEffort: ReasoningEffort
  autoEscalate: 'true' | 'false'
  escalationConfidence: string
  contextTokenBudget: string
  guidelinesTokenBudget: string
  sourceLang: string
  maxTokensPerChunk: string
  concurrency: string
  tone: string
  audience: string
  formality: 'auto' | 'formal' | 'informal'
  preserveFormatting: 'true' | 'false'
}

export const DEFAULT_MODEL = 'anthropic/claude-sonnet-4.5'

export const $settings = persistentMap<Settings>('eta.settings.', {
  translatorModel: DEFAULT_MODEL,
  translatorBModel: '',
  translatorCModel: '',
  reviewerModel: '',
  judgeModel: '',
  finalizerModel: '',
  scorerModel: '',
  helperModel: '',
  difficulty: 'auto',
  domain: 'auto',
  budgetUsd: '',
  reasoningEffort: 'low',
  autoEscalate: 'true',
  escalationConfidence: '60',
  contextTokenBudget: '4000',
  guidelinesTokenBudget: '1500',
  sourceLang: 'auto',
  maxTokensPerChunk: '1000',
  concurrency: '4',
  tone: '',
  audience: '',
  formality: 'auto',
  preserveFormatting: 'true',
})

const jsonListCodec = <T>(isItem: (x: unknown) => x is T) => ({
  encode: (value: T[]): string => JSON.stringify(value),
  decode: (raw: string): T[] => {
    try {
      const parsed: unknown = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed.filter(isItem) : []
    } catch {
      return []
    }
  },
})

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null
const isTarget = (x: unknown): x is Target => isRecord(x) && typeof x.lang === 'string'
const isString = (x: unknown): x is string => typeof x === 'string'
const isRouterRule = (x: unknown): x is RouterRule =>
  isRecord(x) &&
  typeof x.domain === 'string' &&
  typeof x.role === 'string' &&
  typeof x.model === 'string'

const targetCodec = jsonListCodec(isTarget)

export const $targets = persistentAtom<Target[]>('eta.targets', [{ lang: 'fr' }], targetCodec)

export const $sourceDraft = persistentAtom<string>('eta.sourceDraft', '')

const idListCodec = jsonListCodec(isString)

export const $selectedContextIds = persistentAtom<string[]>('eta.selectedContexts', [], idListCodec)
export const $selectedGuidelineIds = persistentAtom<string[]>(
  'eta.selectedGuidelines',
  [],
  idListCodec,
)
export const $selectedGlossaryIds = persistentAtom<string[]>(
  'eta.selectedGlossaries',
  [],
  idListCodec,
)
export const $useMemory = persistentAtom<string>('eta.useMemory', 'true')

export function roleModels(s: Settings): RoleModels {
  const a = s.translatorModel
  const helper = s.helperModel || a
  return {
    translatorA: a,
    translatorB: s.translatorBModel || a,
    translatorC: s.translatorCModel || s.translatorBModel || a,
    reviewer: s.reviewerModel || helper,
    judge: s.judgeModel || s.reviewerModel || helper,
    finalizer: s.finalizerModel || a,
    scorer: s.scorerModel || s.reviewerModel || helper,
    helper,
  }
}

export const toggleId = (list: string[], id: string): string[] =>
  list.includes(id) ? list.filter((x) => x !== id) : [...list, id]

export const numberSetting = (raw: string, fallback: number, min = Number.MIN_VALUE): number => {
  const n = Number(raw)
  return Number.isFinite(n) && n >= min ? n : fallback
}

const routingCodec = {
  encode: jsonListCodec(isRouterRule).encode,
  decode: (raw: string): RouterRule[] =>
    jsonListCodec(isRouterRule)
      .decode(raw)
      .map((r) => (r.id ? r : { ...r, id: crypto.randomUUID() })),
}

export const $routing = persistentAtom<RouterRule[]>('eta.routing', [], routingCodec)
