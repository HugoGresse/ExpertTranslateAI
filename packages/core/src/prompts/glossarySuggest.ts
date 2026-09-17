import { assembleSystem } from './assembleSystem.ts'
import { type PromptMaterials, roleLines } from './materials.ts'
import type { Prompt } from './translate.ts'

export interface GlossarySuggestPromptInput {
  sourceLang: string
  targetLabel: string
  sourceText: string
  finalText: string
  /** Source terms the glossary already covers; the model must not repeat them. */
  knownTerms: string[]
  materials: PromptMaterials
}

export function buildGlossarySuggestPrompt(input: GlossarySuggestPromptInput): Prompt {
  const known =
    input.knownTerms.length > 0
      ? `Already in the glossary (skip): ${input.knownTerms.join(', ')}`
      : ''
  return {
    system: assembleSystem({
      role: roleLines(input.materials, 'glossary'),
      contract: [
        `The source is ${input.sourceLang}; the translation is ${input.targetLabel}.`,
        'Return only a JSON array, at most 25 items: {"source": string, "target": string, "kind": "preferred" | "doNotTranslate", "note"?: string}.',
        '"source" is the exact term as written in the source, "target" the exact rendering used in the translation. Use "doNotTranslate" for names, brands, commands and identifiers that stayed unchanged.',
        'Only include terms worth locking for future translations: product and feature names, domain terminology, UI labels, recurring phrases. Skip ordinary vocabulary, placeholders ⟦PHn⟧ and one-off wording.',
        ...(known ? [known] : []),
      ],
      ...(input.materials.brief ? { brief: input.materials.brief.summary } : {}),
    }),
    user: `<SOURCE>\n${input.sourceText}\n</SOURCE>\n<TRANSLATION>\n${input.finalText}\n</TRANSLATION>`,
  }
}
