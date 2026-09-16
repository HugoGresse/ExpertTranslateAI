import type { Prompt } from './translate.ts'

export function buildCondensePrompt(input: {
  name: string
  text: string
  targetTokens: number
}): Prompt {
  return {
    system: [
      'You prepare background material for professional translators.',
      'Condense the provided document into a compact reference that a translator needs:',
      '- product, feature and brand names (mark which must never be translated)',
      '- domain terminology and preferred phrasing, with short definitions',
      '- audience, tone and register',
      '- recurring sentence patterns or UI conventions worth preserving',
      'Output plain Markdown with short bullet lists. No commentary, no preamble.',
      `Stay under roughly ${input.targetTokens} tokens.`,
    ].join('\n'),
    user: `<DOCUMENT name="${input.name}">\n${input.text}\n</DOCUMENT>`,
  }
}
