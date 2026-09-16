import { describe, expect, it } from 'vitest'
import { truncateToTokens } from '../src/context/prepare.ts'
import { createEngine } from '../src/engine.ts'
import { noopLogger } from '../src/ports.ts'
import { chunkText } from '../src/text/chunk.ts'
import { sliceSafe } from '../src/text/unicode.ts'
import type { ProgressEvent } from '../src/types.ts'
import { createFakeLlm, createMemoryStorage, sampleJob } from './fakes.ts'

const collect = async (iterable: AsyncIterable<ProgressEvent>): Promise<ProgressEvent[]> => {
  const out: ProgressEvent[] = []
  for await (const e of iterable) out.push(e)
  return out
}

describe('progress events carry the target key', () => {
  it('distinguishes two targets of the same language by region', async () => {
    const llm = createFakeLlm(() => 'hola')
    const engine = createEngine({
      llm,
      storage: createMemoryStorage(),
      clock: { now: () => 1 },
      logger: noopLogger,
    })
    const events = await collect(
      engine.run(sampleJob({ targets: [{ lang: 'es' }, { lang: 'es', region: 'Mexico' }] })),
    )
    const started = events.filter((e) => e.type === 'target-started')
    expect(started.map((e) => (e.type === 'target-started' ? e.targetKey : ''))).toEqual([
      'es',
      'es#mexico',
    ])
    const tokens = events.filter((e) => e.type === 'token')
    const keys = new Set(tokens.map((e) => (e.type === 'token' ? e.targetKey : '')))
    expect([...keys].sort()).toEqual(['es', 'es#mexico'])
    const done = events.filter((e) => e.type === 'target-done')
    expect(done.map((e) => (e.type === 'target-done' ? e.targetKey : ''))).toEqual(
      expect.arrayContaining(['es', 'es#mexico']),
    )
  })

  it('marks every target failed with its key when preparation fails', async () => {
    const storage = createMemoryStorage()
    storage.contexts.get = () => Promise.reject(new Error('db down'))
    const engine = createEngine({
      llm: createFakeLlm(() => 'x'),
      storage,
      clock: { now: () => 1 },
      logger: noopLogger,
    })
    const job = sampleJob({ targets: [{ lang: 'fr' }, { lang: 'fr', region: 'Canada' }] })
    job.options.contextSourceIds = ['c1']
    const events = await collect(engine.run(job))
    const failed = events.filter((e) => e.type === 'target-failed')
    expect(failed.map((e) => (e.type === 'target-failed' ? e.targetKey : ''))).toEqual([
      'fr',
      'fr#canada',
    ])
  })
})

describe('guidelines block truncation', () => {
  it('keeps the closing tag when the block is over budget', async () => {
    const llm = createFakeLlm(() => 'ok')
    const storage = createMemoryStorage()
    await storage.guidelines.put({
      id: 'g1',
      name: 'Long',
      enabled: true,
      createdAt: 0,
      rules: Array.from({ length: 80 }, (_, i) => ({
        id: `r${i}`,
        text: `Rule number ${i} says something fairly long about style and tone`,
        kind: 'prefer' as const,
      })),
    })
    const engine = createEngine({ llm, storage, clock: { now: () => 1 }, logger: noopLogger })
    const job = sampleJob({ targets: [{ lang: 'fr' }] })
    job.options.guidelineSetIds = ['g1']
    job.options.guidelinesTokenBudget = 120
    await collect(engine.run(job))
    const system = llm.calls[0]?.request.messages[0]?.content ?? ''
    expect(system).toContain('<GUIDELINES>')
    expect(system).toContain('</GUIDELINES>')
    expect(system).toContain('1. PREFER Rule number 0 says')
    expect(system).not.toContain('Rule number 79')
    const kept = system.match(
      /^\d+\. PREFER Rule number \d+ says something fairly long about style and tone$/gm,
    )
    expect(kept?.length ?? 0).toBeGreaterThan(0)
    expect(system).not.toMatch(
      /Rule number \d+ says something fairly long about style and tone[^\n]+…/,
    )
  })
})

describe('sliceSafe', () => {
  it('never splits a surrogate pair', () => {
    const text = 'ab😀cd'
    expect(sliceSafe(text, 0, 3)).toBe('ab')
    expect(sliceSafe(text, 0, 4)).toBe('ab😀')
    expect(sliceSafe(text, 0, 99)).toBe(text)
    expect(sliceSafe(text, 3)).toBe('cd')
    expect(sliceSafe(text, 2)).toBe('😀cd')
  })

  it('character-level chunking never splits a placeholder token or a surrogate pair', () => {
    const text = `${'😀'.repeat(400)}⟦PH0⟧${'字'.repeat(400)}⟦PH1⟧${'😀'.repeat(400)}`
    const chunks = chunkText(text, 50)
    expect(chunks.length).toBeGreaterThan(1)
    for (const c of chunks) {
      expect(
        /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(c.text),
      ).toBe(false)
      expect((c.text.match(/⟦/g) ?? []).length).toBe((c.text.match(/⟧/g) ?? []).length)
    }
    expect(chunks.map((c) => c.text).join('')).toBe(text)
  })

  it('truncated output stays well-formed UTF-16', () => {
    const text = '😀'.repeat(400)
    const { text: out, truncated } = truncateToTokens(text, 20)
    expect(truncated).toBe(true)
    expect(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(out)).toBe(
      false,
    )
  })
})
