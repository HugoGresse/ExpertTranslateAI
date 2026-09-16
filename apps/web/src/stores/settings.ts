import type { Target } from '@experttranslate/core'
import { persistentAtom, persistentMap } from '@nanostores/persistent'

export type Settings = {
  translatorModel: string
  helperModel: string
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
  helperModel: '',
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

const targetCodec = {
  encode: (value: Target[]): string => JSON.stringify(value),
  decode: (raw: string): Target[] => {
    try {
      const parsed: unknown = JSON.parse(raw)
      return Array.isArray(parsed) ? (parsed as Target[]) : []
    } catch {
      return []
    }
  },
}

export const $targets = persistentAtom<Target[]>('eta.targets', [{ lang: 'fr' }], targetCodec)

export const $sourceDraft = persistentAtom<string>('eta.sourceDraft', '')

const idListCodec = {
  encode: (value: string[]): string => JSON.stringify(value),
  decode: (raw: string): string[] => {
    try {
      const parsed: unknown = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
    } catch {
      return []
    }
  },
}

export const $selectedContextIds = persistentAtom<string[]>('eta.selectedContexts', [], idListCodec)
export const $selectedGuidelineIds = persistentAtom<string[]>(
  'eta.selectedGuidelines',
  [],
  idListCodec,
)

export const toggleId = (list: string[], id: string): string[] =>
  list.includes(id) ? list.filter((x) => x !== id) : [...list, id]

export const numberSetting = (raw: string, fallback: number): number => {
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : fallback
}
