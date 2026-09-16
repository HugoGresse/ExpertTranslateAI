import { assembleSystem } from './assembleSystem.ts'
import { type PromptMaterials, roleLines } from './materials.ts'
import type { Prompt } from './translate.ts'

export interface BackTranslatePromptInput {
  sourceLang: string
  targetLabel: string
  finalText: string
  materials: PromptMaterials
}

export function buildBackTranslatePrompt(input: BackTranslatePromptInput): Prompt {
  return {
    system: assembleSystem({
      role: roleLines(input.materials, 'backtranslate'),
      contract: [
        `Translate the following ${input.targetLabel} text back into ${input.sourceLang}.`,
        'Never translate or alter tokens of the form ⟦PHn⟧. Output only the translation.',
      ],
    }),
    user: `<TRANSLATION>\n${input.finalText}\n</TRANSLATION>`,
  }
}

export interface DeltaPromptInput {
  sourceLang: string
  sourceText: string
  backText: string
  materials: PromptMaterials
}

export function buildDeltaPrompt(input: DeltaPromptInput): Prompt {
  return {
    system: assembleSystem({
      role: roleLines(input.materials, 'deltas'),
      contract: [
        `The original is in ${input.sourceLang}.`,
        'Answer with a single JSON object, nothing else:',
        '{"deltas": [{"source": exact original span, "back": corresponding back-translated span, "kind": "loss"|"addition"|"shift", "severity": "minor"|"major", "note": short explanation}]}',
        'Return an empty list when the meaning is fully preserved.',
      ],
    }),
    user: [
      `<ORIGINAL>\n${input.sourceText}\n</ORIGINAL>`,
      '',
      `<BACK_TRANSLATION>\n${input.backText}\n</BACK_TRANSLATION>`,
    ].join('\n'),
  }
}
