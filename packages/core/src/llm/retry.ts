export class LlmHttpError extends Error {
  constructor(
    readonly status: number,
    readonly bodyText: string,
    readonly retryAfterMs: number | null,
  ) {
    super(`OpenRouter HTTP ${status}: ${bodyText.slice(0, 300)}`)
    this.name = 'LlmHttpError'
  }
}

export interface RetryOptions {
  maxAttempts: number
  baseDelayMs: number
  maxDelayMs: number
  sleep?: (ms: number) => Promise<void>
}

export const defaultRetryOptions: RetryOptions = {
  maxAttempts: 4,
  baseDelayMs: 500,
  maxDelayMs: 8000,
}

export function isRetryable(error: unknown): boolean {
  if (error instanceof LlmHttpError) return error.status === 429 || error.status >= 500
  if (error instanceof DOMException && error.name === 'AbortError') return false
  return error instanceof TypeError
}

export function backoffDelay(
  attempt: number,
  opts: RetryOptions,
  retryAfterMs: number | null,
): number {
  if (retryAfterMs !== null) return Math.min(retryAfterMs, opts.maxDelayMs)
  const exp = opts.baseDelayMs * 2 ** attempt
  const jitter = Math.random() * opts.baseDelayMs
  return Math.min(exp + jitter, opts.maxDelayMs)
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  opts: RetryOptions = defaultRetryOptions,
): Promise<T> {
  const sleep = opts.sleep ?? defaultSleep
  let lastError: unknown
  for (let attempt = 0; attempt < opts.maxAttempts; attempt++) {
    try {
      return await fn(attempt)
    } catch (error) {
      lastError = error
      if (!isRetryable(error) || attempt === opts.maxAttempts - 1) throw error
      const retryAfter = error instanceof LlmHttpError ? error.retryAfterMs : null
      await sleep(backoffDelay(attempt, opts, retryAfter))
    }
  }
  throw lastError
}

export function parseRetryAfter(header: string | null): number | null {
  if (!header) return null
  const seconds = Number(header)
  if (Number.isFinite(seconds)) return seconds * 1000
  const date = Date.parse(header)
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now())
}
