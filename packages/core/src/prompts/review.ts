import type { Candidate } from '../types.ts'
import { assembleSystem } from './assembleSystem.ts'
import { formatCandidates, materialBlocks, type PromptMaterials } from './materials.ts'
import type { Prompt } from './translate.ts'

export interface ReviewPromptInput {
  sourceLang: string
  targetLabel: string
  sourceChunk: string
  candidates: Candidate[]
  materials: PromptMaterials
}

export function buildReviewPrompt(input: ReviewPromptInput): Prompt {
  return {
    system: assembleSystem({
      role: [
        `You are an expert linguist reviewing ${input.sourceLang} to ${input.targetLabel} translations.`,
        'You receive the source text and one or more candidate translations. Find concrete problems in each candidate.',
        'Check, in this order: accuracy (mistranslation), omission, addition, terminology (consistency, glossary, product names), grammar, fluency, style and register for the audience, consistency, formatting (Markdown, placeholders ⟦PHn⟧, numbers, units).',
        'Answer with a single JSON object, nothing else:',
        '{"issues": [{"candidate": "translatorA"|"translatorB"|"translatorC", "category": one of accuracy|omission|addition|terminology|grammar|fluency|style|consistency|formatting|guideline, "severity": "minor"|"major"|"critical", "sourceSpan"?: string, "targetSpan"?: exact text in the candidate, "explanation": string, "fix"?: corrected wording}],',
        ' "suggestions": [general improvements that apply to the final version], "preferred": the candidate id that is the best starting point, or null}',
        'Be specific and terse. Report only real problems. Do not rewrite the whole translation.',
      ],
      ...materialBlocks(input.materials),
    }),
    user: [
      `<SOURCE_TEXT>\n${input.sourceChunk}\n</SOURCE_TEXT>`,
      '',
      formatCandidates(input.candidates),
    ].join('\n'),
  }
}
