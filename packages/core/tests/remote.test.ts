import { describe, expect, it } from 'vitest'
import { noopLogger } from '../src/ports.ts'
import { createRemoteEngine } from '../src/remote/client.ts'
import { collectMaterials, parseRemoteJobRequest } from '../src/remote/protocol.ts'
import type { ProgressEvent, TargetResult } from '../src/types.ts'
import { createMemoryStorage, progressSse, sampleJob } from './fakes.ts'

const streamOf = (text: string): ReadableStream<Uint8Array> =>
  new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text))
      controller.close()
    },
  })

const sseResponse = (body: string): Response =>
  new Response(streamOf(body), { status: 200, headers: { 'content-type': 'text/event-stream' } })

const resultFor = (jobId: string): TargetResult => ({
  jobId,
  lang: 'fr',
  targetKey: 'fr',
  sourceText: 'Hello',
  sourceLang: 'en',
  chunks: [],
  placeholders: {},
  candidates: [],
  finalText: 'Bonjour',
  brief: null,
  plan: { difficulty: 'simple', translators: ['translatorA'] },
  models: { ...sampleJob().models, translatorA: 'routed/model' },
  reviews: [],
  judgments: [],
  score: null,
  guidelineReport: [],
  terminologyReport: [],
  memoryHits: [],
  disagreements: [],
  escalations: [],
  backTranslation: null,
  glossarySuggestions: [],
  cost: { usd: 0, calls: 1, tokensIn: 1, tokensOut: 1 },
  trace: [],
  status: 'done',
})

const engineWith = (fetchImpl: typeof fetch, storage = createMemoryStorage()) =>
  createRemoteEngine({
    baseUrl: 'http://srv/',
    token: 't0k',
    fetch: fetchImpl,
    storage,
    clock: { now: () => 5 },
    logger: noopLogger,
  })

const drain = async (iterable: AsyncIterable<ProgressEvent>): Promise<string[]> => {
  const out: string[] = []
  for await (const e of iterable) out.push(e.type)
  return out
}

describe('remote engine client', () => {
  it('posts the job with its materials, relays events and mirrors results with routed models', async () => {
    const storage = createMemoryStorage()
    await storage.guidelines.put({ id: 'g1', name: 'x', rules: [], enabled: true, createdAt: 0 })
    await storage.guidelines.put({ id: 'g2', name: 'y', rules: [], enabled: true, createdAt: 0 })
    const job = sampleJob({ targets: [{ lang: 'fr' }] })
    job.options.guidelineSetIds = ['g1']
    const events: ProgressEvent[] = [
      { type: 'job-started', jobId: job.id, targets: job.targets },
      { type: 'target-done', lang: 'fr', targetKey: 'fr', result: resultFor(job.id) },
      { type: 'job-done', jobId: job.id, cost: { usd: 0, calls: 1, tokensIn: 1, tokensOut: 1 } },
    ]
    const calls: Array<{ url: string; init: RequestInit }> = []
    const engine = engineWith((url, init) => {
      calls.push({ url: String(url), init: init ?? {} })
      return Promise.resolve(sseResponse(progressSse(events)))
    }, storage)
    expect(await drain(engine.run(job))).toEqual(['job-started', 'target-done', 'job-done'])
    const first = calls[0]
    expect(first?.url).toBe('http://srv/api/jobs')
    const sent = (first?.init.headers ?? {}) as Record<string, string>
    expect(sent.Authorization).toBe('Bearer t0k')
    const body: unknown = JSON.parse(String(first?.init.body))
    const parsed = parseRemoteJobRequest(body)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.value.materials.guidelines.map((g) => g.id)).toEqual(['g1'])
    expect((await storage.results.get(job.id, 'fr'))?.finalText).toBe('Bonjour')
    expect((await storage.jobs.get(job.id))?.status).toBe('done')
    expect((await storage.evals.list())[0]?.models.translatorA).toBe('routed/model')
  })

  it('marks the job failed on an HTTP error, an error frame, or a stream that ends early', async () => {
    const storage = createMemoryStorage()
    const job = sampleJob()
    const http = engineWith(() => Promise.resolve(new Response('nope', { status: 401 })), storage)
    await expect(drain(http.run(job))).rejects.toThrow('Server 401')
    expect((await storage.jobs.get(job.id))?.status).toBe('failed')

    const frame = engineWith(
      () =>
        Promise.resolve(
          sseResponse(
            progressSse([
              { type: 'job-started', jobId: job.id, targets: job.targets },
              { type: 'error', message: 'disk full' },
            ]),
          ),
        ),
      storage,
    )
    await expect(drain(frame.run(job))).rejects.toThrow('disk full')

    const truncated = engineWith(
      () =>
        Promise.resolve(
          sseResponse(
            `data: ${JSON.stringify({ type: 'job-started', jobId: job.id, targets: [] })}\n\n`,
          ),
        ),
      storage,
    )
    await expect(drain(truncated.run(job))).rejects.toThrow('before the job finished')
  })

  it('probes health without the token', async () => {
    const seen: Array<Record<string, string>> = []
    const engine = engineWith((_url, init) => {
      seen.push((init?.headers ?? {}) as Record<string, string>)
      return Promise.resolve(
        Response.json({ ok: true, version: '1', maxJobs: 2, maxBudgetUsd: null }),
      )
    })
    expect(await engine.health()).toEqual({
      ok: true,
      version: '1',
      maxJobs: 2,
      maxBudgetUsd: null,
    })
    expect(seen[0]?.Authorization).toBeUndefined()
  })
})

describe('collectMaterials', () => {
  it('ships only referenced ids, active scopes, target-language entries and matching memory', async () => {
    const storage = createMemoryStorage()
    await storage.contexts.put({
      id: 'c1',
      name: 'c',
      kind: 'pasted',
      rawText: 'x',
      contentHash: 'h',
      enabled: true,
      createdAt: 0,
    })
    await storage.contexts.put({
      id: 'c2',
      name: 'd',
      kind: 'pasted',
      rawText: 'y',
      contentHash: 'i',
      enabled: true,
      createdAt: 0,
    })
    await storage.glossaryScopes.put({ id: 'global', level: 'global', name: 'G', createdAt: 0 })
    await storage.glossaryScopes.put({
      id: 'proj',
      level: 'project',
      name: 'P',
      parentId: 'global',
      createdAt: 0,
    })
    await storage.glossaryScopes.put({ id: 'other', level: 'project', name: 'O', createdAt: 0 })
    const entry = (
      id: string,
      scopeId: string,
      lang: string,
      kind: 'preferred' | 'doNotTranslate' = 'preferred',
    ) => ({
      id,
      scopeId,
      source: 's',
      target: 't',
      lang,
      kind,
      caseSensitive: false,
      createdAt: 0,
    })
    await storage.glossaryEntries.put(entry('e-fr', 'proj', 'fr'))
    await storage.glossaryEntries.put(entry('e-de', 'global', 'de'))
    await storage.glossaryEntries.put(entry('e-keep', 'global', 'xx', 'doNotTranslate'))
    await storage.glossaryEntries.put(entry('e-other', 'other', 'fr'))
    const tm = (id: string, sourceLang: string, targetLang: string) => ({
      id,
      sourceLang,
      targetLang,
      source: 'a',
      target: 'b',
      origin: 'human-correction' as const,
      createdAt: 0,
    })
    await storage.tm.put(tm('t1', 'en', 'fr'))
    await storage.tm.put(tm('t2', 'de', 'fr'))
    await storage.tm.put(tm('t3', 'en', 'es'))
    const job = sampleJob({ targets: [{ lang: 'fr' }], sourceLang: 'en' })
    job.options.contextSourceIds = ['c2', 'missing']
    job.options.glossaryScopeIds = ['proj']
    job.options.useMemory = true
    const m = await collectMaterials(storage, job)
    expect(m.contexts.map((c) => c.id)).toEqual(['c2'])
    expect(m.glossaryScopes.map((s) => s.id).sort()).toEqual(['global', 'proj'])
    expect(m.glossaryEntries.map((e) => e.id).sort()).toEqual(['e-fr', 'e-keep'])
    expect(m.tm.map((e) => e.id)).toEqual(['t1'])
    job.sourceLang = 'auto'
    expect((await collectMaterials(storage, job)).tm.map((e) => e.id).sort()).toEqual(['t1', 't2'])
  })

  it('rejects malformed requests with field paths', () => {
    const bad = parseRemoteJobRequest({
      job: { ...sampleJob(), options: { ...sampleJob().options, maxTokensPerChunk: 1 } },
      materials: { contexts: [], guidelines: [], glossaryScopes: [], glossaryEntries: [], tm: [] },
    })
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.issues[0]).toContain('job.options.maxTokensPerChunk')
  })
})
