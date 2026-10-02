import { createLimiter } from '../llm/limiter.ts'
import type { FetchPort, LoggerPort } from '../ports.ts'
import type { LinkedPage } from '../types.ts'
import { parseLlmsTxt } from './llmsTxt.ts'

export interface CrawlOptions {
  /** Where the llms.txt was fetched from; relative links resolve against it. */
  baseUrl?: string
  /** File name or URL of the source; an llms-full.txt is never crawled further. */
  sourceName?: string
  /** Pages from an earlier crawl, kept for links that fail this time. */
  previous?: LinkedPage[]
  maxPages?: number
  /** Total characters kept across every page; the rest is cut. */
  maxChars?: number
  concurrency?: number
  signal?: AbortSignal
}

export const CRAWL_DEFAULTS = { maxPages: 25, maxChars: 400_000, concurrency: 4 } as const

const FULL_RE = /(^|\/)llms-full\.txt$/i
const TEXT_RE = /\.(md|mdx|markdown|txt)$/i
/** Extensionless paths often serve Markdown to an `Accept: text/markdown` request. */
const NO_EXT_RE = /\/[^/.]*$/
const HTML_RE = /^\s*<(!doctype html|html)/i

/** Loopback, private, link-local and internal names; never followed from another host's llms.txt. */
const PRIVATE_HOST_RE =
  /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.|\[(::1?|f[cd]|fe80))|\.(local|internal|localhost)$/i

const resolve = (href: string, base?: string): URL | null => {
  try {
    const url = new URL(href, base)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null
  } catch {
    return null
  }
}

export const isFullLlmsTxt = (nameOrUrl: string): boolean => {
  const url = resolve(nameOrUrl)
  return FULL_RE.test(url ? url.pathname : nameOrUrl)
}

/**
 * The pages an llms.txt points at worth fetching as text. A linked llms-full.txt already holds
 * everything, so it is the only page taken when present; otherwise every Markdown or text link.
 */
export function linkedTextUrls(
  rawText: string,
  opts: Pick<CrawlOptions, 'baseUrl'> = {},
): Array<{ url: string; title: string }> {
  const base = opts.baseUrl ? resolve(opts.baseUrl) : null
  const self = base?.href
  const seen = new Set<string>()
  const links: Array<{ url: string; title: string }> = []
  for (const section of parseLlmsTxt(rawText).sections)
    for (const link of section.links) {
      const url = resolve(link.url, opts.baseUrl)
      if (!url) continue
      url.hash = ''
      const textLike = TEXT_RE.test(url.pathname) || NO_EXT_RE.test(url.pathname)
      const privateHop = PRIVATE_HOST_RE.test(url.hostname) && url.hostname !== base?.hostname
      if (url.href === self || seen.has(url.href) || !textLike || privateHop) continue
      seen.add(url.href)
      links.push({ url: url.href, title: link.title })
    }
  const full = links.find((l) => FULL_RE.test(new URL(l.url).pathname))
  if (full) return [full]
  // Explicit Markdown and text files first, so guessed extensionless pages never crowd them out.
  const explicit = (l: { url: string }): number => (TEXT_RE.test(new URL(l.url).pathname) ? 0 : 1)
  return links.sort((a, b) => explicit(a) - explicit(b))
}

/** Fetches the text pages an llms.txt links to. Unreachable pages are logged and skipped. */
export async function crawlLlmsTxt(
  rawText: string,
  fetch: FetchPort,
  logger: LoggerPort,
  opts: CrawlOptions = {},
): Promise<LinkedPage[]> {
  if (isFullLlmsTxt(opts.sourceName ?? opts.baseUrl ?? '')) return []
  const maxPages = opts.maxPages ?? CRAWL_DEFAULTS.maxPages
  const previous = new Map((opts.previous ?? []).map((p) => [p.url, p]))
  const all = linkedTextUrls(rawText, opts)
  const links = all.slice(0, maxPages)
  if (all.length > links.length)
    logger.warn('context.crawl.capped', { found: all.length, kept: links.length })
  if (links.length === 0) return []
  logger.info('context.crawl.start', { pages: links.length, base: opts.baseUrl ?? null })
  const limiter = createLimiter(opts.concurrency ?? CRAWL_DEFAULTS.concurrency)
  const fetched = await Promise.all(
    links.map((link) =>
      limiter.run(async (): Promise<LinkedPage | null> => {
        try {
          const { body, contentType } = await fetch.text(
            link.url,
            opts.signal ? { signal: opts.signal } : {},
          )
          logger.debug('context.crawl.page', { url: link.url, chars: body.length, contentType })
          // An extensionless link that answered with a web page is not text worth keeping.
          if (/html/i.test(contentType) || HTML_RE.test(body)) return null
          return body.trim() ? { url: link.url, title: link.title, text: body } : null
        } catch (error) {
          if (opts.signal?.aborted) throw error
          const kept = previous.get(link.url)
          logger.warn('context.crawl.pageFailed', {
            url: link.url,
            error: String(error),
            keptPrevious: kept !== undefined,
          })
          return kept ?? null
        }
      }),
    ),
  )
  let budget = opts.maxChars ?? CRAWL_DEFAULTS.maxChars
  const pages: LinkedPage[] = []
  for (const page of fetched) {
    if (!page || budget <= 0) continue
    const text = page.text.length > budget ? page.text.slice(0, budget) : page.text
    budget -= text.length
    pages.push({ ...page, text })
  }
  logger.info('context.crawl.done', {
    pages: pages.length,
    failed: links.length - fetched.filter(Boolean).length,
    chars: pages.reduce((n, p) => n + p.text.length, 0),
  })
  return pages
}

/** Hash input for a source: its own text plus what was crawled, so a changed page busts the digest. */
export const sourceHashInput = (rawText: string, linked: LinkedPage[] = []): string =>
  linked.length === 0
    ? rawText
    : [rawText, ...linked.map((p) => `\n\n<<${p.url}>>\n${p.text}`)].join('')
