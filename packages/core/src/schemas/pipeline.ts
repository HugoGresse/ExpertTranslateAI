import { z } from 'zod'

const roleSchema = z.enum(['translatorA', 'translatorB', 'translatorC'])

const optionalText = z
  .string()
  .nullish()
  .transform((v) => (v == null ? undefined : v))
const textOr = (fallback: string) =>
  z
    .string()
    .nullish()
    .transform((v) => v ?? fallback)
const listOr = <T extends z.ZodType>(item: T) =>
  z
    .array(item)
    .nullish()
    .transform((v) => v ?? [])

export const briefSchema = z.object({
  detectedLang: z.string().min(2).max(12),
  domain: z
    .enum(['general', 'legal', 'technical', 'marketing', 'medical', 'literary', 'ui'])
    .catch('general'),
  difficulty: z.enum(['simple', 'normal', 'hard', 'critical']).catch('normal'),
  summary: textOr(''),
  tone: textOr(''),
  audience: textOr(''),
  keyTerms: listOr(z.object({ term: z.string(), note: textOr('') })),
  risks: listOr(z.string()),
})

export const issueSchema = z.object({
  candidate: roleSchema,
  category: z
    .enum([
      'accuracy',
      'omission',
      'addition',
      'terminology',
      'grammar',
      'fluency',
      'style',
      'consistency',
      'formatting',
      'guideline',
    ])
    .catch('accuracy'),
  severity: z.enum(['minor', 'major', 'critical']).catch('minor'),
  sourceSpan: optionalText,
  targetSpan: optionalText,
  explanation: z.string(),
  fix: optionalText,
})

export const reviewSchema = z.object({
  issues: listOr(issueSchema),
  suggestions: listOr(z.string()),
  preferred: roleSchema.nullable().default(null),
})

export const guidelineCheckSchema = z.object({
  violations: z
    .array(
      z.object({
        ruleNumber: z.number().int().positive(),
        candidate: roleSchema,
        severity: z.enum(['minor', 'major']).catch('major'),
        targetSpan: optionalText,
        explanation: z.string(),
        fix: optionalText,
      }),
    )
    .nullish()
    .transform((v) => v ?? []),
})

export const judgmentSchema = z.object({
  winner: z.enum(['translatorA', 'translatorB', 'translatorC', 'merge']),
  rationale: textOr(''),
  mergedText: optionalText,
})

const pct = z.number().min(0).max(100)

export const scoreSchema = z.object({
  fidelity: pct,
  terminology: pct,
  grammar: pct,
  naturalness: pct,
  register: pct,
  consistency: pct,
  confidence: pct,
  notes: listOr(z.string()),
})

export const deltaSchema = z.object({
  deltas: listOr(
    z.object({
      source: textOr(''),
      back: textOr(''),
      kind: z.enum(['loss', 'addition', 'shift']).catch('shift'),
      severity: z.enum(['minor', 'major']).catch('minor'),
      note: textOr(''),
    }),
  ),
})

export type DeltaOutput = z.infer<typeof deltaSchema>
export type BriefOutput = z.infer<typeof briefSchema>
export type ReviewOutput = z.infer<typeof reviewSchema>
export type GuidelineCheckOutput = z.infer<typeof guidelineCheckSchema>
export type JudgmentOutput = z.infer<typeof judgmentSchema>
export type ScoreOutput = z.infer<typeof scoreSchema>
