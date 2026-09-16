import type {
  Brief,
  Candidate,
  GuidelineViolation,
  Issue,
  PromptOverrides,
  PromptStage,
  TranslatorRole,
} from '../types.ts'
import { DEFAULT_ROLE_LINES } from './roles.ts'

export interface PromptMaterials {
  contextBlock?: string
  guidelinesBlock?: string
  glossaryBlock?: string
  memoryBlock?: string
  brief?: Brief | null
  overrides?: PromptOverrides
}

export function roleLines(m: PromptMaterials | undefined, stage: PromptStage): string[] {
  const override = m?.overrides?.[stage]?.trim()
  return override ? override.split('\n') : DEFAULT_ROLE_LINES[stage]
}

export function formatBriefBlock(brief: Brief | null | undefined): string {
  if (!brief) return ''
  const lines = [
    `Domain: ${brief.domain}. Difficulty: ${brief.difficulty}.`,
    brief.summary ? `Summary: ${brief.summary}` : '',
    brief.tone ? `Tone: ${brief.tone}` : '',
    brief.audience ? `Audience: ${brief.audience}` : '',
    brief.keyTerms.length > 0
      ? `Key terms: ${brief.keyTerms.map((t) => (t.note ? `${t.term} (${t.note})` : t.term)).join('; ')}`
      : '',
    brief.risks.length > 0 ? `Watch out for: ${brief.risks.join('; ')}` : '',
  ]
  return lines.filter((l) => l.length > 0).join('\n')
}

export function materialBlocks(m: PromptMaterials): {
  brief?: string
  context?: string
  guidelines?: string
  glossary?: string
  memory?: string
} {
  const brief = formatBriefBlock(m.brief)
  return {
    ...(brief ? { brief } : {}),
    ...(m.contextBlock ? { context: m.contextBlock } : {}),
    ...(m.guidelinesBlock ? { guidelines: m.guidelinesBlock } : {}),
    ...(m.glossaryBlock ? { glossary: m.glossaryBlock } : {}),
    ...(m.memoryBlock ? { memory: m.memoryBlock } : {}),
  }
}

export const roleLabel = (role: TranslatorRole): string => role.replace('translator', 'Candidate ')

export function formatCandidates(candidates: Candidate[]): string {
  return candidates
    .map((c) => `<CANDIDATE id="${c.role}" label="${roleLabel(c.role)}">\n${c.text}\n</CANDIDATE>`)
    .join('\n\n')
}

export function formatIssues(issues: Issue[]): string {
  if (issues.length === 0) return 'No issues reported.'
  return issues
    .map((i) => {
      const where = i.targetSpan ? ` at "${i.targetSpan}"` : ''
      const fix = i.fix ? ` Suggested fix: ${i.fix}` : ''
      return `- [${i.candidate}] ${i.severity} ${i.category}${where}: ${i.explanation}${fix}`
    })
    .join('\n')
}

export function formatViolations(violations: GuidelineViolation[]): string {
  if (violations.length === 0) return 'No guideline violations reported.'
  return violations
    .map(
      (v) =>
        `- ${v.severity}: ${v.ruleText}${v.targetSpan ? ` at "${v.targetSpan}"` : ''} — ${v.explanation}`,
    )
    .join('\n')
}
