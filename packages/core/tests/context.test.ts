import { describe, expect, it } from 'vitest'
import { needsCondense } from '../src/context/condense.ts'
import { buildContextBlock, ensureDigests, truncateToTokens } from '../src/context/prepare.ts'
import { noopLogger } from '../src/ports.ts'
import type { ContextSource } from '../src/types.ts'
import { createFakeLlm, createMemoryStorage } from './fakes.ts'

const small: ContextSource = {
  id: 'c1',
  name: 'Glossary notes',
  kind: 'pasted',
  rawText: 'Hyperfluid is the platform. Bifrost is the query gateway.',
  contentHash: 'h1',
  enabled: true,
  createdAt: 0,
}

const big: ContextSource = {
  ...small,
  id: 'c2',
  name: 'Big doc',
  rawText: 'word '.repeat(600),
  contentHash: 'h2',
}

describe('context', () => {
  it('condenses only sources over budget and persists the digest keyed by hash', async () => {
    const llm = createFakeLlm(() => 'CONDENSED DIGEST')
    const storage = createMemoryStorage()
    await storage.contexts.put(big)
    const { sources, usages } = await ensureDigests([small, big], {
      budgetPerSource: 100,
      llm,
      model: 'helper',
      storage,
      logger: noopLogger,
    })
    expect(llm.calls).toHaveLength(1)
    expect(usages).toHaveLength(1)
    expect(sources[1]?.condensed?.forHash).toBe('h2')
    expect((await storage.contexts.get('c2'))?.condensed?.text).toBe('CONDENSED DIGEST')

    const again = await ensureDigests(sources, {
      budgetPerSource: 100,
      llm,
      model: 'helper',
      storage,
      logger: noopLogger,
    })
    expect(llm.calls).toHaveLength(1)
    expect(again.usages).toHaveLength(0)
  })

  it('builds a context block using raw text or digest', () => {
    const digested: ContextSource = {
      ...big,
      condensed: { text: 'DIGEST', model: 'm', tokenEstimate: 1, forHash: 'h2' },
    }
    const { block, truncated } = buildContextBlock([small, digested], 100, noopLogger)
    expect(block).toContain('<CONTEXT>')
    expect(block).toContain('### Glossary notes\nHyperfluid is the platform.')
    expect(block).toContain('### Big doc\nDIGEST')
    expect(truncated).toEqual([])
    expect(needsCondense(small, 100)).toBe(false)
  })

  it('truncates oversized text and marks it', () => {
    const { text, truncated } = truncateToTokens('alpha beta gamma delta epsilon zeta eta theta', 3)
    expect(truncated).toBe(true)
    expect(text.endsWith('…')).toBe(true)
  })
})
