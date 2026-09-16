import type { GuidelineRule, GuidelineSet, GuidelineViolation } from '../types.ts'

export function compileRulePattern(rule: GuidelineRule): RegExp | null {
  if (!rule.pattern) return null
  try {
    return new RegExp(rule.pattern, 'iu')
  } catch {
    return null
  }
}

export function checkRule(
  text: string,
  rule: GuidelineRule,
  source?: string,
): GuidelineViolation | null {
  const re = compileRulePattern(rule)
  if (!re || rule.kind === 'prefer') return null
  if (rule.kind === 'keep') return checkKeep(text, rule, re, source)
  const match = re.exec(text)
  if (rule.kind === 'must-not' && match) {
    return {
      ruleId: rule.id,
      ruleText: rule.text,
      severity: 'major',
      targetSpan: match[0],
      explanation: `Forbidden pattern found: "${match[0]}"`,
    }
  }
  if (rule.kind === 'must' && !match) {
    return {
      ruleId: rule.id,
      ruleText: rule.text,
      severity: 'major',
      explanation: 'Required pattern not found',
    }
  }
  return null
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const exactTermRe = (term: string): RegExp =>
  new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(term)}(?![\\p{L}\\p{N}])`, 'u')

function checkKeep(
  text: string,
  rule: GuidelineRule,
  re: RegExp,
  source?: string,
): GuidelineViolation | null {
  if (source === undefined) return null
  const global = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`)
  const wanted = [...source.matchAll(global)].map((m) => m[0])
  if (wanted.length === 0) return null
  const first = wanted.find((term) => !exactTermRe(term).test(text))
  if (first === undefined) return null
  return {
    ruleId: rule.id,
    ruleText: rule.text,
    severity: 'major',
    targetSpan: first,
    explanation: `"${first}" appears in the source but not unchanged in the translation`,
  }
}

export function checkGuidelines(
  text: string,
  sets: GuidelineSet[],
  source?: string,
): GuidelineViolation[] {
  const out: GuidelineViolation[] = []
  for (const set of sets) {
    for (const rule of set.rules) {
      const v = checkRule(text, rule, source)
      if (v) out.push(v)
    }
  }
  return out
}

export function isCheckable(rule: GuidelineRule): boolean {
  return rule.kind !== 'prefer' && compileRulePattern(rule) !== null
}
