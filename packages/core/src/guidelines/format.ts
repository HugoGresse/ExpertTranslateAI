import { countTokens } from '../text/tokens.ts'
import type { GuidelineRule, GuidelineSet } from '../types.ts'

export interface NumberedRule {
  number: number
  rule: GuidelineRule
  setName: string
}

const KIND_LABEL: Record<GuidelineRule['kind'], string> = {
  must: 'MUST',
  'must-not': 'MUST NOT',
  prefer: 'PREFER',
  keep: 'KEEP UNCHANGED',
}

export function activeGuidelineSets(sets: GuidelineSet[], lang: string): GuidelineSet[] {
  return sets.filter((s) => s.enabled && (!s.lang || s.lang === lang))
}

export function numberRules(sets: GuidelineSet[]): NumberedRule[] {
  const out: NumberedRule[] = []
  for (const set of sets) {
    for (const rule of set.rules) out.push({ number: out.length + 1, rule, setName: set.name })
  }
  return out
}

const AGREEING_PREFIX: Record<GuidelineRule['kind'], RegExp | null> = {
  must: /^(always|must)\s+/i,
  'must-not': /^(never|must not|do not|don't|avoid)\s+/i,
  prefer: /^(prefer to|prefer)\s+/i,
  keep: /^(keep|always keep)\s+/i,
}

export function formatRule(n: NumberedRule): string {
  const prefix = AGREEING_PREFIX[n.rule.kind]
  const text = prefix ? n.rule.text.replace(prefix, '') : n.rule.text
  const parts = [`${n.number}. ${KIND_LABEL[n.rule.kind]} ${text}`]
  if (n.rule.examples?.good) parts.push(`   Good: ${n.rule.examples.good}`)
  if (n.rule.examples?.bad) parts.push(`   Bad: ${n.rule.examples.bad}`)
  return parts.join('\n')
}

const freeTextsOf = (sets: GuidelineSet[]): string[] =>
  sets.filter((s) => s.freeText?.trim()).map((s) => `### ${s.name}\n${s.freeText?.trim()}`)

const wrap = (rules: string[], freeTexts: string[]): string => {
  if (rules.length === 0 && freeTexts.length === 0) return ''
  const lines = ['<GUIDELINES>', ...rules]
  if (freeTexts.length > 0) lines.push('', ...freeTexts)
  lines.push('</GUIDELINES>')
  return lines.join('\n')
}

export function formatGuidelinesBlock(sets: GuidelineSet[]): string {
  return wrap(numberRules(sets).map(formatRule), freeTextsOf(sets))
}

export interface FittedGuidelines {
  text: string
  /** Rules that made it into the prompt; the checker should audit only these. */
  rules: NumberedRule[]
  truncated: boolean
}

/**
 * Formats the guidelines block within a token budget by dropping whole rules from the end
 * (and then free text) rather than cutting a rule mid-sentence, which could invert its meaning.
 */
export function fitGuidelinesBlock(sets: GuidelineSet[], budget: number): FittedGuidelines {
  const numbered = numberRules(sets)
  const freeTexts = freeTextsOf(sets)
  const full = wrap(numbered.map(formatRule), freeTexts)
  if (countTokens(full) <= budget) return { text: full, rules: numbered, truncated: false }
  const fits = (rules: NumberedRule[], free: string[]): boolean =>
    countTokens(wrap(rules.map(formatRule), free)) <= budget
  let keptFree = freeTexts
  while (keptFree.length > 0 && !fits(numbered, keptFree)) keptFree = keptFree.slice(0, -1)
  let kept = numbered
  while (kept.length > 0 && !fits(kept, keptFree)) kept = kept.slice(0, -1)
  return { text: wrap(kept.map(formatRule), keptFree), rules: kept, truncated: true }
}
