import { assembleSystem } from './assembleSystem.ts'
import { materialBlocks, type PromptMaterials, roleLines } from './materials.ts'
import type { Prompt } from './translate.ts'

export interface BriefPromptInput {
  sourceText: string
  sourceLangHint: string
  targetLangs: string[]
  materials: PromptMaterials
}

export function buildBriefPrompt(input: BriefPromptInput): Prompt {
  return {
    system: assembleSystem({
      role: roleLines(input.materials, 'brief'),
      contract: [
        'Analyse the source document and answer with a single JSON object, nothing else:',
        '{"detectedLang": BCP-47 code, "domain": "general"|"legal"|"technical"|"marketing"|"medical"|"literary"|"ui",',
        ' "difficulty": "simple"|"normal"|"hard"|"critical", "summary": one paragraph, "tone": short phrase, "audience": short phrase,',
        ' "keyTerms": [{"term": string, "note": how it should be handled}], "risks": [short strings]}',
        'Difficulty guide: simple = short, plain, low stakes; normal = typical product or documentation text; hard = specialised terminology, ambiguity, marketing nuance or long structured content; critical = legal, medical, safety or contractual text where errors have real consequences.',
      ],
      ...materialBlocks(input.materials),
    }),
    user: [
      `Source language hint: ${input.sourceLangHint}. Target languages: ${input.targetLangs.join(', ')}.`,
      '<SOURCE_TEXT>',
      input.sourceText,
      '</SOURCE_TEXT>',
    ].join('\n'),
  }
}
