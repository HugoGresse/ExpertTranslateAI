import { type ContextKind, type ContextSource, contentHash, isLlmsTxt } from '@experttranslate/core'
import { browserFetch } from '../adapters/browserFetch'
import { logger } from '../adapters/logger'
import { readTextFile } from './files'
import { normalizeUrl } from './url'

export type ContextInputMode = 'url' | 'file' | 'paste'

export interface ContextInput {
  mode: ContextInputMode
  url?: string
  file?: File | null
  text?: string
  name?: string
  lang?: string
}

/** Turns what the user typed, picked or pasted into a stored-shape context source. */
export async function createContextSource(input: ContextInput): Promise<ContextSource> {
  let rawText = input.text ?? ''
  let kind: ContextKind = 'pasted'
  let sourceUrl: string | undefined
  if (input.mode === 'url') {
    sourceUrl = normalizeUrl(input.url ?? '')
    const { body } = await browserFetch.text(sourceUrl)
    rawText = body
    kind = isLlmsTxt(body, sourceUrl) ? 'llms-txt' : 'markdown-url'
  } else if (input.mode === 'file') {
    if (!input.file) throw new Error('Choose a file first')
    rawText = await readTextFile(input.file)
    kind = isLlmsTxt(rawText, input.file.name) ? 'llms-txt' : 'markdown-file'
  } else if (isLlmsTxt(rawText)) {
    kind = 'llms-txt'
  }
  if (rawText.trim().length === 0) throw new Error('The source is empty')
  const name =
    input.name?.trim() ||
    (sourceUrl ? new URL(sourceUrl).hostname : input.file?.name) ||
    'Pasted context'
  const source: ContextSource = {
    id: crypto.randomUUID(),
    name,
    kind,
    rawText,
    contentHash: await contentHash(rawText),
    enabled: true,
    createdAt: Date.now(),
    ...(sourceUrl ? { url: sourceUrl, fetchedAt: Date.now() } : {}),
    ...(input.lang ? { lang: input.lang } : {}),
  }
  logger.info('context.created', { kind, chars: rawText.length, name })
  return source
}
