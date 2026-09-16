import type { LlmPort, LoggerPort } from '../ports.ts'
import { noopLogger } from '../ports.ts'
import type { ChatChunk, ChatRequest, KeyInfo, ModelInfo, Usage } from '../types.ts'
import { createLimiter, type Limiter } from './limiter.ts'
import {
  defaultRetryOptions,
  LlmHttpError,
  parseRetryAfter,
  withRetry,
  type RetryOptions,
} from './retry.ts'
import { readSseData } from './sse.ts'

export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'

export interface OpenRouterLlmOptions {
  apiKey: string
  fetch?: typeof fetch
  baseUrl?: string
  referer?: string
  title?: string
  concurrency?: number
  retry?: RetryOptions
  logger?: LoggerPort
}

interface RawUsage {
  prompt_tokens?: number
  completion_tokens?: number
  cost?: number
}

interface RawStreamChunk {
  choices?: Array<{ delta?: { content?: string | null } }>
  usage?: RawUsage | null
  error?: { message?: string }
}

interface RawModel {
  id: string
  name?: string
  context_length?: number
  pricing?: { prompt?: string; completion?: string }
  supported_parameters?: string[]
}

interface RawKey {
  data?: { label?: string; limit?: number | null; usage?: number; is_free_tier?: boolean }
}

const toUsage = (raw: RawUsage | null | undefined): Usage => ({
  promptTokens: raw?.prompt_tokens ?? 0,
  completionTokens: raw?.completion_tokens ?? 0,
  costUsd: typeof raw?.cost === 'number' ? raw.cost : null,
})

export function toModelInfo(raw: RawModel): ModelInfo {
  return {
    id: raw.id,
    name: raw.name ?? raw.id,
    contextLength: raw.context_length ?? 0,
    pricing: {
      promptUsdPerToken: Number(raw.pricing?.prompt ?? 0),
      completionUsdPerToken: Number(raw.pricing?.completion ?? 0),
    },
    supportsStructuredOutput: (raw.supported_parameters ?? []).includes('response_format'),
  }
}

function buildBody(req: ChatRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: req.model,
    messages: req.messages,
    stream: true,
    usage: { include: true },
  }
  if (req.temperature !== undefined) body.temperature = req.temperature
  if (req.maxTokens !== undefined) body.max_tokens = req.maxTokens
  if (req.responseFormat?.type === 'json_object') body.response_format = { type: 'json_object' }
  if (req.responseFormat?.type === 'json_schema') {
    body.response_format = { type: 'json_schema', json_schema: req.responseFormat.jsonSchema }
  }
  return body
}

export function createOpenRouterLlm(options: OpenRouterLlmOptions): LlmPort {
  const fetchImpl = options.fetch ?? globalThis.fetch
  const baseUrl = options.baseUrl ?? OPENROUTER_BASE_URL
  const retry = options.retry ?? defaultRetryOptions
  const logger = options.logger ?? noopLogger
  const limiter: Limiter = createLimiter(options.concurrency ?? 4)

  const headers = (): Record<string, string> => {
    const h: Record<string, string> = {
      Authorization: `Bearer ${options.apiKey}`,
      'Content-Type': 'application/json',
    }
    if (options.referer) h['HTTP-Referer'] = options.referer
    if (options.title) h['X-OpenRouter-Title'] = options.title
    return h
  }

  const request = async (path: string, init: RequestInit): Promise<Response> => {
    const res = await fetchImpl(`${baseUrl}${path}`, {
      ...init,
      headers: { ...headers(), ...(init.headers ?? {}) },
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new LlmHttpError(res.status, text, parseRetryAfter(res.headers.get('retry-after')))
    }
    return res
  }

  return {
    async *chat(req, opts) {
      const signal = opts?.signal
      const started = Date.now()
      logger.debug('openrouter.chat.start', { model: req.model, messages: req.messages.length })
      const res = await limiter.run(() =>
        withRetry((attempt) => {
          if (attempt > 0) logger.warn('openrouter.chat.retry', { model: req.model, attempt })
          return request('/chat/completions', {
            method: 'POST',
            body: JSON.stringify(buildBody(req)),
            ...(signal ? { signal } : {}),
          })
        }, retry),
      )
      if (!res.body) throw new Error('OpenRouter response has no body')
      let usage: Usage | null = null
      for await (const data of readSseData(res.body, signal)) {
        let parsed: RawStreamChunk
        try {
          parsed = JSON.parse(data) as RawStreamChunk
        } catch {
          logger.warn('openrouter.chat.badChunk', { data: data.slice(0, 120) })
          continue
        }
        if (parsed.error)
          throw new Error(`OpenRouter stream error: ${parsed.error.message ?? 'unknown'}`)
        const text = parsed.choices?.[0]?.delta?.content
        if (text) yield { type: 'delta', text } satisfies ChatChunk
        if (parsed.usage) usage = toUsage(parsed.usage)
      }
      const finalUsage = usage ?? toUsage(null)
      logger.debug('openrouter.chat.done', {
        model: req.model,
        latencyMs: Date.now() - started,
        ...finalUsage,
      })
      yield { type: 'usage', usage: finalUsage }
    },

    async models() {
      const res = await request('/models', { method: 'GET' })
      const json = (await res.json()) as { data?: RawModel[] }
      const models = (json.data ?? []).map(toModelInfo)
      logger.debug('openrouter.models', { count: models.length })
      return models
    },

    async keyInfo(): Promise<KeyInfo> {
      const res = await request('/auth/key', { method: 'GET' })
      const json = (await res.json()) as RawKey
      return {
        label: json.data?.label ?? '',
        limitUsd: json.data?.limit ?? null,
        usageUsd: json.data?.usage ?? 0,
        isFreeTier: json.data?.is_free_tier ?? false,
      }
    },
  }
}
