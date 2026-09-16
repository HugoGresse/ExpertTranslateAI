/** Fakes and fixtures shared by every workspace's tests; import from `@experttranslate/core/testing`. */
import type { LlmPort } from './ports.ts'
import type { ChatChunk, ChatRequest, ModelInfo, TranslationJob, Usage } from './types.ts'

export { createMemoryStorage, memoryRepo } from './storage/memory.ts'

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
      for (const piece of text.split(' ')) yield { type: 'delta', text: `${piece} ` }
      yield { type: 'usage', usage }
    },
    models: (): Promise<ModelInfo[]> => Promise.resolve([]),
    keyInfo: () =>
      Promise.resolve({ label: 'fake', limitUsd: null, usageUsd: 0, isFreeTier: false }),
  }
}

export const sampleJob = (overrides: Partial<TranslationJob> = {}): TranslationJob => ({
  id: 'job-1',
  createdAt: 0,
  sourceText: 'Hello world. Visit https://example.com for {{name}}.',
  sourceLang: 'en',
  targets: [{ lang: 'fr' }, { lang: 'es', region: 'Mexico' }],
  domain: 'general',
  difficulty: 'simple',
  models: {
    translatorA: 'test/model',
    translatorB: 'test/model-b',
    translatorC: 'test/model-c',
    reviewer: 'test/reviewer',
    judge: 'test/judge',
    finalizer: 'test/finalizer',
    scorer: 'test/scorer',
    backTranslator: 'test/back',
    helper: 'test/helper',
  },
  options: {
    preserveFormatting: true,
    maxTokensPerChunk: 1000,
    contextSourceIds: [],
    guidelineSetIds: [],
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
  ...overrides,
})

/** Encodes progress (or any) events the way the server streams them. */
export const progressSse = (events: unknown[]): string =>
  [...events.map((e) => `data: ${JSON.stringify(e)}`), 'data: [DONE]', ''].join('\n\n')
