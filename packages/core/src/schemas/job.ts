import { z } from 'zod'

const roleModelsSchema = z.object({
  translatorA: z.string().min(1),
  translatorB: z.string().min(1),
  translatorC: z.string().min(1),
  reviewer: z.string().min(1),
  judge: z.string().min(1),
  finalizer: z.string().min(1),
  scorer: z.string().min(1),
  backTranslator: z.string().min(1),
  helper: z.string().min(1),
})

const routerRuleSchema = z.object({
  id: z.string().optional(),
  domain: z.string(),
  role: z.string(),
  model: z.string(),
})

/** Shape of a job as accepted over the wire; numeric bounds keep a hostile client from degenerate settings. */
export const translationJobSchema = z.object({
  id: z.string().min(1).max(200),
  createdAt: z.number(),
  sourceText: z.string().min(1),
  sourceLang: z.string().min(1).max(32),
  targets: z
    .array(z.object({ lang: z.string().min(1).max(32), region: z.string().max(64).optional() }))
    .min(1)
    .max(50),
  domain: z.enum([
    'auto',
    'general',
    'legal',
    'technical',
    'marketing',
    'medical',
    'literary',
    'ui',
  ]),
  difficulty: z.enum(['auto', 'simple', 'normal', 'hard', 'critical']),
  models: roleModelsSchema,
  options: z.object({
    tone: z.string().max(500).optional(),
    audience: z.string().max(500).optional(),
    formality: z.enum(['formal', 'informal', 'auto']).optional(),
    preserveFormatting: z.boolean(),
    maxTokensPerChunk: z.number().int().min(50).max(20_000),
    contextSourceIds: z.array(z.string()).max(200),
    guidelineSetIds: z.array(z.string()).max(200),
    contextTokenBudget: z.number().int().min(0).max(200_000),
    guidelinesTokenBudget: z.number().int().min(0).max(50_000),
    budgetUsd: z.number().positive().nullable(),
    reasoningEffort: z.enum(['none', 'minimal', 'low', 'medium', 'high']),
    glossaryScopeIds: z.array(z.string()).max(200),
    useMemory: z.boolean(),
    autoEscalate: z.boolean(),
    escalationConfidence: z.number().min(0).max(100),
    routing: z.array(routerRuleSchema).max(100),
    backTranslate: z.boolean(),
    promptOverrides: z.record(z.string(), z.string().max(20_000)),
  }),
  status: z.enum(['queued', 'running', 'done', 'failed', 'cancelled']),
})

const row = z.object({ id: z.string().min(1) }).passthrough()

export const remoteMaterialsSchema = z.object({
  contexts: z.array(row).max(200),
  guidelines: z.array(row).max(200),
  glossaryScopes: z.array(row).max(1000),
  glossaryEntries: z.array(row).max(50_000),
  tm: z.array(row).max(50_000),
})

export const remoteJobRequestSchema = z.object({
  job: translationJobSchema,
  materials: remoteMaterialsSchema,
})
