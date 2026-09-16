export interface Limiter {
  run<T>(fn: () => Promise<T>): Promise<T>
  readonly pending: number
  readonly active: number
}

export function createLimiter(concurrency: number): Limiter {
  if (concurrency < 1) throw new RangeError('concurrency must be >= 1')
  let active = 0
  const waiting: Array<() => void> = []

  const acquire = (): Promise<void> => {
    if (active < concurrency) {
      active++
      return Promise.resolve()
    }
    return new Promise((resolve) => {
      waiting.push(() => {
        active++
        resolve()
      })
    })
  }

  const release = (): void => {
    active--
    waiting.shift()?.()
  }

  return {
    async run(fn) {
      await acquire()
      try {
        return await fn()
      } finally {
        release()
      }
    },
    get pending() {
      return waiting.length
    },
    get active() {
      return active
    },
  }
}
