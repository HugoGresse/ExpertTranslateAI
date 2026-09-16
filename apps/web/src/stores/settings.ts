import type { Target } from '@experttranslate/core'
import { persistentAtom, persistentMap } from '@nanostores/persistent'

export type Settings = {
  translatorModel: string
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

export const numberSetting = (raw: string, fallback: number): number => {
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : fallback
}
