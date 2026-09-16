import { createParser, type EventSourceMessage } from 'eventsource-parser'

export class StreamIdleTimeoutError extends Error {
  readonly idleMs: number
  constructor(idleMs: number) {
    super(`No data received from the model for ${Math.round(idleMs / 1000)}s`)
    this.name = 'StreamIdleTimeoutError'
    this.idleMs = idleMs
  }
}

function readWithTimeout<T>(promise: Promise<T>, idleMs: number): Promise<T> {
  if (!Number.isFinite(idleMs) || idleMs <= 0) return promise
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new StreamIdleTimeoutError(idleMs)), idleMs)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

export async function* readSseData(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
  idleTimeoutMs = 0,
): AsyncGenerator<string> {
  const queue: string[] = []
  let done = false
  const parser = createParser({
    onEvent: (event: EventSourceMessage) => {
      if (event.data === '[DONE]') {
        done = true
        return
      }
      queue.push(event.data)
    },
  })
  const reader = body.getReader()
  const decoder = new TextDecoder()
  try {
    while (!done) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      const { value, done: streamDone } = await readWithTimeout(reader.read(), idleTimeoutMs)
      if (streamDone) break
      parser.feed(decoder.decode(value, { stream: true }))
      while (queue.length > 0) yield queue.shift() as string
    }
    while (queue.length > 0) yield queue.shift() as string
  } finally {
    await reader.cancel().catch(() => undefined)
  }
}
