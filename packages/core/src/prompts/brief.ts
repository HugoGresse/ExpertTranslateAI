import { assembleSystem } from './assembleSystem.ts'
import { materialBlocks, type PromptMaterials } from './materials.ts'
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
      role: [
        'You are a senior localization project manager preparing a translation brief.',
        'Analyse the source document and answer with a single JSON object, nothing else:',
        '{"detectedLang": BCP-47 code, "domain": "general"|"legal"|"technical"|"marketing"|"medical"|"literary"|"ui",',
        ' "difficulty": "simple"|"normal"|"hard"|"critical", "summary": one paragraph, "tone": short phrase, "audience": short phrase,',
        ' "keyTerms": [{"term": string, "note": how it should be handled}], "risks": [short strings]}',
        'Difficulty guide: simple = short, plain, low stakes; normal = typical product or documentation text; hard = specialised terminology, ambiguity, marketing nuance or long structured content; critical = legal, medical, safety or contractual text where errors have real consequences.',
        'Key terms: product names, brand names, commands, domain terms and anything that must stay consistent. Risks: idioms, ambiguity, placeholders, numbers and units, cultural references, formatting traps.',
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
