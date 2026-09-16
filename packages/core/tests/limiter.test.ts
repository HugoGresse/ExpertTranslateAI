import { describe, expect, it } from 'vitest'
import { createLimiter } from '../src/llm/limiter.ts'

describe('createLimiter', () => {
  it('never exceeds the configured concurrency', async () => {
    const limiter = createLimiter(2)
    let peak = 0
    let running = 0
    const task = async (): Promise<void> => {
      running++
      peak = Math.max(peak, running)
      await new Promise((r) => setTimeout(r, 5))
      running--
    }
    await Promise.all(Array.from({ length: 8 }, () => limiter.run(task)))
    expect(peak).toBe(2)
    expect(limiter.active).toBe(0)
    expect(limiter.pending).toBe(0)
  })

  it('releases the slot when the task throws', async () => {
    const limiter = createLimiter(1)
    await expect(limiter.run(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom')
    await expect(limiter.run(() => Promise.resolve('ok'))).resolves.toBe('ok')
  })
})
