import { assembleSystem } from './assembleSystem.ts'
import { materialBlocks, type PromptMaterials, roleLines } from './materials.ts'
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
      role: roleLines(input.materials, 'score'),
      contract: [
        `Language pair: ${input.sourceLang} → ${input.targetLabel}.`,
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
