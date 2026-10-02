import { describe, expect, it } from 'vitest'
import {
  condenseSource,
  MAX_CONDENSE_INPUT_CHARS,
  sourceText,
  sourceTokensUpTo,
} from '../src/context/condense.ts'
import { crawlLlmsTxt, linkedTextUrls, sourceHashInput } from '../src/context/crawl.ts'
import { createBudgetTracker } from '../src/pipeline/budget.ts'
import { type FetchPort, noopLogger } from '../src/ports.ts'
import type { ContextSource } from '../src/types.ts'
import { createFakeLlm } from './fakes.ts'

const llms = `# Docs
> Product docs.

## Guides
- [Start](/start.md): Install
- [Start again](https://x.dev/start.md#top)
- [Site](https://x.dev/about.html): an HTML page
- [Mail](mailto:a@x.dev)
- [API](api.txt)
`

const fakeFetch = (
  pages: Record<string, string>,
  contentType = 'text/markdown',
): FetchPort & { seen: string[] } => {
  const seen: string[] = []
  return {
    seen,
    async text(url) {
      seen.push(url)
      const body = pages[url]
      if (body === undefined) throw new Error(`HTTP 404 while fetching ${url}`)
      return { body, contentType }
    },
  }
}

describe('linkedTextUrls', () => {
  it('resolves relative links, drops fragments, duplicates, HTML pages and other schemes', () => {
    expect(linkedTextUrls(llms, { baseUrl: 'https://x.dev/llms.txt' })).toEqual([
      { url: 'https://x.dev/start.md', title: 'Start' },
      { url: 'https://x.dev/api.txt', title: 'API' },
    ])
  })

  it('keeps only absolute links without a base', () => {
    expect(linkedTextUrls(llms).map((l) => l.url)).toEqual(['https://x.dev/start.md'])
  })

  it('follows extensionless links after explicit text files and never hops to private hosts', () => {
    const text = `# Docs\n\n## Guides\n- [Quickstart](https://x.dev/docs/quickstart)\n- [Start](/start.md)\n- [Meta](http://169.254.169.254/latest/meta-data/iam.txt)\n- [Local](http://localhost:3000/notes.md)\n`
    expect(linkedTextUrls(text, { baseUrl: 'https://x.dev/llms.txt' }).map((l) => l.url)).toEqual([
      'https://x.dev/start.md',
      'https://x.dev/docs/quickstart',
    ])
    expect(
      linkedTextUrls(text, { baseUrl: 'http://localhost:3000/llms.txt' }).map((l) => l.url),
    ).toContain('http://localhost:3000/notes.md')
  })

  it('takes a linked llms-full.txt alone since it holds everything', () => {
    const text = `${llms}\n## Optional\n- [Full](/llms-full.txt)\n`
    expect(linkedTextUrls(text, { baseUrl: 'https://x.dev/llms.txt' })).toEqual([
      { url: 'https://x.dev/llms-full.txt', title: 'Full' },
    ])
  })
})

describe('crawlLlmsTxt', () => {
  it('fetches linked pages, skips failures and caps the kept characters', async () => {
    const fetch = fakeFetch({ 'https://x.dev/start.md': 'Run the installer.' })
    const pages = await crawlLlmsTxt(llms, fetch, noopLogger, {
      baseUrl: 'https://x.dev/llms.txt',
      maxChars: 7,
    })
    expect(fetch.seen).toEqual(['https://x.dev/start.md', 'https://x.dev/api.txt'])
    expect(pages).toEqual([{ url: 'https://x.dev/start.md', title: 'Start', text: 'Run the' }])
  })

  it('never crawls from an llms-full.txt itself', async () => {
    const fetch = fakeFetch({})
    expect(
      await crawlLlmsTxt(llms, fetch, noopLogger, { baseUrl: 'https://x.dev/llms-full.txt' }),
    ).toEqual([])
    expect(await crawlLlmsTxt(llms, fetch, noopLogger, { sourceName: 'llms-full.txt' })).toEqual([])
    expect(fetch.seen).toEqual([])
  })

  it('drops pages that answer with HTML and keeps the previous copy of a page that fails', async () => {
    const previous = [{ url: 'https://x.dev/api.txt', title: 'API', text: 'Old API notes' }]
    const pages = await crawlLlmsTxt(
      llms,
      fakeFetch({ 'https://x.dev/start.md': '<!DOCTYPE html><html></html>' }),
      noopLogger,
      { baseUrl: 'https://x.dev/llms.txt', previous },
    )
    expect(pages).toEqual(previous)
  })

  it('stops at maxPages', async () => {
    const fetch = fakeFetch({})
    await crawlLlmsTxt(llms, fetch, noopLogger, { baseUrl: 'https://x.dev/', maxPages: 1 })
    expect(fetch.seen).toEqual(['https://x.dev/start.md'])
  })
})

describe('linked pages in a source', () => {
  it('cap the condense input and the token comparisons', async () => {
    const linked = [{ url: 'https://x.dev/full.md', title: 'Full', text: 'word '.repeat(60_000) }]
    const source = { id: 's', name: 's', kind: 'llms-txt', rawText: llms, linked } as ContextSource
    expect(sourceTokensUpTo(source, 100)).toBe(101)
    const llm = createFakeLlm(() => 'digest')
    await condenseSource('m', source, 100, {
      llm,
      clock: { now: () => 0 },
      logger: noopLogger,
      events: { emit: () => undefined },
      budget: createBudgetTracker(null),
      trace: [],
    })
    const prompt = llm.calls[0]?.request.messages.map((m) => m.content).join('') ?? ''
    expect(prompt.length).toBeGreaterThan(MAX_CONDENSE_INPUT_CHARS)
    expect(prompt.length).toBeLessThan(MAX_CONDENSE_INPUT_CHARS + 5_000)
  })

  it('feed the digest text and change the hash input', () => {
    const linked = [{ url: 'https://x.dev/start.md', title: 'Start', text: 'Run the installer.' }]
    const source = { kind: 'llms-txt', rawText: llms, linked } as ContextSource
    expect(sourceText(source)).toContain('# Start (https://x.dev/start.md)\n\nRun the installer.')
    expect(sourceHashInput(llms, linked)).not.toBe(sourceHashInput(llms))
    expect(sourceHashInput(llms, [])).toBe(llms)
  })
})
