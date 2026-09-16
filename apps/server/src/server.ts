import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import {
  type ContextDigest,
  createEngine,
  createMemoryStorage,
  type LlmPort,
  type LoggerPort,
  parseRemoteJobRequest,
  type RemoteErrorEvent,
  type RemoteJobRequest,
  type StoragePort,
  type TranslationJob,
} from '@experttranslate/core'
import { withInlineMaterials } from '@experttranslate/node'
import type { ServerLimits } from './config.ts'
import { SERVER_VERSION } from './version.ts'

const MAX_BODY_BYTES = 20 * 1024 * 1024
const DIGEST_CACHE_MAX = 500

export interface ServerDeps {
  config: ServerLimits & { token: string; allowedOrigins: string[]; persistJobs: boolean }
  llm: LlmPort
  storage: StoragePort
  logger: LoggerPort
  now: () => number
}

export interface EtaServer {
  server: Server
  /** Aborts every running job and stops accepting connections. */
  shutdown(): Promise<void>
  jobsRunning(): number
}

class HttpError extends Error {
  readonly status: number
  readonly issues: string[]
  constructor(status: number, message: string, issues: string[] = []) {
    super(message)
    this.status = status
    this.issues = issues
  }
}

const originAllowed = (origin: string, allowed: string[]): boolean =>
  allowed.includes('*') || allowed.includes(origin)

function corsHeaders(
  req: IncomingMessage,
  allowed: string[],
  logger: LoggerPort,
): Record<string, string> {
  const origin = req.headers.origin
  if (origin === undefined) return {}
  if (!originAllowed(origin, allowed)) {
    logger.warn('cors.rejected', { origin, allowed, url: req.url })
    return {}
  }
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-max-age': '600',
    vary: 'origin',
  }
}

function checkAuth(req: IncomingMessage, token: string): void {
  if (!token) return
  if ((req.headers.authorization ?? '') !== `Bearer ${token}`)
    throw new HttpError(401, 'Missing or invalid bearer token')
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buf = Buffer.from(chunk)
    size += buf.length
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'Request body too large')
    chunks.push(buf)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new HttpError(400, 'Body is not valid JSON')
  }
}

const sendJson = (
  res: ServerResponse,
  status: number,
  body: unknown,
  extra: Record<string, string>,
): void => {
  res.writeHead(status, { 'content-type': 'application/json', ...extra })
  res.end(JSON.stringify(body))
}

/** Applies the server's own limits on top of whatever the client asked for. */
function applyLimits(job: TranslationJob, limits: ServerLimits): TranslationJob {
  if (job.sourceText.length > limits.maxSourceChars)
    throw new HttpError(413, `Source text exceeds ${limits.maxSourceChars} characters`)
  if (limits.allowedModels.length > 0) {
    const bad = Object.values(job.models).filter((m) => !limits.allowedModels.includes(m))
    if (bad.length > 0)
      throw new HttpError(400, `Models not allowed on this server: ${[...new Set(bad)].join(', ')}`)
  }
  const budgetUsd =
    limits.maxBudgetUsd === null
      ? job.options.budgetUsd
      : Math.min(job.options.budgetUsd ?? Number.POSITIVE_INFINITY, limits.maxBudgetUsd)
  return { ...job, options: { ...job.options, budgetUsd } }
}

export function createEtaServer(deps: ServerDeps): EtaServer {
  const { config, logger } = deps
  const running = new Map<string, AbortController>()
  /** Digests of client contexts by content hash, so repeat jobs never pay the condense call twice. */
  const digests = new Map<string, ContextDigest>()

  const rememberDigests = async (
    storage: StoragePort,
    materials: RemoteJobRequest['materials'],
  ) => {
    for (const source of materials.contexts) {
      const row = await storage.contexts.get(source.id)
      if (row?.condensed && row.condensed.forHash === row.contentHash) {
        digests.delete(row.contentHash)
        digests.set(row.contentHash, row.condensed)
      }
    }
    while (digests.size > DIGEST_CACHE_MAX) {
      const oldest = digests.keys().next().value
      if (oldest === undefined) break
      digests.delete(oldest)
    }
  }

  const withCachedDigests = (materials: RemoteJobRequest['materials']) => ({
    ...materials,
    contexts: materials.contexts.map((c) => {
      const cached =
        c.condensed?.forHash === c.contentHash ? c.condensed : digests.get(c.contentHash)
      return cached ? { ...c, condensed: cached } : c
    }),
  })

  const handleJob = async (
    req: IncomingMessage,
    res: ServerResponse,
    cors: Record<string, string>,
  ): Promise<void> => {
    if (running.size >= config.maxJobs)
      throw new HttpError(429, `Server is busy (${running.size} jobs running)`)
    const parsed = parseRemoteJobRequest(await readJson(req))
    if (!parsed.ok) throw new HttpError(400, 'Invalid job request', parsed.issues)
    const job = applyLimits(parsed.value.job, config)
    const materials = withCachedDigests(parsed.value.materials)
    const controller = new AbortController()
    running.set(job.id, controller)
    // The request stream closes as soon as its body is consumed; the response is what stays open.
    res.on('close', () => {
      if (!res.writableFinished && !controller.signal.aborted) {
        logger.info('job.clientGone', { jobId: job.id })
        controller.abort(new Error('client disconnected'))
      }
    })
    const base = config.persistJobs ? deps.storage : createMemoryStorage()
    const storage = withInlineMaterials(base, materials)
    const engine = createEngine({ llm: deps.llm, storage, clock: { now: deps.now }, logger })
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
      ...cors,
    })
    res.write(': connected\n\n')
    logger.info('job.start', {
      jobId: job.id,
      targets: job.targets.length,
      chars: job.sourceText.length,
      difficulty: job.difficulty,
      budgetUsd: job.options.budgetUsd,
      running: running.size,
    })
    const keepAlive = setInterval(() => {
      if (!res.writableEnded) res.write(': ping\n\n')
    }, 15_000)
    let events = 0
    try {
      for await (const event of engine.run(job, { signal: controller.signal })) {
        events++
        if (!res.writableEnded) res.write(`data: ${JSON.stringify(event)}\n\n`)
      }
      if (!res.writableEnded) res.write('data: [DONE]\n\n')
    } catch (error) {
      const frame: RemoteErrorEvent = {
        type: 'error',
        message: error instanceof Error ? error.message : String(error),
      }
      logger.error('job.failed', { jobId: job.id, error: frame.message })
      if (!res.writableEnded) res.write(`data: ${JSON.stringify(frame)}\n\n`)
    } finally {
      clearInterval(keepAlive)
      running.delete(job.id)
      await rememberDigests(storage, parsed.value.materials).catch((error: unknown) => {
        logger.warn('job.digestCacheFailed', { jobId: job.id, error: String(error) })
      })
      res.end()
      logger.info('job.end', { jobId: job.id, events, aborted: controller.signal.aborted })
    }
  }

  const health = () => ({
    ok: true,
    version: SERVER_VERSION,
    auth: Boolean(config.token),
    jobsRunning: running.size,
    maxJobs: config.maxJobs,
    maxBudgetUsd: config.maxBudgetUsd,
    maxSourceChars: config.maxSourceChars,
    persistJobs: config.persistJobs,
  })

  const route = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const cors = corsHeaders(req, config.allowedOrigins, logger)
    try {
      if (req.method === 'OPTIONS') {
        res.writeHead(Object.keys(cors).length > 0 ? 204 : 403, cors)
        res.end()
        return
      }
      if (url.pathname === '/api/health' && req.method === 'GET') {
        sendJson(res, 200, health(), cors)
        return
      }
      checkAuth(req, config.token)
      if (url.pathname === '/api/models' && req.method === 'GET') {
        sendJson(res, 200, await deps.llm.models(), cors)
        return
      }
      if (url.pathname === '/api/key' && req.method === 'GET') {
        sendJson(res, 200, await deps.llm.keyInfo(), cors)
        return
      }
      if (url.pathname === '/api/jobs' && req.method === 'POST') {
        await handleJob(req, res, cors)
        return
      }
      throw new HttpError(404, `No route for ${req.method} ${url.pathname}`)
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500
      const message = error instanceof Error ? error.message : String(error)
      const issues = error instanceof HttpError ? error.issues : []
      logger[status >= 500 ? 'error' : 'warn']('http.error', {
        method: req.method,
        url: req.url,
        status,
        error: message,
        ...(issues.length > 0 ? { issues } : {}),
      })
      if (res.headersSent) {
        res.end()
        return
      }
      sendJson(res, status, { error: message, ...(issues.length > 0 ? { issues } : {}) }, cors)
    }
  }

  const server = createServer((req, res) => {
    const started = deps.now()
    void route(req, res).finally(() => {
      logger.debug('http.done', {
        method: req.method,
        url: req.url,
        status: res.statusCode,
        ms: deps.now() - started,
      })
    })
  })
  server.requestTimeout = 0
  server.headersTimeout = 60_000

  return {
    server,
    jobsRunning: () => running.size,
    shutdown: () =>
      new Promise((resolve) => {
        for (const [jobId, controller] of running) {
          logger.info('job.abortOnShutdown', { jobId })
          controller.abort(new Error('server shutting down'))
        }
        server.close(() => resolve())
        server.closeAllConnections()
      }),
  }
}
