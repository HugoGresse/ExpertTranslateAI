import { z } from 'zod'

const roleSchema = z.enum(['translatorA', 'translatorB', 'translatorC'])

export const briefSchema = z.object({
  detectedLang: z.string().min(2).max(12),
  domain: z
    .enum(['general', 'legal', 'technical', 'marketing', 'medical', 'literary', 'ui'])
    .catch('general'),
  difficulty: z.enum(['simple', 'normal', 'hard', 'critical']).catch('normal'),
  summary: z.string().default(''),
  tone: z.string().default(''),
  audience: z.string().default(''),
  keyTerms: z.array(z.object({ term: z.string(), note: z.string().default('') })).default([]),
  risks: z.array(z.string()).default([]),
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
  sourceSpan: z.string().optional(),
  targetSpan: z.string().optional(),
  explanation: z.string(),
  fix: z.string().optional(),
})

export const reviewSchema = z.object({
  issues: z.array(issueSchema).default([]),
  suggestions: z.array(z.string()).default([]),
  preferred: roleSchema.nullable().default(null),
})

export const guidelineCheckSchema = z.object({
  violations: z
    .array(
      z.object({
        ruleNumber: z.number().int().positive(),
        candidate: roleSchema,
        severity: z.enum(['minor', 'major']).catch('major'),
        targetSpan: z.string().optional(),
        explanation: z.string(),
        fix: z.string().optional(),
      }),
    )
    .default([]),
})

export const judgmentSchema = z.object({
  winner: z.enum(['translatorA', 'translatorB', 'translatorC', 'merge']),
  rationale: z.string().default(''),
  mergedText: z.string().optional(),
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
  notes: z.array(z.string()).default([]),
})

export type BriefOutput = z.infer<typeof briefSchema>
export type ReviewOutput = z.infer<typeof reviewSchema>
export type GuidelineCheckOutput = z.infer<typeof guidelineCheckSchema>
export type JudgmentOutput = z.infer<typeof judgmentSchema>
export type ScoreOutput = z.infer<typeof scoreSchema>
