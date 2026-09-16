import type { RoleModels, TranslationJob } from '@experttranslate/core'
import type { TranslateArgs } from './args.ts'

export function roleModelsFor(args: TranslateArgs): RoleModels {
  const a = args.model
  const helper = args.models.helper ?? a
  return {
    translatorA: a,
    translatorB: args.models.translatorB ?? a,
    translatorC: args.models.translatorC ?? a,
    reviewer: args.models.reviewer ?? helper,
    judge: args.models.judge ?? helper,
    finalizer: args.models.finalizer ?? helper,
    scorer: args.models.scorer ?? helper,
    backTranslator: args.models.backTranslator ?? helper,
    helper,
  }
}

export interface JobInputs {
  id: string
  now: number
  sourceText: string
  contextSourceIds: string[]
  guidelineSetIds: string[]
}

export function buildJob(args: TranslateArgs, inputs: JobInputs): TranslationJob {
  return {
    id: inputs.id,
    createdAt: inputs.now,
    sourceText: inputs.sourceText,
    sourceLang: args.sourceLang,
    targets: args.targets,
    domain: args.domain,
    difficulty: args.difficulty,
    models: roleModelsFor(args),
    options: {
      ...(args.tone ? { tone: args.tone } : {}),
      ...(args.audience ? { audience: args.audience } : {}),
      formality: args.formality,
      preserveFormatting: true,
      maxTokensPerChunk: args.maxTokensPerChunk,
      contextSourceIds: inputs.contextSourceIds,
      guidelineSetIds: inputs.guidelineSetIds,
      contextTokenBudget: 4000,
      guidelinesTokenBudget: 1500,
      budgetUsd: args.budgetUsd,
      reasoningEffort: args.reasoning,
      glossaryScopeIds: args.glossaryScopeIds,
      useMemory: args.useMemory,
      autoEscalate: args.autoEscalate,
      escalationConfidence: 60,
      routing: [],
      backTranslate: args.backTranslate,
      promptOverrides: {},
    },
    status: 'queued',
  }
}
