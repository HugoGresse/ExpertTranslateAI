import type { EventSink } from '../ports.ts'
import type { ProgressEvent } from '../types.ts'

export interface EventQueue extends EventSink {
  close(): void
  fail(error: unknown): void
  [Symbol.asyncIterator](): AsyncIterator<ProgressEvent>
}

export function createEventQueue(): EventQueue {
  const buffer: ProgressEvent[] = []
  let waiter: (() => void) | null = null
  let closed = false
  let failure: unknown = null

  const wake = (): void => {
    waiter?.()
    waiter = null
  }

  return {
    emit(event) {
      if (closed) return
      buffer.push(event)
      wake()
    },
    close() {
      closed = true
      wake()
    },
    fail(error) {
      failure = error
      closed = true
      wake()
    },
    async *[Symbol.asyncIterator]() {
      while (true) {
        if (buffer.length > 0) {
          yield buffer.shift() as ProgressEvent
          continue
        }
        if (failure) throw failure instanceof Error ? failure : new Error('Engine failed')
        if (closed) return
        await new Promise<void>((resolve) => {
          waiter = resolve
        })
      }
    },
  }
}
