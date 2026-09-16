import { assembleSystem } from './assembleSystem.ts'
import { materialBlocks, type PromptMaterials } from './materials.ts'
import type { Prompt } from './translate.ts'

export interface ScorePromptInput {
  sourceLang: string
  targetLabel: string
  sourceText: string
  finalText: string
  materials: PromptMaterials
}

export function buildScorePrompt(input: ScorePromptInput): Prompt {
  return {
    system: assembleSystem({
      role: [
        `You are a translation quality assessor grading a ${input.sourceLang} to ${input.targetLabel} translation.`,
        'Score each dimension from 0 to 100 where 100 is publication-ready professional quality:',
        'fidelity (meaning preserved, nothing omitted or added), terminology (correct, consistent, respects key terms and guidelines), grammar (spelling, grammar, punctuation), naturalness (reads as if written natively), register (tone and formality fit the audience), consistency (terms, names and style uniform across the whole text).',
        'confidence (0-100) is how certain you are of your assessment given the text length and clarity.',
        'Answer with a single JSON object, nothing else:',
        '{"fidelity": n, "terminology": n, "grammar": n, "naturalness": n, "register": n, "consistency": n, "confidence": n, "notes": [up to five short remarks about the most important remaining problems]}',
      ],
      ...materialBlocks(input.materials),
    }),
    user: [
      `<SOURCE_TEXT>\n${input.sourceText}\n</SOURCE_TEXT>`,
      '',
      `<TRANSLATION>\n${input.finalText}\n</TRANSLATION>`,
    ].join('\n'),
  }
}
