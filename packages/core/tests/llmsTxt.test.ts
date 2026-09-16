import { describe, expect, it } from 'vitest'
import { digestLlmsTxt, isLlmsTxt, parseLlmsTxt } from '../src/context/llmsTxt.ts'

const sample = `# Hyperfluid
> Managed AI platform for research teams.

Some intro text.

## Docs
- [Getting started](https://x.dev/start.md): Install hfctl and deploy a first app
- [Data Docks](https://x.dev/docks.md)

## Optional
- [Changelog](https://x.dev/changelog.md): Release notes
`

describe('parseLlmsTxt', () => {
  it('parses title, summary, intro and sections with links', () => {
    const parsed = parseLlmsTxt(sample)
    expect(parsed.title).toBe('Hyperfluid')
    expect(parsed.summary).toBe('Managed AI platform for research teams.')
    expect(parsed.intro).toBe('Some intro text.')
    expect(parsed.sections.map((s) => s.title)).toEqual(['Docs', 'Optional'])
    expect(parsed.sections[0]?.links).toEqual([
      {
        title: 'Getting started',
        url: 'https://x.dev/start.md',
        description: 'Install hfctl and deploy a first app',
      },
      { title: 'Data Docks', url: 'https://x.dev/docks.md' },
    ])
  })

  it('detects llms.txt by url or by shape', () => {
    expect(isLlmsTxt('whatever', 'https://x.dev/llms.txt')).toBe(true)
    expect(isLlmsTxt(sample)).toBe(true)
    expect(isLlmsTxt('# Just a doc\n\nparagraph')).toBe(false)
  })

  it('digests into compact markdown', () => {
    expect(digestLlmsTxt(parseLlmsTxt(sample))).toMatchSnapshot()
  })
})
