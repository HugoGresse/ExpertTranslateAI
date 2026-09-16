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
  type TranslationJob,
} from '@experttranslate/core'
import { createJsonStorage } from '@experttranslate/node'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { configFromEnv } from '../src/config.ts'
import { createEtaServer } from '../src/server.ts'

let dir: string
let close: () => Promise<void>
let base: string
const requests: ChatRequest[] = []

const llm: LlmPort = {
  async *chat(req): AsyncIterable<ChatChunk> {
    requests.push(req)
    await Promise.resolve()
    yield { type: 'delta', text: 'Bonjour' }
    yield { type: 'usage', usage: { promptTokens: 1, completionTokens: 1, costUsd: 0.001 } }
  },
  models: () => Promise.resolve([]),
  keyInfo: () => Promise.resolve({ label: 'srv', limitUsd: null, usageUsd: 0, isFreeTier: false }),
}

const job = (): TranslationJob => ({
  id: 'job-1',
  createdAt: 0,
  sourceText: 'Hello',
  sourceLang: 'en',
  targets: [{ lang: 'fr' }],
  domain: 'general',
  difficulty: 'simple',
  models: {
    translatorA: 'm',
    translatorB: 'm',
    translatorC: 'm',
    reviewer: 'm',
    judge: 'm',
    finalizer: 'm',
    scorer: 'm',
    backTranslator: 'm',
    helper: 'm',
  },
  options: {
    preserveFormatting: true,
    maxTokensPerChunk: 1000,
    contextSourceIds: [],
    guidelineSetIds: ['g1'],
    contextTokenBudget: 4000,
    guidelinesTokenBudget: 1500,
    budgetUsd: null,
    reasoningEffort: 'low',
    glossaryScopeIds: [],
    useMemory: false,
    autoEscalate: false,
    escalationConfidence: 60,
    routing: [],
    backTranslate: false,
    promptOverrides: {},
  },
  status: 'queued',
})

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'eta-srv-'))
  requests.length = 0
  const server = createEtaServer({
    config: { token: 'secret', allowedOrigins: ['https://app.test'], concurrency: 2 },
    llm,
    storage: createJsonStorage(dir, noopLogger),
    logger: noopLogger,
    now: () => 1,
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  close = () => new Promise((resolve) => server.close(() => resolve()))
})
afterEach(async () => {
  await close()
  await rm(dir, { recursive: true, force: true })
})

describe('eta server', () => {
  it('answers health without auth and rejects the rest without the token', async () => {
    expect((await (await fetch(`${base}/api/health`)).json()).ok).toBe(true)
    expect((await fetch(`${base}/api/models`)).status).toBe(401)
    expect(
      (await fetch(`${base}/api/nope`, { headers: { authorization: 'Bearer secret' } })).status,
    ).toBe(404)
  })

  it('applies CORS only for allowed origins', async () => {
    const ok = await fetch(`${base}/api/health`, {
      method: 'OPTIONS',
      headers: { origin: 'https://app.test' },
    })
    expect(ok.status).toBe(204)
    expect(ok.headers.get('access-control-allow-origin')).toBe('https://app.test')
    const no = await fetch(`${base}/api/health`, {
      method: 'OPTIONS',
      headers: { origin: 'https://evil.test' },
    })
    expect(no.status).toBe(403)
  })

  it('runs a job with inline materials and streams progress that the core client understands', async () => {
    const body: RemoteJobRequest = {
      job: job(),
      materials: {
        contexts: [],
        guidelines: [
          {
            id: 'g1',
            name: 'Style',
            rules: [],
            freeText: 'Use vous.',
            enabled: true,
            createdAt: 0,
          },
        ],
        glossaryScopes: [],
        glossaryEntries: [],
        tm: [],
      },
    }
    const res = await fetch(`${base}/api/jobs`, {
      method: 'POST',
      headers: { authorization: 'Bearer secret', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    expect(res.headers.get('content-type')).toBe('text/event-stream')
    const text = await res.text()
    expect(text).toContain('"type":"job-started"')
    expect(text).toContain('"type":"target-done"')
    expect(text.trim().endsWith('data: [DONE]')).toBe(true)
    expect(requests[0]?.messages[0]?.content).toContain('Use vous.')
    const stored = createJsonStorage(dir, noopLogger)
    expect((await stored.results.get('job-1', 'fr'))?.finalText).toBe('Bonjour')
    expect(await stored.guidelines.list()).toEqual([])

    const local = createJsonStorage(await mkdtemp(join(tmpdir(), 'eta-local-')), noopLogger)
    await local.guidelines.put(body.materials.guidelines[0] as never)
    const client = createRemoteEngine({
      baseUrl: base,
      token: 'secret',
      storage: local,
      clock: { now: () => 2 },
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
    const types: string[] = []
    for await (const e of client.run({ ...job(), id: 'job-2' })) types.push(e.type)
    expect(types).toEqual([
      'job-started',
      'target-started',
      'stage-started',
      'stage-done',
      'target-done',
      'job-done',
    ])
    expect((await local.results.get('job-2', 'fr'))?.finalText).toBe('Bonjour')
    expect((await client.health()).ok).toBe(true)
  })

  it('rejects malformed jobs', async () => {
    const res = await fetch(`${base}/api/jobs`, {
      method: 'POST',
      headers: { authorization: 'Bearer secret', 'content-type': 'application/json' },
      body: JSON.stringify({ job: { id: 'x' } }),
    })
    expect(res.status).toBe(400)
  })
})

describe('config', () => {
  it('refuses to run open without an explicit opt-in', () => {
    expect(() => configFromEnv({ OPENROUTER_API_KEY: 'k' })).toThrow('ETA_SERVER_TOKEN')
    expect(configFromEnv({ OPENROUTER_API_KEY: 'k', ETA_ALLOW_ANONYMOUS: 'true' }).token).toBe('')
    expect(
      configFromEnv({ OPENROUTER_API_KEY: 'k', ETA_SERVER_TOKEN: 't', ETA_ALLOWED_ORIGINS: 'a, b' })
        .allowedOrigins,
    ).toEqual(['a', 'b'])
    expect(() => configFromEnv({})).toThrow('OPENROUTER_API_KEY')
  })
})
