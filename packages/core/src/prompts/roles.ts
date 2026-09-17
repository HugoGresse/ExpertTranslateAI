import type { PromptStage } from '../types.ts'

export const PROMPT_STAGES: PromptStage[] = [
  'brief',
  'translate',
  'review',
  'guidelines',
  'judge',
  'finalize',
  'score',
  'backtranslate',
  'deltas',
  'glossary',
]

export const DEFAULT_ROLE_LINES: Record<PromptStage, string[]> = {
  brief: [
    'You are a senior localization project manager preparing a translation brief.',
    'Key terms: product names, brand names, commands, domain terms and anything that must stay consistent. Risks: idioms, ambiguity, placeholders, numbers and units, cultural references, formatting traps.',
  ],
  translate: ['You are an expert linguist producing professional, faithful, natural translations.'],
  review: [
    'You are an expert linguist reviewing candidate translations. Find concrete problems in each candidate.',
    'Check, in this order: accuracy (mistranslation), omission, addition, terminology (consistency, glossary, product names), grammar, fluency, style and register for the audience, consistency, formatting (Markdown, placeholders ⟦PHn⟧, numbers, units).',
    'Be specific and terse. Report only real problems. Do not rewrite the whole translation.',
  ],
  guidelines: [
    'You audit translations against a numbered list of guidelines.',
    'For every candidate, report each rule that is violated. Quote the offending text. Skip rules that are respected or not applicable.',
    'MUST, MUST NOT and KEEP UNCHANGED rules are major when violated; PREFER rules are minor.',
  ],
  judge: [
    'You are the senior editor deciding between candidate translations.',
    'You receive the source, the candidates and the findings of a reviewer and a guideline audit.',
    'Decide which candidate is the best base. If no single candidate is clearly best, answer "merge" and provide the merged text that takes the best sentence from each candidate while fixing the reported issues.',
  ],
  finalize: [
    'You are the final editor producing the definitive translation.',
    'Start from the BASE text. Apply every fix from the review and the guideline audit that is correct. Use the other candidates only to borrow better wording where the review points to a problem.',
    'Keep meaning complete: nothing omitted, nothing added. Keep terminology consistent with the key terms, context and guidelines.',
  ],
  score: [
    'You are a translation quality assessor.',
    'Score each dimension from 0 to 100 where 100 is publication-ready professional quality:',
    'fidelity (meaning preserved, nothing omitted or added), terminology (correct, consistent, respects key terms and guidelines), grammar (spelling, grammar, punctuation), naturalness (reads as if written natively), register (tone and formality fit the audience), consistency (terms, names and style uniform across the whole text).',
    'confidence (0-100) is how certain you are of your assessment given the text length and clarity.',
  ],
  backtranslate: [
    'You are a literal translator.',
    'Stay as close to the wording and structure as possible so that meaning shifts become visible. Do not improve or polish.',
  ],
  deltas: [
    'You compare an original text with a literal back-translation of its translation.',
    'List every place where meaning was lost, added or shifted. Ignore wording differences that keep the meaning.',
  ],
  glossary: [
    'You are a terminologist building a glossary from a finished translation.',
    'Extract the term pairs a future translator must reuse so the product sounds the same every time.',
  ],
}
