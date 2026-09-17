import { describe, expect, it } from 'vitest'
import { createOpenRouterLlm, toModelInfo } from '../src/llm/openRouterLlm.ts'

const sse = (lines: string[]): ReadableStream<Uint8Array> => {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const line of lines) controller.enqueue(encoder.encode(`data: ${line}\n\n`))
      controller.close()
    },
  })
}

describe('createOpenRouterLlm', () => {
  it('streams deltas and the final usage', async () => {
    let captured: { url: string; init: RequestInit } | null = null
    const fetchImpl: typeof fetch = (url, init) => {
      captured = {
        url: url instanceof URL ? url.href : typeof url === 'string' ? url : url.url,
        init: init ?? {},
      }
      const body = sse([
        JSON.stringify({ choices: [{ delta: { content: 'Bon' } }] }),
        JSON.stringify({ choices: [{ delta: { content: 'jour' } }] }),
        JSON.stringify({
          choices: [{ delta: {} }],
          usage: { prompt_tokens: 7, completion_tokens: 2, cost: 0.0001 },
        }),
        '[DONE]',
      ])
      return Promise.resolve(new Response(body, { status: 200 }))
    }
    const llm = createOpenRouterLlm({
      apiKey: 'sk-test',
      fetch: fetchImpl,
      referer: 'https://x',
      title: 'T',
    })
    const chunks = []
    for await (const c of llm.chat({ model: 'm', messages: [{ role: 'user', content: 'hi' }] }))
      chunks.push(c)
    expect(chunks).toEqual([
      { type: 'delta', text: 'Bon' },
      { type: 'delta', text: 'jour' },
      { type: 'usage', usage: { promptTokens: 7, completionTokens: 2, costUsd: 0.0001 } },
    ])
    const req = captured as unknown as { url: string; init: RequestInit }
    expect(req.url).toBe('https://openrouter.ai/api/v1/chat/completions')
    const headers = req.init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer sk-test')
    expect(headers['HTTP-Referer']).toBe('https://x')
    // body was serialised with JSON.stringify above, so it is a string
    const body = JSON.parse(req.init.body as string) as {
      stream: boolean
      usage: { include: boolean }
    }
    expect(body.stream).toBe(true)
    expect(body.usage.include).toBe(true)
  })

  it('throws a typed error on non-2xx without retrying 401', async () => {
    let calls = 0
    const fetchImpl: typeof fetch = () => {
      calls++
      return Promise.resolve(new Response('unauthorized', { status: 401 }))
    }
    const llm = createOpenRouterLlm({ apiKey: 'bad', fetch: fetchImpl })
    await expect(llm.keyInfo()).rejects.toThrow('401')
    expect(calls).toBe(1)
  })

  it('maps raw models', () => {
    const info = toModelInfo({
      id: 'a/b',
      name: 'B',
      context_length: 128000,
      pricing: { prompt: '0.000001', completion: '0.000002' },
      supported_parameters: ['response_format'],
    })
    expect(info).toEqual({
      id: 'a/b',
      name: 'B',
      contextLength: 128000,
      pricing: { promptUsdPerToken: 0.000001, completionUsdPerToken: 0.000002 },
      supportsStructuredOutput: true,
    })
  })
})

describe('idle timeout', () => {
  const stall = (): ReadableStream<Uint8Array> => new ReadableStream({ start: () => undefined })

  it('retries a stream that never sends data, then succeeds', async () => {
    let calls = 0
    const fetchImpl: typeof fetch = () => {
      calls++
      if (calls === 1) return Promise.resolve(new Response(stall(), { status: 200 }))
      return Promise.resolve(
        new Response(sse([JSON.stringify({ choices: [{ delta: { content: 'ok' } }] }), '[DONE]']), {
          status: 200,
        }),
      )
    }
    const llm = createOpenRouterLlm({
      apiKey: 'k',
      fetch: fetchImpl,
      idleTimeoutMs: 20,
      retry: { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 2 },
    })
    const out = []
    for await (const c of llm.chat({ model: 'm', messages: [] })) out.push(c)
    expect(calls).toBe(2)
    expect(out[0]).toEqual({ type: 'delta', text: 'ok' })
  })

  it('does not retry once tokens were already delivered', async () => {
    const encoder = new TextEncoder()
    const partial = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ choices: [{ delta: { content: 'partial' } }] })}\n\n`,
          ),
        )
      },
    })
    let calls = 0
    const fetchImpl: typeof fetch = () => {
      calls++
      return Promise.resolve(new Response(partial, { status: 200 }))
    }
    const llm = createOpenRouterLlm({
      apiKey: 'k',
      fetch: fetchImpl,
      idleTimeoutMs: 20,
      retry: { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 2 },
    })
    const out: string[] = []
    await expect(
      (async () => {
        for await (const c of llm.chat({ model: 'm', messages: [] }))
          if (c.type === 'delta') out.push(c.text)
      })(),
    ).rejects.toThrow('No data received')
    expect(out).toEqual(['partial'])
    expect(calls).toBe(1)
  })
})

describe('reasoning and stream errors', () => {
  it('maps reasoning effort to the OpenRouter reasoning parameter', async () => {
    const bodies: Array<Record<string, unknown>> = []
    const fetchImpl: typeof fetch = (_url, init) => {
      bodies.push(JSON.parse(init?.body as string) as Record<string, unknown>)
      return Promise.resolve(new Response(sse(['[DONE]']), { status: 200 }))
    }
    const llm = createOpenRouterLlm({ apiKey: 'k', fetch: fetchImpl })
    for await (const _ of llm.chat({ model: 'm', messages: [], reasoningEffort: 'low' })) {
      /* drain */
    }
    for await (const _ of llm.chat({ model: 'm', messages: [], reasoningEffort: 'none' })) {
      /* drain */
    }
    for await (const _ of llm.chat({ model: 'm', messages: [] })) {
      /* drain */
    }
    expect(bodies[0]?.reasoning).toEqual({ effort: 'low' })
    expect(bodies[1]?.reasoning).toEqual({ enabled: false })
    expect(bodies[2]?.reasoning).toBeUndefined()
  })

  it('retries a provider stream error that happens before any token', async () => {
    let calls = 0
    const fetchImpl: typeof fetch = () => {
      calls++
      const lines =
        calls === 1
          ? [
              JSON.stringify({
                error: { message: 'The model stopped before completing the response.' },
              }),
            ]
          : [JSON.stringify({ choices: [{ delta: { content: 'ok' } }] }), '[DONE]']
      return Promise.resolve(new Response(sse(lines), { status: 200 }))
    }
    const llm = createOpenRouterLlm({
      apiKey: 'k',
      fetch: fetchImpl,
      retry: { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 2 },
    })
    const out = []
    for await (const c of llm.chat({ model: 'm', messages: [] })) out.push(c)
    expect(calls).toBe(2)
    expect(out[0]).toEqual({ type: 'delta', text: 'ok' })
  })
})

describe('in-stream provider error codes', () => {
  it('does not retry a deterministic 402 delivered inside the stream', async () => {
    let calls = 0
    const fetchImpl: typeof fetch = () => {
      calls++
      return Promise.resolve(
        new Response(
          sse([JSON.stringify({ error: { code: 402, message: 'Insufficient credits' } })]),
          { status: 200 },
        ),
      )
    }
    const llm = createOpenRouterLlm({
      apiKey: 'k',
      fetch: fetchImpl,
      retry: { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 2 },
    })
    await expect(
      (async () => {
        for await (const _ of llm.chat({ model: 'm', messages: [] })) {
          /* drain */
        }
      })(),
    ).rejects.toThrow('Insufficient credits')
    expect(calls).toBe(1)
  })

  it('drops the usage of a failed attempt', async () => {
    let calls = 0
    const fetchImpl: typeof fetch = () => {
      calls++
      const lines =
        calls === 1
          ? [
              JSON.stringify({
                choices: [{ delta: {} }],
                usage: { prompt_tokens: 999, completion_tokens: 999, cost: 9.99 },
              }),
              JSON.stringify({ error: { code: 500, message: 'boom' } }),
            ]
          : [JSON.stringify({ choices: [{ delta: { content: 'ok' } }] }), '[DONE]']
      return Promise.resolve(new Response(sse(lines), { status: 200 }))
    }
    const llm = createOpenRouterLlm({
      apiKey: 'k',
      fetch: fetchImpl,
      retry: { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 2 },
    })
    const out = []
    for await (const c of llm.chat({ model: 'm', messages: [] })) out.push(c)
    expect(out.at(-1)).toEqual({
      type: 'usage',
      usage: { promptTokens: 0, completionTokens: 0, costUsd: null },
    })
  })

  it('aborts an attempt that streams no visible text in time and retries', async () => {
    let calls = 0
    const fetchImpl: typeof fetch = (_url, init) => {
      calls++
      if (calls === 1) {
        // Only hidden reasoning keeps arriving; content never does.
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            const enc = new TextEncoder()
            const tick = setInterval(() => {
              controller.enqueue(
                enc.encode(
                  `data: ${JSON.stringify({ choices: [{ delta: { reasoning: '…' } }] })}\n\n`,
                ),
              )
            }, 5)
            init?.signal?.addEventListener('abort', () => {
              clearInterval(tick)
              controller.error(new DOMException('Aborted', 'AbortError'))
            })
          },
        })
        return Promise.resolve(new Response(stream, { status: 200 }))
      }
      return Promise.resolve(
        new Response(
          sse([
            JSON.stringify({ choices: [{ delta: { content: 'Bonjour' } }] }),
            JSON.stringify({
              choices: [{ delta: {} }],
              usage: { prompt_tokens: 1, completion_tokens: 1 },
            }),
            '[DONE]',
          ]),
          { status: 200 },
        ),
      )
    }
    const llm = createOpenRouterLlm({
      apiKey: 'k',
      fetch: fetchImpl,
      firstTokenTimeoutMs: 40,
      retry: { maxAttempts: 2, baseDelayMs: 1, maxDelayMs: 2 },
    })
    const chunks = []
    for await (const c of llm.chat({ model: 'm', messages: [{ role: 'user', content: 'hi' }] }))
      chunks.push(c)
    expect(calls).toBe(2)
    expect(chunks[0]).toEqual({ type: 'delta', text: 'Bonjour' })
  })
})
