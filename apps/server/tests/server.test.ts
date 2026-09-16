import { mkdtemp, rm } from 'node:fs/promises'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  type ChatChunk,
  type ChatRequest,
  createRemoteEngine,
  type LlmPort,
  noopLogger,
  type RemoteJobRequest,
  type StoragePort,
} from '@experttranslate/core'
import { createFakeLlm, createMemoryStorage, sampleJob } from '@experttranslate/core/testing'
import { createJsonStorage } from '@experttranslate/node'
import { afterEach, describe, expect, it } from 'vitest'
import { configFromEnv } from '../src/config.ts'
import { createEtaServer, type ServerDeps } from '../src/server.ts'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c()
})

interface Booted {
  base: string
  storage: StoragePort
  dir: string
}

async function boot(
  llm: LlmPort,
  overrides: Partial<ServerDeps['config']> = {},
  storage?: StoragePort,
): Promise<Booted> {
  const dir = await mkdtemp(join(tmpdir(), 'eta-srv-'))
  const store = storage ?? createJsonStorage(dir, noopLogger)
  const eta = createEtaServer({
    config: {
      token: 'secret',
      allowedOrigins: ['https://app.test'],
      persistJobs: false,
      maxBudgetUsd: 5,
      maxSourceChars: 1000,
      maxJobs: 2,
      allowedModels: [],
      ...overrides,
    },
    llm,
    storage: store,
    logger: noopLogger,
    now: () => 1,
  })
  await new Promise<void>((resolve) => eta.server.listen(0, '127.0.0.1', resolve))
  cleanups.push(async () => {
    await eta.shutdown()
    await rm(dir, { recursive: true, force: true })
  })
  return {
    base: `http://127.0.0.1:${(eta.server.address() as AddressInfo).port}`,
    storage: store,
    dir,
  }
}

const auth = { authorization: 'Bearer secret', 'content-type': 'application/json' }

const isCondense = (req: ChatRequest): boolean =>
  (req.messages[0]?.content ?? '').includes('Condense the provided document')

const request = (overrides: Partial<RemoteJobRequest['job']> = {}): RemoteJobRequest => ({
  job: sampleJob({ targets: [{ lang: 'fr' }], sourceText: 'Hello', ...overrides }),
  materials: { contexts: [], guidelines: [], glossaryScopes: [], glossaryEntries: [], tm: [] },
})

const post = (base: string, body: unknown): Promise<Response> =>
  fetch(`${base}/api/jobs`, { method: 'POST', headers: auth, body: JSON.stringify(body) })

describe('eta server', () => {
  it('answers health without auth, rejects the rest without the token, applies CORS per origin', async () => {
    const { base } = await boot(createFakeLlm(() => 'x'))
    const health = (await (await fetch(`${base}/api/health`)).json()) as {
      ok: boolean
      maxJobs: number
    }
    expect(health.ok).toBe(true)
    expect(health.maxJobs).toBe(2)
    expect((await fetch(`${base}/api/models`)).status).toBe(401)
    expect((await fetch(`${base}/api/nope`, { headers: auth })).status).toBe(404)
    const ok = await fetch(`${base}/api/health`, {
      method: 'OPTIONS',
      headers: { origin: 'https://app.test' },
    })
    expect(ok.status).toBe(204)
    expect(ok.headers.get('access-control-allow-origin')).toBe('https://app.test')
    expect(
      (
        await fetch(`${base}/api/health`, {
          method: 'OPTIONS',
          headers: { origin: 'https://evil.test' },
        })
      ).status,
    ).toBe(403)
  })

  it('runs a job with inline materials, streams tokens, persists nothing, and reuses digests', async () => {
    const llm = createFakeLlm((req) => (isCondense(req) ? 'DIGEST' : 'Bonjour'))
    const { base, storage } = await boot(llm)
    const body = request()
    body.job.options.guidelineSetIds = ['g1']
    body.job.options.contextSourceIds = ['c1']
    body.job.options.contextTokenBudget = 5
    body.materials.guidelines = [
      { id: 'g1', name: 'Style', rules: [], freeText: 'Use vous.', enabled: true, createdAt: 0 },
    ]
    body.materials.contexts = [
      {
        id: 'c1',
        name: 'big',
        kind: 'pasted',
        rawText: 'word '.repeat(200),
        contentHash: 'h1',
        enabled: true,
        createdAt: 0,
      },
    ]
    const res = await post(base, body)
    expect(res.headers.get('content-type')).toBe('text/event-stream')
    const text = await res.text()
    expect(text).toContain('"type":"job-started"')
    expect(text).toContain('"type":"token"')
    expect(text).toContain('"type":"target-done"')
    expect(text.trim().endsWith('data: [DONE]')).toBe(true)
    const translate = llm.calls.filter((c) => !isCondense(c.request))
    expect(translate.at(-1)?.request.messages[0]?.content).toContain('Use vous.')
    expect(await storage.results.listByJob(body.job.id)).toEqual([])
    expect(await storage.guidelines.list()).toEqual([])
    expect(await storage.contexts.list()).toEqual([])
    const condenseCalls = () => llm.calls.filter((c) => isCondense(c.request)).length
    expect(condenseCalls()).toBe(1)
    await (await post(base, { ...body, job: { ...body.job, id: 'job-2' } })).text()
    expect(condenseCalls()).toBe(1)
  })

  it('is understood end to end by the core remote client', async () => {
    const { base } = await boot(createFakeLlm(() => 'Bonjour'))
    const local = createMemoryStorage()
    const client = createRemoteEngine({
      baseUrl: base,
      token: 'secret',
      storage: local,
      clock: { now: () => 2 },
      logger: noopLogger,
    })
    const types: string[] = []
    for await (const e of client.run(request({ id: 'job-2' }).job)) types.push(e.type)
    expect(types).toEqual([
      'job-started',
      'target-started',
      'stage-started',
      'token',
      'stage-done',
      'target-done',
      'job-done',
    ])
    expect((await local.results.get('job-2', 'fr'))?.finalText).toBe('Bonjour')
    expect((await client.health()).ok).toBe(true)
  })

  it('enforces its own limits: schema, source size, budget, model allow-list and job count', async () => {
    const slow: LlmPort = {
      async *chat(_req: ChatRequest, opts): AsyncIterable<ChatChunk> {
        await new Promise<void>((resolve) => {
          const t = setTimeout(resolve, 2_000)
          opts?.signal?.addEventListener('abort', () => {
            clearTimeout(t)
            resolve()
          })
        })
        yield { type: 'delta', text: 'late' }
      },
      models: () => Promise.resolve([]),
      keyInfo: () => Promise.reject(new Error('no')),
    }
    const { base } = await boot(slow, {
      maxJobs: 1,
      allowedModels: [
        'test/model',
        'test/model-b',
        'test/model-c',
        'test/reviewer',
        'test/judge',
        'test/finalizer',
        'test/scorer',
        'test/back',
        'test/helper',
      ],
    })
    const bad = await post(base, { job: { id: 'x' }, materials: {} })
    expect(bad.status).toBe(400)
    expect(((await bad.json()) as { issues: string[] }).issues.length).toBeGreaterThan(0)
    expect((await post(base, request({ sourceText: 'x'.repeat(2000) }))).status).toBe(413)
    const model = request()
    model.job.models.translatorA = 'openai/o3'
    expect((await post(base, model)).status).toBe(400)
    const first = fetch(`${base}/api/jobs`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify(request({ id: 'slow-1' })),
    })
    await new Promise((r) => setTimeout(r, 100))
    expect((await post(base, request({ id: 'slow-2' }))).status).toBe(429)
    await (await first).text()
  })

  it('aborts the engine when the client disconnects and reports failures as an error frame', async () => {
    let aborted = false
    const slow: LlmPort = {
      async *chat(_req: ChatRequest, opts): AsyncIterable<ChatChunk> {
        await new Promise<void>((resolve) => {
          opts?.signal?.addEventListener('abort', () => {
            aborted = true
            resolve()
          })
        })
        throw new DOMException('Aborted', 'AbortError')
      },
      models: () => Promise.resolve([]),
      keyInfo: () => Promise.reject(new Error('no')),
    }
    const { base } = await boot(slow)
    const controller = new AbortController()
    const pending = fetch(`${base}/api/jobs`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify(request()),
      signal: controller.signal,
    })
    const res = await pending
    await res.body?.getReader().read()
    controller.abort()
    await new Promise((r) => setTimeout(r, 200))
    expect(aborted).toBe(true)

    const broken = createMemoryStorage()
    broken.jobs.put = () => Promise.reject(new Error('disk full'))
    const { base: base2 } = await boot(
      createFakeLlm(() => 'x'),
      { persistJobs: true },
      broken,
    )
    const text = await (await post(base2, request())).text()
    expect(text).toContain('"type":"error"')
    expect(text).toContain('disk full')
    expect(text).not.toContain('[DONE]')
  })
})

describe('config', () => {
  it('refuses to run open without opt-in, reads limits, and treats a blank PORT as unset', () => {
    expect(() => configFromEnv({ OPENROUTER_API_KEY: 'k' })).toThrow('ETA_SERVER_TOKEN')
    expect(configFromEnv({ OPENROUTER_API_KEY: 'k', ETA_ALLOW_ANONYMOUS: 'true' }).token).toBe('')
    const c = configFromEnv({
      OPENROUTER_API_KEY: 'k',
      ETA_SERVER_TOKEN: 't',
      ETA_ALLOWED_ORIGINS: 'a, b',
      PORT: '',
      ETA_PORT: '9000',
      ETA_MAX_BUDGET_USD: 'none',
      ETA_MAX_JOBS: '8',
    })
    expect(c.allowedOrigins).toEqual(['a', 'b'])
    expect(c.port).toBe(9000)
    expect(c.maxBudgetUsd).toBeNull()
    expect(c.maxJobs).toBe(8)
    expect(configFromEnv({ OPENROUTER_API_KEY: 'k', ETA_SERVER_TOKEN: 't' }).maxBudgetUsd).toBe(5)
    expect(() =>
      configFromEnv({ OPENROUTER_API_KEY: 'k', ETA_SERVER_TOKEN: 't', PORT: '0' }),
    ).toThrow('PORT')
    expect(() => configFromEnv({})).toThrow('OPENROUTER_API_KEY')
  })
})
