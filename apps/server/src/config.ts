import { homedir } from 'node:os'
import { join } from 'node:path'
import { type LogLevel, parseLogLevel } from '@experttranslate/node'

export interface ServerLimits {
  /** Hard ceiling applied to every job's budget; null disables the ceiling. */
  maxBudgetUsd: number | null
  maxSourceChars: number
  maxJobs: number
  /** Model ids clients may request; empty allows any. */
  allowedModels: string[]
}

export interface ServerConfig extends ServerLimits {
  port: number
  host: string
  apiKey: string
  /** Bearer token clients must send; empty only when anonymous access was explicitly allowed. */
  token: string
  allowedOrigins: string[]
  dataDir: string
  /** Keep every client's jobs, results and evals in the server store (off by default). */
  persistJobs: boolean
  concurrency: number
  logLevel: LogLevel
}

const text = (v: string | undefined): string | undefined => {
  const t = v?.trim()
  return t ? t : undefined
}

const list = (v: string | undefined): string[] =>
  (v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

function integer(raw: string | undefined, name: string, fallback: number, min: number): number {
  const v = text(raw)
  if (v === undefined) return fallback
  const n = Number(v)
  if (!Number.isInteger(n) || n < min)
    throw new Error(`${name} must be an integer >= ${min} (got "${v}")`)
  return n
}

export function configFromEnv(env: Record<string, string | undefined>): ServerConfig {
  const apiKey = text(env.OPENROUTER_API_KEY)
  if (!apiKey) throw new Error('Set OPENROUTER_API_KEY in the environment')
  const token = text(env.ETA_SERVER_TOKEN) ?? ''
  if (!token && env.ETA_ALLOW_ANONYMOUS !== 'true')
    throw new Error(
      'Set ETA_SERVER_TOKEN so only your clients can spend on your key, or ETA_ALLOW_ANONYMOUS=true to run open',
    )
  const port = integer(text(env.PORT) ?? env.ETA_PORT, 'PORT', 8787, 1)
  if (port > 65535) throw new Error(`PORT must be <= 65535 (got ${port})`)
  const budgetRaw = text(env.ETA_MAX_BUDGET_USD)
  const maxBudgetUsd = budgetRaw === undefined ? 5 : budgetRaw === 'none' ? null : Number(budgetRaw)
  if (maxBudgetUsd !== null && !(maxBudgetUsd > 0))
    throw new Error(`ETA_MAX_BUDGET_USD must be a positive number or "none" (got "${budgetRaw}")`)
  return {
    port,
    host: text(env.ETA_HOST) ?? '127.0.0.1',
    apiKey,
    token,
    allowedOrigins: list(env.ETA_ALLOWED_ORIGINS),
    dataDir: text(env.ETA_DATA_DIR) ?? join(homedir(), '.experttranslate'),
    persistJobs: env.ETA_PERSIST_JOBS === 'true',
    concurrency: integer(env.ETA_CONCURRENCY, 'ETA_CONCURRENCY', 4, 1),
    logLevel: parseLogLevel(env.ETA_LOG_LEVEL, 'info'),
    maxBudgetUsd,
    maxSourceChars: integer(env.ETA_MAX_SOURCE_CHARS, 'ETA_MAX_SOURCE_CHARS', 200_000, 1),
    maxJobs: integer(env.ETA_MAX_JOBS, 'ETA_MAX_JOBS', 4, 1),
    allowedModels: list(env.ETA_ALLOWED_MODELS),
  }
}
