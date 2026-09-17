import { findPricing, usageCost } from '../llm/pricing.ts'
import { chunkText } from '../text/chunk.ts'
import { countTokens } from '../text/tokens.ts'
import type { ContextSource, Difficulty, JobEstimate, ModelInfo, TranslationJob } from '../types.ts'
import { planFor, stageCallsPerChunk } from './plan.ts'

export const needsBrief = (job: TranslationJob): boolean => job.difficulty !== 'simple'

export const isRelevantSource = (source: ContextSource, job: TranslationJob): boolean =>
  source.enabled && (!source.lang || job.targets.some((t) => t.lang === source.lang))

/** Pure cost/size estimate; no ports involved, so any front end can call it before submitting. */
export function estimateJob(
  job: TranslationJob,
  models: ModelInfo[],
  sources: ContextSource[] = [],
): JobEstimate {
  const sourceTokens = countTokens(job.sourceText)
  const chunkCount = chunkText(job.sourceText, job.options.maxTokensPerChunk).length
  const difficulty: Difficulty = job.difficulty === 'auto' ? 'normal' : job.difficulty
  const plan = planFor(difficulty)
  const perChunk = stageCallsPerChunk(plan)
  const callCount =
    chunkCount * perChunk * job.targets.length +
    (needsBrief(job) ? 1 : 0) +
    (plan.score ? job.targets.length : 0) +
    (plan.backTranslate || job.options.backTranslate ? 2 * job.targets.length : 0) +
    (job.options.suggestGlossary && plan.finalize ? job.targets.length : 0)
  const contextTokens = sources
    .filter((s) => isRelevantSource(s, job) && job.options.contextSourceIds.includes(s.id))
    .reduce((acc, s) => acc + Math.min(countTokens(s.rawText), job.options.contextTokenBudget), 0)
  const pricing = findPricing(models, job.models.translatorA)
  const promptPerCall = sourceTokens + contextTokens + 400
  const outputPerCall = sourceTokens * 1.2
  const estimatedUsd = pricing
    ? usageCost(
        { promptTokens: promptPerCall * callCount, completionTokens: outputPerCall * callCount },
        pricing,
      )
    : null
  return { sourceTokens, contextTokens, chunkCount, callCount, estimatedUsd, difficulty }
}
