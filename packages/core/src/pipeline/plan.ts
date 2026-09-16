import type { Difficulty, TranslatorRole } from '../types.ts'

export interface Plan {
  difficulty: Difficulty
  translators: TranslatorRole[]
  review: boolean
  guidelineCheck: boolean
  judge: boolean
  finalize: boolean
  score: boolean
  backTranslate: boolean
}

export const PLANS: Record<Difficulty, Plan> = {
  simple: {
    difficulty: 'simple',
    translators: ['translatorA'],
    review: false,
    guidelineCheck: false,
    judge: false,
    finalize: false,
    score: false,
    backTranslate: false,
  },
  normal: {
    difficulty: 'normal',
    translators: ['translatorA', 'translatorB'],
    review: true,
    guidelineCheck: true,
    judge: false,
    finalize: true,
    score: true,
    backTranslate: false,
  },
  hard: {
    difficulty: 'hard',
    translators: ['translatorA', 'translatorB', 'translatorC'],
    review: true,
    guidelineCheck: true,
    judge: true,
    finalize: true,
    score: true,
    backTranslate: false,
  },
  critical: {
    difficulty: 'critical',
    translators: ['translatorA', 'translatorB', 'translatorC'],
    review: true,
    guidelineCheck: true,
    judge: true,
    finalize: true,
    score: true,
    backTranslate: true,
  },
}

export const planFor = (difficulty: Difficulty): Plan => PLANS[difficulty]

export function stageCallsPerChunk(plan: Plan): number {
  return (
    plan.translators.length +
    (plan.review ? 1 : 0) +
    (plan.guidelineCheck ? 1 : 0) +
    (plan.judge ? 1 : 0) +
    (plan.finalize ? 1 : 0)
  )
}
