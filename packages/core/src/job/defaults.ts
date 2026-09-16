import type { JobOptions, RoleModels } from '../types.ts'

export const DEFAULT_MODEL = 'anthropic/claude-sonnet-4.5'

/** Everything a job needs except the material ids, which each front end selects itself. */
export const DEFAULT_JOB_OPTIONS: Omit<
  JobOptions,
  'contextSourceIds' | 'guidelineSetIds' | 'glossaryScopeIds'
> = {
  preserveFormatting: true,
  maxTokensPerChunk: 1000,
  contextTokenBudget: 4000,
  guidelinesTokenBudget: 1500,
  budgetUsd: null,
  reasoningEffort: 'low',
  useMemory: false,
  autoEscalate: true,
  escalationConfidence: 60,
  routing: [],
  backTranslate: false,
  promptOverrides: {},
  formality: 'auto',
}

export type RoleModelOverrides = Partial<RoleModels> & { translatorA: string }

/**
 * The one fallback chain for role models, shared by every front end: extra translators fall back
 * to the previous translator, judge and scorer to the reviewer, the finalizer to the main
 * translator, and everything else to the helper (itself defaulting to the main translator).
 * Empty strings count as unset so settings forms can pass their raw values.
 */
export function resolveRoleModels(m: RoleModelOverrides): RoleModels {
  const pick = (...candidates: Array<string | undefined>): string =>
    candidates.find((c) => c !== undefined && c.trim() !== '') ?? m.translatorA
  const a = m.translatorA
  const helper = pick(m.helper)
  const translatorB = pick(m.translatorB)
  const reviewer = pick(m.reviewer, helper)
  return {
    translatorA: a,
    translatorB,
    translatorC: pick(m.translatorC, translatorB),
    reviewer,
    judge: pick(m.judge, m.reviewer, helper),
    finalizer: pick(m.finalizer, a),
    scorer: pick(m.scorer, m.reviewer, helper),
    backTranslator: pick(m.backTranslator, m.translatorB, m.reviewer, helper),
    helper,
  }
}
