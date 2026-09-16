import type { Candidate, GuidelineViolation, Issue, Judgment, TranslatorRole } from '../types.ts'
import { assembleSystem } from './assembleSystem.ts'
import {
  formatCandidates,
  formatIssues,
  formatViolations,
  materialBlocks,
  type PromptMaterials,
  roleLines,
} from './materials.ts'
import type { Prompt } from './translate.ts'

export interface FinalizePromptInput {
  sourceLang: string
  targetLabel: string
  sourceChunk: string
  candidates: Candidate[]
  base: { role: TranslatorRole | 'merge'; text: string }
  issues: Issue[]
  violations: GuidelineViolation[]
  suggestions: string[]
  judgment: Judgment | null
  preserveFormatting: boolean
  materials: PromptMaterials
}

export function buildFinalizePrompt(input: FinalizePromptInput): Prompt {
  return {
    system: assembleSystem({
      role: roleLines(
        input.materials,
        'finalize',
        [
          `You are the final editor producing the definitive ${input.targetLabel} translation of a ${input.sourceLang} text.`,
          'Start from the BASE text. Apply every fix from the review and the guideline audit that is correct. Use the other candidates only to borrow better wording where the review points to a problem.',
          'Keep meaning complete: nothing omitted, nothing added. Keep terminology consistent with the key terms, context and guidelines.',
          input.preserveFormatting
            ? 'Preserve Markdown structure, line breaks, lists and inline formatting exactly.'
            : '',
          'Never translate or alter tokens of the form ⟦PHn⟧; keep every one of them in place.',
          'Output only the final translated text. No explanations, no quotes, no labels.',
        ].filter((l) => l.length > 0),
      ),
      ...materialBlocks(input.materials),
    }),
    user: [
      `<SOURCE_TEXT>\n${input.sourceChunk}\n</SOURCE_TEXT>`,
      '',
      `<BASE from="${input.base.role}">\n${input.base.text}\n</BASE>`,
      '',
      formatCandidates(input.candidates.filter((c) => c.role !== input.base.role)),
      '',
      '<REVIEW>',
      formatIssues(input.issues),
      input.suggestions.length > 0 ? `Suggestions: ${input.suggestions.join(' ')}` : '',
      '</REVIEW>',
      '<GUIDELINE_AUDIT>',
      formatViolations(input.violations),
      '</GUIDELINE_AUDIT>',
      input.judgment ? `<EDITOR_DECISION>\n${input.judgment.rationale}\n</EDITOR_DECISION>` : '',
      '',
      `Final ${input.targetLabel} translation:`,
    ].join('\n'),
  }
}
