import { describe, expect, it } from 'vitest'
import { isRetryable, LlmHttpError, parseRetryAfter, withRetry } from '../src/llm/retry.ts'

const noSleep = { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 2, sleep: () => Promise.resolve() }

describe('withRetry', () => {
  it('retries on 429 then succeeds', async () => {
    let calls = 0
    const result = await withRetry(() => {
      calls++
      if (calls < 3) return Promise.reject(new LlmHttpError(429, 'slow down', null))
      return Promise.resolve('ok')
    }, noSleep)
    expect(result).toBe('ok')
    expect(calls).toBe(3)
  })

  it('does not retry on 401', async () => {
    let calls = 0
    await expect(
      withRetry(() => {
        calls++
        return Promise.reject(new LlmHttpError(401, 'bad key', null))
      }, noSleep),
    ).rejects.toBeInstanceOf(LlmHttpError)
    expect(calls).toBe(1)
  })

  it('gives up after maxAttempts', async () => {
    let calls = 0
    await expect(
      withRetry(() => {
        calls++
        return Promise.reject(new LlmHttpError(503, 'down', null))
      }, noSleep),
    ).rejects.toThrow('503')
    expect(calls).toBe(3)
  })
})

describe('helpers', () => {
  it('classifies retryable errors', () => {
    expect(isRetryable(new LlmHttpError(500, '', null))).toBe(true)
    expect(isRetryable(new LlmHttpError(402, '', null))).toBe(false)
    expect(isRetryable(new DOMException('x', 'AbortError'))).toBe(false)
    expect(isRetryable(new TypeError('network'))).toBe(true)
  })
  it('parses retry-after seconds', () => {
    expect(parseRetryAfter('2')).toBe(2000)
    expect(parseRetryAfter(null)).toBeNull()
  })
})
