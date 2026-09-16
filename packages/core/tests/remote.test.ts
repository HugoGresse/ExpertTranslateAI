import { describe, expect, it } from 'vitest'
import { noopLogger } from '../src/ports.ts'
import { createRemoteEngine } from '../src/remote/client.ts'
import { collectMaterials, isRemoteJobRequest } from '../src/remote/protocol.ts'
import type { ProgressEvent } from '../src/types.ts'
import { createMemoryStorage, sampleJob } from './fakes.ts'

const sse = (events: unknown[]): string =>
  [...events.map((e) => `data: ${JSON.stringify(e)}`), 'data: [DONE]', ''].join('\n\n')

const streamOf = (text: string): ReadableStream<Uint8Array> =>
  new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text))
      controller.close()
    },
  })

describe('remote engine client', () => {
  it('posts the job with its materials, relays events and mirrors results locally', async () => {
    const storage = createMemoryStorage()
    await storage.guidelines.put({ id: 'g1', name: 'x', rules: [], enabled: true, createdAt: 0 })
    await storage.guidelines.put({ id: 'g2', name: 'y', rules: [], enabled: true, createdAt: 0 })
    const job = sampleJob({ targets: [{ lang: 'fr' }] })
    job.options.guidelineSetIds = ['g1']
    const result = {
      jobId: job.id,
      lang: 'fr',
      targetKey: 'fr',
      finalText: 'Bonjour',
      cost: { usd: 0, calls: 1, tokensIn: 1, tokensOut: 1 },
      score: null,
      trace: [],
      chunks: [],
      candidates: [],
      reviews: [],
      judgments: [],
      guidelineReport: [],
      terminologyReport: [],
      memoryHits: [],
      disagreements: [],
      escalations: [],
      backTranslation: null,
      placeholders: {},
      brief: null,
      plan: { difficulty: 'simple', translators: ['translatorA'] },
      sourceText: job.sourceText,
      sourceLang: 'en',
      status: 'done',
    }
    const events: ProgressEvent[] = [
      { type: 'job-started', jobId: job.id, targets: job.targets },
      { type: 'target-done', lang: 'fr', targetKey: 'fr', result: result as never },
      { type: 'job-done', jobId: job.id, cost: { usd: 0, calls: 1, tokensIn: 1, tokensOut: 1 } },
    ]
    const calls: Array<{ url: string; init: RequestInit }> = []
    const fakeFetch: typeof fetch = (url, init) => {
      calls.push({ url: String(url), init: init ?? {} })
      return Promise.resolve(
        new Response(streamOf(sse(events)), {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        }),
      )
    }
    const engine = createRemoteEngine({
      baseUrl: 'http://srv/',
      token: 't0k',
      fetch: fakeFetch,
      storage,
      clock: { now: () => 5 },
      logger: noopLogger,
      local: {
        estimate: () => ({
          sourceTokens: 0,
          contextTokens: 0,
          chunkCount: 1,
          callCount: 1,
          estimatedUsd: null,
          difficulty: 'simple',
        }),
      },
    })
    const seen: string[] = []
    for await (const e of engine.run(job)) seen.push(e.type)
    expect(seen).toEqual(['job-started', 'target-done', 'job-done'])
    const first = calls[0]
    expect(first?.url).toBe('http://srv/api/jobs')
    const sent = (first?.init.headers ?? {}) as Record<string, string>
    expect(sent.Authorization).toBe('Bearer t0k')
    const body = JSON.parse(String(first?.init.body)) as {
      materials: { guidelines: Array<{ id: string }> }
    }
    expect(body.materials.guidelines.map((g) => g.id)).toEqual(['g1'])
    expect(isRemoteJobRequest(body)).toBe(true)
    expect((await storage.results.get(job.id, 'fr'))?.finalText).toBe('Bonjour')
    expect((await storage.jobs.get(job.id))?.status).toBe('done')
    expect(await storage.evals.list()).toHaveLength(1)
  })

  it('marks the job failed on an HTTP error', async () => {
    const storage = createMemoryStorage()
    const engine = createRemoteEngine({
      baseUrl: 'http://srv',
      fetch: () => Promise.resolve(new Response('nope', { status: 401 })),
      storage,
      clock: { now: () => 5 },
      logger: noopLogger,
      local: {
        estimate: () => ({
          sourceTokens: 0,
          contextTokens: 0,
          chunkCount: 1,
          callCount: 1,
          estimatedUsd: null,
          difficulty: 'simple',
        }),
      },
    })
    const job = sampleJob()
    await expect(async () => {
      for await (const _ of engine.run(job)) void _
    }).rejects.toThrow('Server 401')
    expect((await storage.jobs.get(job.id))?.status).toBe('failed')
  })

  it('collects glossary and memory only when the job uses them', async () => {
    const storage = createMemoryStorage()
    await storage.tm.put({
      id: 't',
      sourceLang: 'en',
      targetLang: 'fr',
      source: 'a',
      target: 'b',
      origin: 'human-correction',
      createdAt: 0,
    })
    const job = sampleJob()
    expect((await collectMaterials(storage, job)).tm).toEqual([])
    job.options.useMemory = true
    expect((await collectMaterials(storage, job)).tm).toHaveLength(1)
  })
})
