import type { Prompt } from './translate.ts'

export function buildExtractRulesPrompt(freeText: string): Prompt {
  return {
    system: [
      'You turn a translation style guide into a list of discrete, checkable rules.',
      'Return only a JSON array. Each item: {"text": string, "kind": "must" | "must-not" | "prefer", "pattern"?: string, "examples"?: {"good"?: string, "bad"?: string}}.',
      '"pattern" is an optional case-insensitive regular expression (JavaScript syntax) that detects a violation in the translated text: for a must-not rule it matches forbidden output, for a must rule it matches required output. Only include it when the rule is mechanically checkable, for example a term that must not be translated.',
      'Keep each rule to one sentence. Do not invent rules that are not in the guide.',
    ].join('\n'),
    user: `<STYLE_GUIDE>\n${freeText}\n</STYLE_GUIDE>`,
  }
}
