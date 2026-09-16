import type { Prompt } from './translate.ts'

export function buildExtractRulesPrompt(freeText: string): Prompt {
  return {
    system: [
      'You turn a translation style guide into a list of discrete, checkable rules.',
      'Return only a JSON array. Each item: {"text": string, "kind": "must" | "must-not" | "prefer" | "keep", "pattern"?: string, "examples"?: {"good"?: string, "bad"?: string}}.',
      'Kinds: "keep" = a term (product name, brand, command, code identifier) must stay exactly as in the source; its "pattern" matches that term, e.g. "\\bHyperfluid\\b". "must-not" = forbidden wording; its "pattern" matches the forbidden output, never the correct one. "must" = required wording; its "pattern" matches what must appear. "prefer" = soft stylistic advice, no pattern.',
      'Patterns are case-insensitive JavaScript regular expressions. Only include one when the rule is mechanically checkable; otherwise omit it.',
      'Keep each rule to one sentence. Do not invent rules that are not in the guide.',
    ].join('\n'),
    user: `<STYLE_GUIDE>\n${freeText}\n</STYLE_GUIDE>`,
  }
}
