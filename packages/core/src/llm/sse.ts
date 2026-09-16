import { createParser, type EventSourceMessage } from 'eventsource-parser'

export async function* readSseData(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
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
      const { value, done: streamDone } = await reader.read()
      if (streamDone) break
      parser.feed(decoder.decode(value, { stream: true }))
      while (queue.length > 0) yield queue.shift() as string
    }
    while (queue.length > 0) yield queue.shift() as string
  } finally {
    await reader.cancel().catch(() => undefined)
  }
}
