import {
  DEFAULT_JOB_OPTIONS,
  type RoleModels,
  resolveRoleModels,
  type TranslationJob,
} from '@experttranslate/core'
import type { TranslateArgs } from './args.ts'

export const roleModelsFor = (args: TranslateArgs): RoleModels =>
  resolveRoleModels({ translatorA: args.model, ...args.models })

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
      ...DEFAULT_JOB_OPTIONS,
      ...(args.tone ? { tone: args.tone } : {}),
      ...(args.audience ? { audience: args.audience } : {}),
      formality: args.formality,
      maxTokensPerChunk: args.maxTokensPerChunk,
      contextSourceIds: inputs.contextSourceIds,
      guidelineSetIds: inputs.guidelineSetIds,
      budgetUsd: args.budgetUsd,
      reasoningEffort: args.reasoning,
      glossaryScopeIds: args.glossaryScopeIds,
      useMemory: args.useMemory,
      autoEscalate: args.autoEscalate,
      backTranslate: args.backTranslate,
    },
    status: 'queued',
  }
}
