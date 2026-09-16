import { formatDisagreements } from '../scoring/disagreement.ts'
import type { Candidate, Disagreement } from '../types.ts'
import { assembleSystem } from './assembleSystem.ts'
import { formatCandidates, materialBlocks, type PromptMaterials, roleLines } from './materials.ts'
import type { Prompt } from './translate.ts'

export interface ReviewPromptInput {
  sourceLang: string
  targetLabel: string
  sourceChunk: string
  candidates: Candidate[]
  materials: PromptMaterials
  disagreements?: Disagreement[]
}

export function buildReviewPrompt(input: ReviewPromptInput): Prompt {
  return {
    system: assembleSystem({
      role: roleLines(input.materials, 'review'),
      contract: [
        `Language pair: ${input.sourceLang} → ${input.targetLabel}.`,
        'Answer with a single JSON object, nothing else:',
        '{"issues": [{"candidate": "translatorA"|"translatorB"|"translatorC", "category": one of accuracy|omission|addition|terminology|grammar|fluency|style|consistency|formatting|guideline, "severity": "minor"|"major"|"critical", "sourceSpan"?: string, "targetSpan"?: exact text in the candidate, "explanation": string, "fix"?: corrected wording}],',
        ' "suggestions": [general improvements that apply to the final version], "preferred": the candidate id that is the best starting point, or null}',
      ],
      ...materialBlocks(input.materials),
    }),
    user: [
      `<SOURCE_TEXT>\n${input.sourceChunk}\n</SOURCE_TEXT>`,
      '',
      formatCandidates(input.candidates),
      ...(input.disagreements && input.disagreements.length > 0
        ? [
            '',
            '<DISAGREEMENTS>',
            'The candidates differ on these spans. Examine them first and say which rendering is right:',
            formatDisagreements(input.disagreements),
            '</DISAGREEMENTS>',
          ]
        : []),
    ].join('\n'),
  }
}
