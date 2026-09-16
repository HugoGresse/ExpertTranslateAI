import type { GuidelineRule, GuidelineSet, GuidelineViolation } from '../types.ts'

export function compileRulePattern(rule: GuidelineRule): RegExp | null {
  if (!rule.pattern) return null
  try {
    return new RegExp(rule.pattern, 'iu')
  } catch {
    return null
  }
}

export function checkRule(text: string, rule: GuidelineRule): GuidelineViolation | null {
  const re = compileRulePattern(rule)
  if (!re || rule.kind === 'prefer') return null
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

export function checkGuidelines(text: string, sets: GuidelineSet[]): GuidelineViolation[] {
  const out: GuidelineViolation[] = []
  for (const set of sets) {
    for (const rule of set.rules) {
      const v = checkRule(text, rule)
      if (v) out.push(v)
    }
  }
  return out
}

export function isCheckable(rule: GuidelineRule): boolean {
  return rule.kind !== 'prefer' && compileRulePattern(rule) !== null
}
