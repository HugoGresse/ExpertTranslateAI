import { describe, expect, it } from 'vitest'
import { formatContext, formatModelPrice, groupModels, modelAuthor } from '../src/models/catalog.ts'
import type { ModelInfo } from '../src/types.ts'

const m = (id: string, created: number, out = 1): ModelInfo => ({
  id,
  name: id,
  created,
  contextLength: 200_000,
  pricing: { promptUsdPerToken: out / 4e6, completionUsdPerToken: out / 1e6 },
  supportsStructuredOutput: true,
})

describe('catalog grouping', () => {
  it('pins the newest major models and orders groups major-first with aliases on top', () => {
    const { pinned, groups } = groupModels(
      [
        m('zeta/old-model', 900),
        m('openai/gpt-5', 500),
        m('~anthropic/claude-sonnet-latest', 0),
        m('anthropic/claude-sonnet-4.5', 400),
        m('anthropic/claude-opus-4.6', 600),
        m('google/gemini-2.5-pro', 300),
      ],
      2,
    )
    expect(pinned.map((x) => x.id)).toEqual(['anthropic/claude-opus-4.6', 'openai/gpt-5'])
    expect(groups.map((g) => g.author)).toEqual(['anthropic', 'openai', 'google', 'zeta'])
    expect(groups[0]?.models.map((x) => x.id)).toEqual([
      '~anthropic/claude-sonnet-latest',
      'anthropic/claude-opus-4.6',
      'anthropic/claude-sonnet-4.5',
    ])
  })

  it('formats prices, context and authors', () => {
    expect(formatModelPrice(m('a/b', 0, 12))).toBe('$3 · $12 /M')
    expect(formatModelPrice(m('a/b', 0, 0))).toBe('Free')
    expect(formatContext(1_048_576)).toBe('1.0M ctx')
    expect(formatContext(128_000)).toBe('128K ctx')
    expect(modelAuthor('~anthropic/claude-haiku-latest')).toBe('anthropic')
  })
})
