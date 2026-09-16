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
