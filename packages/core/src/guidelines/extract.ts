import { collectText, extractJson } from '../llm/collect.ts'
import type { LlmPort } from '../ports.ts'
import { buildExtractRulesPrompt } from '../prompts/guidelines.ts'
import type { GuidelineKind, GuidelineRule, Usage } from '../types.ts'

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
  signal?: AbortSignal,
): Promise<{ rules: GuidelineRule[]; usage: Usage }> {
  const prompt = buildExtractRulesPrompt(freeText)
  const { text, usage } = await collectText(
    llm,
    {
      model,
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ],
      temperature: 0,
    },
    signal,
  )
  return { rules: normalizeRules(extractJson(text), makeId), usage }
}
