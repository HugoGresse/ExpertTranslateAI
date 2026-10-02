import {
  type ContextKind,
  type ContextSource,
  type CrawlOptions,
  contentHash,
  crawlLlmsTxt,
  isLlmsTxt,
  type LinkedPage,
  sourceHashInput,
} from '@experttranslate/core'
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

/** For an llms.txt, fetches the pages it links to; the hash covers them so digests refresh. */
export async function withLinkedPages(
  rawText: string,
  kind: ContextKind,
  opts: Pick<CrawlOptions, 'baseUrl' | 'sourceName' | 'previous'> = {},
): Promise<{ linked?: LinkedPage[]; contentHash: string }> {
  const linked = kind === 'llms-txt' ? await crawlLlmsTxt(rawText, browserFetch, logger, opts) : []
  return {
    ...(linked.length > 0 ? { linked } : {}),
    contentHash: await contentHash(sourceHashInput(rawText, linked)),
  }
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
    ...(await withLinkedPages(rawText, kind, {
      ...(sourceUrl ? { baseUrl: sourceUrl } : {}),
      ...(input.mode === 'file' && input.file ? { sourceName: input.file.name } : {}),
    })),
    enabled: true,
    createdAt: Date.now(),
    ...(sourceUrl ? { url: sourceUrl, fetchedAt: Date.now() } : {}),
    ...(input.lang ? { lang: input.lang } : {}),
  }
  logger.info('context.created', {
    kind,
    chars: rawText.length,
    linked: source.linked?.length ?? 0,
    name,
  })
  return source
}
