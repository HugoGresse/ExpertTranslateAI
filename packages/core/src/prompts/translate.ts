import type { JobOptions, Target } from '../types.ts'
import { assembleSystem } from './assembleSystem.ts'

export interface TranslatePromptInput {
  sourceLang: string
  target: Target
  options: Pick<JobOptions, 'tone' | 'audience' | 'formality' | 'preserveFormatting'>
  fullText: string
  chunkText: string
  isMultiChunk: boolean
  contextBlock?: string
  guidelinesBlock?: string
}

export interface Prompt {
  system: string
  user: string
}

const targetLabel = (t: Target): string =>
  t.region ? `${t.lang} as spoken in ${t.region}` : t.lang

function styleLines(options: TranslatePromptInput['options']): string[] {
  const lines: string[] = []
  if (options.tone) lines.push(`Tone: ${options.tone}.`)
  if (options.audience) lines.push(`Audience: ${options.audience}.`)
  if (options.formality && options.formality !== 'auto')
    lines.push(`Register: ${options.formality}.`)
  if (options.preserveFormatting) {
    lines.push('Preserve Markdown structure, line breaks, lists and inline formatting exactly.')
  }
  lines.push('Never translate or alter tokens of the form ⟦PHn⟧; keep every one of them in place.')
  return lines
}

export function translateSystemPrompt(input: TranslatePromptInput): string {
  return assembleSystem({
    role: [
      `You are an expert linguist, specializing in translation from ${input.sourceLang} to ${targetLabel(input.target)}.`,
    ],
    ...(input.contextBlock ? { context: input.contextBlock } : {}),
    ...(input.guidelinesBlock ? { guidelines: input.guidelinesBlock } : {}),
    task: styleLines(input.options),
  })
}

export function translateUserPrompt(input: TranslatePromptInput): string {
  const target = targetLabel(input.target)
  if (!input.isMultiChunk) {
    return [
      `This is a ${input.sourceLang} to ${target} translation, please provide the ${target} translation for this text.`,
      'Do not provide any explanations or text apart from the translation.',
      `${input.sourceLang}: ${input.chunkText}`,
      '',
      `${target}:`,
    ].join('\n')
  }
  const highlighted = input.fullText.replace(
    input.chunkText,
    `<TRANSLATE_THIS>${input.chunkText}</TRANSLATE_THIS>`,
  )
  return [
    `Your task is to provide a professional translation from ${input.sourceLang} to ${target} of PART of a text.`,
    'The source text is below, delimited by XML tags <SOURCE_TEXT> and </SOURCE_TEXT>.',
    'Translate only the part within <TRANSLATE_THIS> and </TRANSLATE_THIS>. Use the rest of the source text as context.',
    'Do not translate any other part of the source text. Output only the translation of the indicated part, nothing else.',
    '',
    '<SOURCE_TEXT>',
    highlighted,
    '</SOURCE_TEXT>',
    '',
    `Output only the translation of the portion you are asked to translate, and nothing else.`,
  ].join('\n')
}

export function buildTranslatePrompt(input: TranslatePromptInput): Prompt {
  return { system: translateSystemPrompt(input), user: translateUserPrompt(input) }
}
