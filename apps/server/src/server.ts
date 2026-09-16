import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import {
  createEngine,
  isRemoteJobRequest,
  type LlmPort,
  type LoggerPort,
  type StoragePort,
} from '@experttranslate/core'
import { withInlineMaterials } from '@experttranslate/node'
import type { ServerConfig } from './config.ts'

export const SERVER_VERSION = '0.1.0'
const MAX_BODY_BYTES = 20 * 1024 * 1024

export interface ServerDeps {
  config: Pick<ServerConfig, 'token' | 'allowedOrigins' | 'concurrency'>
  llm: LlmPort
  storage: StoragePort
  logger: LoggerPort
  now: () => number
}

class HttpError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

const originAllowed = (origin: string | undefined, allowed: string[]): boolean =>
  origin !== undefined && (allowed.includes('*') || allowed.includes(origin))

function corsHeaders(req: IncomingMessage, allowed: string[]): Record<string, string> {
  const origin = req.headers.origin
  if (!originAllowed(origin, allowed) || origin === undefined) return {}
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
  const header = req.headers.authorization ?? ''
  if (header !== `Bearer ${token}`) throw new HttpError(401, 'Missing or invalid bearer token')
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'Request body too large')
    chunks.push(chunk as Buffer)
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

export function createEtaServer(deps: ServerDeps): Server {
  const { config, logger } = deps

  const handleJob = async (
    req: IncomingMessage,
    res: ServerResponse,
    cors: Record<string, string>,
  ): Promise<void> => {
    const body = await readJson(req)
    if (!isRemoteJobRequest(body)) throw new HttpError(400, 'Body must be { job, materials }')
    const controller = new AbortController()
    req.on('close', () => {
      if (!res.writableFinished) {
        logger.info('job.clientGone', { jobId: body.job.id })
        controller.abort(new Error('client disconnected'))
      }
    })
    const storage = withInlineMaterials(deps.storage, body.materials)
    const jobEngine = createEngine({ llm: deps.llm, storage, clock: { now: deps.now }, logger })
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
      ...cors,
    })
    res.write(': connected\n\n')
    logger.info('job.start', {
      jobId: body.job.id,
      targets: body.job.targets.length,
      chars: body.job.sourceText.length,
      difficulty: body.job.difficulty,
    })
    const keepAlive = setInterval(() => res.write(': ping\n\n'), 15_000)
    try {
      for await (const event of jobEngine.run(body.job, { signal: controller.signal })) {
        if (event.type === 'token') continue
        res.write(`data: ${JSON.stringify(event)}\n\n`)
      }
      res.write('data: [DONE]\n\n')
    } finally {
      clearInterval(keepAlive)
      res.end()
      logger.info('job.end', { jobId: body.job.id, aborted: controller.signal.aborted })
    }
  }

  const route = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const cors = corsHeaders(req, config.allowedOrigins)
    if (req.method === 'OPTIONS') {
      res.writeHead(Object.keys(cors).length > 0 ? 204 : 403, cors)
      res.end()
      return
    }
    if (url.pathname === '/api/health' && req.method === 'GET') {
      sendJson(res, 200, { ok: true, version: SERVER_VERSION, auth: Boolean(config.token) }, cors)
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
  }

  return createServer((req, res) => {
    const started = deps.now()
    route(req, res)
      .catch((error: unknown) => {
        const status = error instanceof HttpError ? error.status : 500
        const message = error instanceof Error ? error.message : String(error)
        logger[status >= 500 ? 'error' : 'warn']('http.error', {
          method: req.method,
          url: req.url,
          status,
          error: message,
        })
        if (res.headersSent) {
          res.end()
          return
        }
        sendJson(res, status, { error: message }, corsHeaders(req, config.allowedOrigins))
      })
      .finally(() => {
        logger.debug('http.done', {
          method: req.method,
          url: req.url,
          status: res.statusCode,
          ms: deps.now() - started,
        })
      })
  })
}
