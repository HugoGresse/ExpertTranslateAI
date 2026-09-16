import type { Engine } from '../engine.ts'
import { readSseData } from '../llm/sse.ts'
import { buildEvalRecord } from '../pipeline/evalRecord.ts'
import type { ClockPort, LoggerPort, StoragePort } from '../ports.ts'
import type { ModelInfo, ProgressEvent, TranslationJob } from '../types.ts'
import { collectMaterials, type RemoteJobRequest } from './protocol.ts'

export interface RemoteEngineOptions {
  baseUrl: string
  token?: string
  fetch?: typeof fetch
  /** Local store that receives results, jobs and evals so history and insights keep working. */
  storage: StoragePort
  clock: ClockPort
  logger: LoggerPort
  /** Used for `estimate`, which stays local because it is pure. */
  local: Pick<Engine, 'estimate'>
  idleTimeoutMs?: number
}

export interface RemoteEngine extends Engine {
  models(): Promise<ModelInfo[]>
  health(): Promise<{ ok: boolean; version?: string }>
}

const isProgressEvent = (x: unknown): x is ProgressEvent =>
  typeof x === 'object' && x !== null && 'type' in x && typeof x.type === 'string'

/**
 * Runs jobs on an ExpertTranslateAI server over SSE while keeping the local store in sync.
 * The server holds the OpenRouter key; the browser never needs one.
 */
export function createRemoteEngine(opts: RemoteEngineOptions): RemoteEngine {
  const doFetch = opts.fetch ?? fetch
  const base = opts.baseUrl.replace(/\/+$/, '')
  const headers = (extra: Record<string, string> = {}): Record<string, string> => ({
    ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
    ...extra,
  })

  const request = async (path: string, init: RequestInit = {}): Promise<Response> => {
    const url = `${base}${path}`
    opts.logger.debug('remote.request', { url, method: init.method ?? 'GET' })
    const response = await doFetch(url, {
      ...init,
      headers: headers(init.headers as Record<string, string>),
    })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      opts.logger.warn('remote.httpError', { url, status: response.status })
      throw new Error(`Server ${response.status}${text ? `: ${text.slice(0, 200)}` : ''}`)
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
    try {
      const response = await request('/api/jobs', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
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
        if (!isProgressEvent(parsed)) continue
        if (parsed.type === 'target-done') {
          await opts.storage.results.put(parsed.result)
          try {
            await opts.storage.evals.put(
              buildEvalRecord(job, job.models, parsed.result, opts.clock.now()),
            )
          } catch (error) {
            opts.logger.warn('remote.evalPutFailed', { error: String(error) })
          }
        }
        if (parsed.type === 'target-failed') sawTargetFailure = true
        if (parsed.type === 'job-done') status = sawTargetFailure ? 'failed' : 'done'
        yield parsed
      }
    } finally {
      if (o?.signal?.aborted) status = 'cancelled'
      await opts.storage.jobs.put({ ...job, status }).catch((error: unknown) => {
        opts.logger.warn('remote.jobPutFailed', { error: String(error) })
      })
    }
  }

  return {
    run,
    estimate: (job, models, sources) => opts.local.estimate(job, models, sources),
    models: async () => {
      const list: unknown = await (await request('/api/models')).json()
      return Array.isArray(list) ? (list as ModelInfo[]) : []
    },
    health: async () => {
      const info: unknown = await (await request('/api/health')).json()
      return typeof info === 'object' && info !== null && 'ok' in info
        ? (info as { ok: boolean; version?: string })
        : { ok: false }
    },
  }
}
