import { homedir } from 'node:os'
import { join } from 'node:path'
import { type LogLevel, parseLogLevel } from '@experttranslate/node'

export interface ServerConfig {
  port: number
  host: string
  apiKey: string
  /** Bearer token clients must send; empty only when anonymous access was explicitly allowed. */
  token: string
  allowedOrigins: string[]
  dataDir: string
  concurrency: number
  logLevel: LogLevel
}

export function configFromEnv(env: Record<string, string | undefined>): ServerConfig {
  const apiKey = env.OPENROUTER_API_KEY?.trim() ?? ''
  if (!apiKey) throw new Error('Set OPENROUTER_API_KEY in the environment')
  const token = env.ETA_SERVER_TOKEN?.trim() ?? ''
  if (!token && env.ETA_ALLOW_ANONYMOUS !== 'true')
    throw new Error(
      'Set ETA_SERVER_TOKEN so only your clients can spend on your key, or ETA_ALLOW_ANONYMOUS=true to run open',
    )
  const port = Number(env.PORT ?? env.ETA_PORT ?? '8787')
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error(`Invalid port "${env.PORT ?? env.ETA_PORT}"`)
  const concurrency = Number(env.ETA_CONCURRENCY ?? '4')
  return {
    port,
    host: env.ETA_HOST ?? '127.0.0.1',
    apiKey,
    token,
    allowedOrigins: (env.ETA_ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
    dataDir: env.ETA_DATA_DIR ?? join(homedir(), '.experttranslate'),
    concurrency: Number.isInteger(concurrency) && concurrency > 0 ? concurrency : 4,
    logLevel: parseLogLevel(env.ETA_LOG_LEVEL, 'info'),
  }
}
