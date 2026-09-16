import { extractJson } from '../llm/collect.ts'
import { createBudgetTracker } from '../pipeline/budget.ts'
import { callRole } from '../pipeline/call.ts'
import type { LlmPort, LoggerPort } from '../ports.ts'
import { noopLogger, systemClock } from '../ports.ts'
import { buildExtractRulesPrompt } from '../prompts/guidelines.ts'
import type { GuidelineKind, GuidelineRule, ReasoningEffort, Usage } from '../types.ts'

interface RawRule {
  text?: unknown
  kind?: unknown
  pattern?: unknown
  examples?: { good?: unknown; bad?: unknown }
}

const KINDS = new Set<GuidelineKind>(['must', 'must-not', 'prefer', 'keep'])

export function normalizeRules(raw: unknown, makeId: () => string): GuidelineRule[] {
  if (!Array.isArray(raw)) return []
  const out: GuidelineRule[] = []
  for (const item of raw as RawRule[]) {
    if (typeof item?.text !== 'string' || item.text.trim().length === 0) continue
    const kind =
      typeof item.kind === 'string' && KINDS.has(item.kind as GuidelineKind)
        ? (item.kind as GuidelineKind)
        : 'prefer'
    const rule: GuidelineRule = { id: makeId(), text: item.text.trim(), kind }
    if (typeof item.pattern === 'string' && item.pattern.trim()) rule.pattern = item.pattern.trim()
    const good = typeof item.examples?.good === 'string' ? item.examples.good : undefined
    const bad = typeof item.examples?.bad === 'string' ? item.examples.bad : undefined
    if (good || bad) rule.examples = { ...(good ? { good } : {}), ...(bad ? { bad } : {}) }
    out.push(rule)
  }
  return out
}

export async function extractRules(
  llm: LlmPort,
  model: string,
  freeText: string,
  makeId: () => string,
  opts: { signal?: AbortSignal; reasoningEffort?: ReasoningEffort; logger?: LoggerPort } = {},
): Promise<{ rules: GuidelineRule[]; usage: Usage }> {
  const prompt = buildExtractRulesPrompt(freeText)
  const { text, usage } = await callRole(
    {
      lang: '*',
      stage: 'guidelines',
      role: 'helper',
      model,
      chunkIndex: null,
      prompt,
      temperature: 0,
    },
    {
      llm,
      clock: systemClock,
      logger: opts.logger ?? noopLogger,
      events: { emit: () => undefined },
      budget: createBudgetTracker(null),
      trace: [],
      ...(opts.reasoningEffort ? { reasoningEffort: opts.reasoningEffort } : {}),
      ...(opts.signal ? { signal: opts.signal } : {}),
    },
  )
  return { rules: normalizeRules(extractJson(text), makeId), usage }
}
