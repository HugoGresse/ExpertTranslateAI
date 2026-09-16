import type { Difficulty, TranslatorRole } from '../types.ts'

export interface Plan {
  translators: TranslatorRole[]
  review: number
  terminologyCheck: 'rules' | 'llm'
  judge: boolean
  score: boolean
  backTranslate: boolean
}

export const PLANS: Record<Difficulty, Plan> = {
  simple: {
    translators: ['translatorA'],
    review: 0,
    terminologyCheck: 'rules',
    judge: false,
    score: false,
    backTranslate: false,
  },
  normal: {
    translators: ['translatorA', 'translatorB'],
    review: 1,
    terminologyCheck: 'llm',
    judge: false,
    score: true,
    backTranslate: false,
  },
  hard: {
    translators: ['translatorA', 'translatorB', 'translatorC'],
    review: 1,
    terminologyCheck: 'llm',
    judge: true,
    score: true,
    backTranslate: false,
  },
  critical: {
    translators: ['translatorA', 'translatorB', 'translatorC'],
    review: 2,
    terminologyCheck: 'llm',
    judge: true,
    score: true,
    backTranslate: true,
  },
}

export const planFor = (difficulty: Difficulty): Plan => PLANS[difficulty]
