import type { Candidate, GuidelineViolation, Issue } from '../types.ts'
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

export interface JudgePromptInput {
  sourceLang: string
  targetLabel: string
  sourceChunk: string
  candidates: Candidate[]
  issues: Issue[]
  violations: GuidelineViolation[]
  materials: PromptMaterials
}

export function buildJudgePrompt(input: JudgePromptInput): Prompt {
  return {
    system: assembleSystem({
      role: roleLines(input.materials, 'judge', [
        `You are the senior editor deciding between ${input.sourceLang} to ${input.targetLabel} candidate translations.`,
        'You receive the source, the candidates and the findings of a reviewer and a guideline audit.',
        'Decide which candidate is the best base. If no single candidate is clearly best, answer "merge" and provide the merged text that takes the best sentence from each candidate while fixing the reported issues.',
        'Answer with a single JSON object, nothing else:',
        '{"winner": "translatorA"|"translatorB"|"translatorC"|"merge", "rationale": two or three sentences, "mergedText"?: full text, required when winner is "merge"}',
        'Never translate or alter tokens of the form ⟦PHn⟧.',
      ]),
      ...materialBlocks(input.materials),
    }),
    user: [
      `<SOURCE_TEXT>\n${input.sourceChunk}\n</SOURCE_TEXT>`,
      '',
      formatCandidates(input.candidates),
      '',
      '<REVIEW>',
      formatIssues(input.issues),
      '</REVIEW>',
      '<GUIDELINE_AUDIT>',
      formatViolations(input.violations),
      '</GUIDELINE_AUDIT>',
    ].join('\n'),
  }
}
