import type { GuidelineViolation, Issue, TermViolation } from '../types.ts'
import type { StageContext } from './call.ts'

export const termAsGuideline = (v: TermViolation): GuidelineViolation => ({
  ruleId: `glossary:${v.entryId}`,
  ruleText: `Glossary: "${v.source}" → ${v.expected}`,
  severity: v.severity,
  explanation: v.explanation,
  ...(v.found ? { targetSpan: v.found } : {}),
})

export const violationAsIssue = (v: GuidelineViolation): Issue => ({
  candidate: 'translatorA',
  category: 'guideline',
  severity: v.severity,
  explanation: v.explanation,
  ...(v.targetSpan ? { targetSpan: v.targetSpan } : {}),
})

export const isAbort = (error: unknown): boolean =>
  error instanceof DOMException && error.name === 'AbortError'

export function degrade<T>(
  error: unknown,
  stage: string,
  lang: string,
  ctx: StageContext,
  fallback: T,
): T {
  if (isAbort(error)) throw error
  ctx.logger.warn('stage.degraded', {
    stage,
    lang,
    error: error instanceof Error ? error.message : String(error),
  })
  return fallback
}
