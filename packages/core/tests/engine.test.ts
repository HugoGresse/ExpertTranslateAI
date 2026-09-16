import { describe, expect, it } from 'vitest'
import { createEngine } from '../src/engine.ts'
import { noopLogger } from '../src/ports.ts'
import type { ProgressEvent } from '../src/types.ts'
import { createFakeLlm, createMemoryStorage, sampleJob } from './fakes.ts'

const collect = async (iterable: AsyncIterable<ProgressEvent>): Promise<ProgressEvent[]> => {
  const out: ProgressEvent[] = []
  for await (const e of iterable) out.push(e)
  return out
}

describe('engine.run', () => {
  it('translates every target, restores placeholders and persists results', async () => {
    const llm = createFakeLlm((req) => {
      const user = req.messages.find((m) => m.role === 'user')?.content ?? ''
      const tokens = user.match(/⟦PH\d+⟧/g) ?? []
      return `TRANSLATED ${tokens.join(' ')}`
    })
    const storage = createMemoryStorage()
    const engine = createEngine({ llm, storage, clock: { now: () => 1 }, logger: noopLogger })
    const job = sampleJob()

    const events = await collect(engine.run(job))

    const done = events.filter((e) => e.type === 'target-done')
    expect(done).toHaveLength(2)
    const fr = done.find((e) => e.type === 'target-done' && e.lang === 'fr')
    expect(fr && fr.type === 'target-done' ? fr.result.finalText : '').toBe(
      'TRANSLATED https://example.com {{name}}',
    )
    expect(events.at(-1)?.type).toBe('job-done')
    expect((await storage.jobs.get('job-1'))?.status).toBe('done')
    expect(await storage.results.listByJob('job-1')).toHaveLength(2)
    expect(llm.calls).toHaveLength(2)
    expect(llm.calls[1]?.request.messages[0]?.content).toContain('es as spoken in Mexico')
  })

  it('reports a failed target without killing the job', async () => {
    const llm = createFakeLlm((req) => {
      if (req.messages[0]?.content.includes('to fr')) throw new Error('model down')
      return 'ok'
    })
    const storage = createMemoryStorage()
    const engine = createEngine({ llm, storage, clock: { now: () => 1 }, logger: noopLogger })
    const events = await collect(engine.run(sampleJob()))
    expect(events.some((e) => e.type === 'target-failed' && e.lang === 'fr')).toBe(true)
    expect(events.some((e) => e.type === 'target-done' && e.lang === 'es')).toBe(true)
    expect((await storage.jobs.get('job-1'))?.status).toBe('failed')
  })

  it('estimates chunks and calls', () => {
    const engine = createEngine({
      llm: createFakeLlm(() => ''),
      storage: createMemoryStorage(),
      clock: { now: () => 1 },
      logger: noopLogger,
    })
    const estimate = engine.estimate(sampleJob(), [
      {
        id: 'test/model',
        name: 'm',
        contextLength: 1,
        pricing: { promptUsdPerToken: 1e-6, completionUsdPerToken: 2e-6 },
        supportsStructuredOutput: false,
      },
    ])
    expect(estimate.chunkCount).toBe(1)
    expect(estimate.callCount).toBe(2)
    expect(estimate.estimatedUsd).toBeGreaterThan(0)
  })
})

describe('engine.run with context and guidelines', () => {
  it('injects context and guidelines into prompts and reports rule violations', async () => {
    const llm = createFakeLlm((req) =>
      req.model === 'test/helper' ? 'DIGEST' : 'Bienvenue sur Hyperfluide',
    )
    const storage = createMemoryStorage()
    await storage.contexts.put({
      id: 'c1',
      name: 'Notes',
      kind: 'pasted',
      rawText: 'Hyperfluid stays Hyperfluid.',
      contentHash: 'h',
      enabled: true,
      createdAt: 0,
    })
    await storage.guidelines.put({
      id: 'g1',
      name: 'Names',
      enabled: true,
      createdAt: 0,
      rules: [
        { id: 'r1', text: 'Never translate Hyperfluid', kind: 'must-not', pattern: 'Hyperfluide' },
      ],
    })
    const engine = createEngine({ llm, storage, clock: { now: () => 1 }, logger: noopLogger })
    const job = sampleJob({ targets: [{ lang: 'fr' }] })
    job.options.contextSourceIds = ['c1']
    job.options.guidelineSetIds = ['g1']

    const events = await collect(engine.run(job))
    const done = events.find((e) => e.type === 'target-done')
    expect(done?.type).toBe('target-done')
    if (done?.type !== 'target-done') return
    expect(done.result.guidelineReport).toHaveLength(1)
    expect(done.result.guidelineReport[0]?.targetSpan).toBe('Hyperfluide')
    const system = llm.calls[0]?.request.messages[0]?.content ?? ''
    expect(system).toContain('<CONTEXT>')
    expect(system).toContain('Hyperfluid stays Hyperfluid.')
    expect(system).toContain('1. MUST NOT translate Hyperfluid')
    expect(llm.calls).toHaveLength(1)
  })
})

describe('engine.run on normal difficulty', () => {
  const replies: Record<string, string> = {
    'test/helper': JSON.stringify({
      detectedLang: 'en',
      domain: 'technical',
      difficulty: 'normal',
      summary: 'Product intro',
      tone: 'friendly',
      audience: 'developers',
      keyTerms: [{ term: 'Hyperfluid', note: 'keep' }],
      risks: [],
    }),
    'test/model': 'Bonjour A ⟦PH0⟧',
    'test/model-b': 'Salut B ⟦PH0⟧',
    'test/reviewer': JSON.stringify({
      issues: [
        {
          candidate: 'translatorB',
          category: 'style',
          severity: 'minor',
          explanation: 'too casual',
        },
      ],
      suggestions: ['keep it formal'],
      preferred: 'translatorA',
    }),
    'test/finalizer': 'Bonjour final ⟦PH0⟧',
    'test/scorer': JSON.stringify({
      fidelity: 90,
      terminology: 95,
      grammar: 100,
      naturalness: 85,
      register: 80,
      consistency: 90,
      confidence: 75,
      notes: ['ok'],
    }),
  }

  it('runs brief, two translators, review, finalize and score', async () => {
    const llm = createFakeLlm((req) => {
      if (req.model === 'test/reviewer' && req.messages[0]?.content.includes('audit'))
        return '{"violations": []}'
      return replies[req.model] ?? 'unexpected'
    })
    const storage = createMemoryStorage()
    await storage.guidelines.put({
      id: 'g1',
      name: 'Names',
      enabled: true,
      createdAt: 0,
      rules: [{ id: 'r1', text: 'Keep Hyperfluid', kind: 'keep', pattern: 'Hyperfluid' }],
    })
    const engine = createEngine({ llm, storage, clock: { now: () => 1 }, logger: noopLogger })
    const job = sampleJob({
      targets: [{ lang: 'fr' }],
      difficulty: 'auto',
      sourceText: 'Hello https://x.y from Hyperfluid',
    })
    job.options.guidelineSetIds = ['g1']

    const events = await collect(engine.run(job))
    const brief = events.find((e) => e.type === 'brief-done')
    expect(brief?.type).toBe('brief-done')
    const done = events.find((e) => e.type === 'target-done')
    if (done?.type !== 'target-done') throw new Error('no result')
    const r = done.result
    expect(r.plan).toEqual({ difficulty: 'normal', translators: ['translatorA', 'translatorB'] })
    expect(r.candidates.map((c) => c.role)).toEqual(['translatorA', 'translatorB'])
    expect(r.reviews[0]?.preferred).toBe('translatorA')
    expect(r.judgments).toEqual([])
    expect(r.finalText).toBe('Bonjour final https://x.y')
    expect(r.score?.overall).toBe(91)
    expect(r.score?.confidence).toBeGreaterThan(0)
    expect(r.guidelineReport.map((v) => v.ruleId)).toEqual(['r1'])
    expect(r.brief?.domain).toBe('technical')
    const stages = r.trace.map((t) => t.stage).sort()
    expect(stages).toEqual([
      'brief',
      'finalize',
      'guidelines',
      'review',
      'score',
      'translate',
      'translate',
    ])
    const finalizerPrompt =
      llm.calls.find((c) => c.request.model === 'test/finalizer')?.request.messages[1]?.content ??
      ''
    expect(finalizerPrompt).toContain('<BASE from="translatorA">')
    expect(finalizerPrompt).toContain('too casual')
  })

  it('fails the target when the budget cap is hit', async () => {
    const llm = createFakeLlm((req) => replies[req.model] ?? 'x', {
      promptTokens: 1,
      completionTokens: 1,
      costUsd: 0.01,
    })
    const engine = createEngine({
      llm,
      storage: createMemoryStorage(),
      clock: { now: () => 1 },
      logger: noopLogger,
    })
    const job = sampleJob({ targets: [{ lang: 'fr' }], difficulty: 'normal' })
    job.options.budgetUsd = 0.025
    const events = await collect(engine.run(job))
    const failed = events.find((e) => e.type === 'target-failed')
    expect(failed?.type === 'target-failed' ? failed.error : '').toContain('Budget')
  })
})
