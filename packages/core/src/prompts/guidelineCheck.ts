import type { Candidate } from '../types.ts'
import { assembleSystem } from './assembleSystem.ts'
import { formatCandidates, type PromptMaterials, roleLines } from './materials.ts'
import type { Prompt } from './translate.ts'

export interface GuidelineCheckPromptInput {
  targetLabel: string
  sourceChunk: string
  candidates: Candidate[]
  guidelinesBlock: string
  materials?: PromptMaterials
}

export function buildGuidelineCheckPrompt(input: GuidelineCheckPromptInput): Prompt {
  return {
    system: assembleSystem({
      role: roleLines(input.materials, 'guidelines'),
      contract: [
        `Target language: ${input.targetLabel}.`,
        'Answer with a single JSON object, nothing else:',
        '{"violations": [{"ruleNumber": integer, "candidate": "translatorA"|"translatorB"|"translatorC", "severity": "minor"|"major", "targetSpan"?: exact text, "explanation": string, "fix"?: corrected wording}]}',
      ],
      guidelines: input.guidelinesBlock,
    }),
    user: [
      `<SOURCE_TEXT>\n${input.sourceChunk}\n</SOURCE_TEXT>`,
      '',
      formatCandidates(input.candidates),
    ].join('\n'),
  }
}
