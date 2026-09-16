import type { Engine } from '../engine.ts'
import { readSseData } from '../llm/sse.ts'
import { estimateJob } from '../pipeline/estimate.ts'
import { buildEvalRecord } from '../pipeline/evalRecord.ts'
import type { ClockPort, LoggerPort, StoragePort } from '../ports.ts'
import type { ModelInfo, ProgressEvent, TranslationJob } from '../types.ts'
import { collectMaterials, type RemoteErrorEvent, type RemoteJobRequest } from './protocol.ts'

export interface RemoteEngineOptions {
  baseUrl: string
  token?: string
  fetch?: typeof fetch
  /** Local store that receives results, jobs and evals so history and insights keep working. */
  storage: StoragePort
  clock: ClockPort
  logger: LoggerPort
  idleTimeoutMs?: number
}

export interface ServerHealth {
  ok: boolean
  version?: string
  auth?: boolean
  jobsRunning?: number
  maxJobs?: number
  maxBudgetUsd?: number | null
  maxSourceChars?: number
}

export interface RemoteEngine extends Engine {
  models(): Promise<ModelInfo[]>
  /** Unauthenticated probe; works before a token is configured. */
  health(): Promise<ServerHealth>
}

export class RemoteHttpError extends Error {
  readonly status: number
  constructor(status: number, detail: string) {
    super(`Server ${status}${detail ? `: ${detail}` : ''}`)
    this.name = 'RemoteHttpError'
    this.status = status
  }
}

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null
const isProgressEvent = (x: unknown): x is ProgressEvent =>
  isRecord(x) && typeof x.type === 'string'
const isErrorFrame = (x: unknown): x is RemoteErrorEvent =>
  isRecord(x) && x.type === 'error' && typeof x.message === 'string'
const isModelInfo = (x: unknown): x is ModelInfo =>
  isRecord(x) && typeof x.id === 'string' && typeof x.name === 'string' && isRecord(x.pricing)

interface RequestOptions {
  method?: 'GET' | 'POST'
  body?: string
  signal?: AbortSignal
  auth?: boolean
}

/**
 * Runs jobs on an ExpertTranslateAI server over SSE while keeping the local store in sync.
 * The server holds the OpenRouter key; the browser never needs one.
 */
export function createRemoteEngine(opts: RemoteEngineOptions): RemoteEngine {
  const doFetch = opts.fetch ?? fetch
  const base = opts.baseUrl.replace(/\/+$/, '')

  const request = async (path: string, o: RequestOptions = {}): Promise<Response> => {
    const url = `${base}${path}`
    const headers: Record<string, string> = {}
    if (o.auth !== false && opts.token) headers.Authorization = `Bearer ${opts.token}`
    if (o.body !== undefined) {
      headers['content-type'] = 'application/json'
      headers.accept = 'text/event-stream'
    }
    opts.logger.debug('remote.request', {
      url,
      method: o.method ?? 'GET',
      auth: 'Authorization' in headers,
    })
    const response = await doFetch(url, {
      method: o.method ?? 'GET',
      headers,
      ...(o.body !== undefined ? { body: o.body } : {}),
      ...(o.signal ? { signal: o.signal } : {}),
    })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      opts.logger.warn('remote.httpError', { url, status: response.status })
      throw new RemoteHttpError(response.status, text.slice(0, 200))
    }
    return response
  }

  async function* run(
    job: TranslationJob,
    o?: { signal?: AbortSignal },
  ): AsyncIterable<ProgressEvent> {
    const body: RemoteJobRequest = { job, materials: await collectMaterials(opts.storage, job) }
    await opts.storage.jobs.put({ ...job, status: 'running' })
    let status: TranslationJob['status'] = 'failed'
    let sawTargetFailure = false
    let finished = false
    let events = 0
    try {
      const response = await request('/api/jobs', {
        method: 'POST',
        body: JSON.stringify(body),
        ...(o?.signal ? { signal: o.signal } : {}),
      })
      if (!response.body) throw new Error('Server returned no stream')
      for await (const data of readSseData(response.body, o?.signal, opts.idleTimeoutMs ?? 0)) {
        let parsed: unknown
        try {
          parsed = JSON.parse(data)
        } catch {
          opts.logger.warn('remote.badEvent', { data: data.slice(0, 120) })
          continue
        }
        if (isErrorFrame(parsed)) throw new Error(`Server failed the job: ${parsed.message}`)
        if (!isProgressEvent(parsed)) {
          opts.logger.debug('remote.ignoredEvent', { keys: Object.keys(parsed as object) })
          continue
        }
        events++
        if (parsed.type === 'target-done') {
          await opts.storage.results.put(parsed.result)
          try {
            await opts.storage.evals.put(
              buildEvalRecord(job, parsed.result.models, parsed.result, opts.clock.now()),
            )
          } catch (error) {
            opts.logger.warn('remote.evalPutFailed', { error: String(error) })
          }
        }
        if (parsed.type === 'target-failed') sawTargetFailure = true
        if (parsed.type === 'job-done') {
          finished = true
          status = sawTargetFailure ? 'failed' : 'done'
        }
        yield parsed
      }
      if (!finished && !o?.signal?.aborted)
        throw new Error('The server closed the stream before the job finished')
    } finally {
      if (o?.signal?.aborted) status = 'cancelled'
      opts.logger.debug('remote.streamEnd', { jobId: job.id, status, events, finished })
      await opts.storage.jobs.put({ ...job, status }).catch((error: unknown) => {
        opts.logger.warn('remote.jobPutFailed', { error: String(error) })
      })
    }
  }

  return {
    run,
    estimate: estimateJob,
    models: async () => {
      const list: unknown = await (await request('/api/models')).json()
      return Array.isArray(list) ? list.filter(isModelInfo) : []
    },
    health: async () => {
      const info: unknown = await (await request('/api/health', { auth: false })).json()
      if (!isRecord(info) || typeof info.ok !== 'boolean') return { ok: false }
      const health: ServerHealth = { ok: info.ok }
      if (typeof info.version === 'string') health.version = info.version
      if (typeof info.auth === 'boolean') health.auth = info.auth
      if (typeof info.jobsRunning === 'number') health.jobsRunning = info.jobsRunning
      if (typeof info.maxJobs === 'number') health.maxJobs = info.maxJobs
      if (typeof info.maxSourceChars === 'number') health.maxSourceChars = info.maxSourceChars
      if (info.maxBudgetUsd === null || typeof info.maxBudgetUsd === 'number')
        health.maxBudgetUsd = info.maxBudgetUsd
      return health
    },
  }
}
