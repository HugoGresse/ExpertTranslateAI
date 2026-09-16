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
