import { splitSentences } from '../text/sentences.ts'
import type { TmEntry } from '../types.ts'

export interface LearnInput {
  sourceText: string
  originalText: string
  editedText: string
  sourceLang: string
  targetLang: string
  makeId: () => string
  now: number
}

export function learnCorrections(input: LearnInput): TmEntry[] {
  if (!input.sourceLang || input.sourceLang === 'auto' || !input.targetLang) return []
  const source = splitSentences(input.sourceText)
  const original = splitSentences(input.originalText)
  const edited = splitSentences(input.editedText)
  const base = {
    sourceLang: input.sourceLang,
    targetLang: input.targetLang,
    origin: 'human-correction' as const,
    createdAt: input.now,
  }
  if (source.length === edited.length && source.length === original.length) {
    const out: TmEntry[] = []
    for (let i = 0; i < source.length; i++) {
      const s = source[i]
      const e = edited[i]
      if (s !== undefined && e !== undefined && e !== original[i]) {
        out.push({ ...base, id: input.makeId(), source: s, target: e })
      }
    }
    return out
  }
  if (input.editedText.trim() === input.originalText.trim()) return []
  return [
    {
      ...base,
      id: input.makeId(),
      source: input.sourceText.trim(),
      target: input.editedText.trim(),
    },
  ]
}
