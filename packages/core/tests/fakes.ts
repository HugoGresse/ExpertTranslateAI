import type { LlmPort, Repo, ResultRepo, StoragePort } from '../src/ports.ts'
import type {
  ChatChunk,
  ChatRequest,
  ModelInfo,
  TargetResult,
  TranslationJob,
  Usage,
} from '../src/types.ts'

export interface FakeCall {
  request: ChatRequest
}

export function createFakeLlm(
  reply: (req: ChatRequest) => string,
  usage: Usage = { promptTokens: 10, completionTokens: 5, costUsd: 0.001 },
): LlmPort & { calls: FakeCall[] } {
  const calls: FakeCall[] = []
  return {
    calls,
    async *chat(req): AsyncIterable<ChatChunk> {
      calls.push({ request: req })
      await Promise.resolve()
      const text = reply(req)
      for (const piece of text.split(' ')) yield { type: 'delta', text: piece + ' ' }
      yield { type: 'usage', usage }
    },
    models: (): Promise<ModelInfo[]> => Promise.resolve([]),
    keyInfo: () =>
      Promise.resolve({ label: 'fake', limitUsd: null, usageUsd: 0, isFreeTier: false }),
  }
}

function memoryRepo<T extends { id: string }>(): Repo<T> {
  const map = new Map<string, T>()
  return {
    get: (id) => Promise.resolve(map.get(id)),
    put: (item) => {
      map.set(item.id, item)
      return Promise.resolve()
    },
    list: () => Promise.resolve([...map.values()]),
    delete: (id) => {
      map.delete(id)
      return Promise.resolve()
    },
  }
}

function memoryResults(): ResultRepo {
  const map = new Map<string, TargetResult>()
  const key = (jobId: string, lang: string): string => `${jobId}:${lang}`
  return {
    get: (jobId, lang) => Promise.resolve(map.get(key(jobId, lang))),
    put: (r) => {
      map.set(key(r.jobId, r.lang), r)
      return Promise.resolve()
    },
    listByJob: (jobId) => Promise.resolve([...map.values()].filter((r) => r.jobId === jobId)),
    deleteByJob: (jobId) => {
      for (const k of [...map.keys()]) if (k.startsWith(`${jobId}:`)) map.delete(k)
      return Promise.resolve()
    },
  }
}

export const createMemoryStorage = (): StoragePort => ({
  jobs: memoryRepo<TranslationJob>(),
  results: memoryResults(),
})

export const sampleJob = (overrides: Partial<TranslationJob> = {}): TranslationJob => ({
  id: 'job-1',
  createdAt: 0,
  sourceText: 'Hello world. Visit https://example.com for {{name}}.',
  sourceLang: 'en',
  targets: [{ lang: 'fr' }, { lang: 'es', region: 'Mexico' }],
  domain: 'general',
  difficulty: 'simple',
  models: { translatorA: 'test/model' },
  options: { preserveFormatting: true, maxTokensPerChunk: 1000 },
  status: 'queued',
  ...overrides,
})
