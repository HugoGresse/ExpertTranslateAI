import type { Page } from '@playwright/test'

export interface SseUsage {
  prompt_tokens: number
  completion_tokens: number
  cost: number
}

export const sse = (
  text: string | string[],
  usage: SseUsage = { prompt_tokens: 30, completion_tokens: 5, cost: 0.001 },
): string => {
  const deltas = Array.isArray(text) ? text : [text]
  return [
    ...deltas.map((d) => `data: ${JSON.stringify({ choices: [{ delta: { content: d } }] })}`),
    `data: ${JSON.stringify({ choices: [{ delta: {} }], usage })}`,
    'data: [DONE]',
    '',
  ].join('\n\n')
}

export interface ChatRequestBody {
  model: string
  messages: { role: string; content: string }[]
}

export async function mockModels(
  page: Page,
  models: Array<{ id: string; name: string }> = [],
): Promise<void> {
  await page.route('https://openrouter.ai/api/v1/models', (route) =>
    route.fulfill({
      json: { data: models.map((m) => ({ ...m, pricing: { prompt: '0', completion: '0' } })) },
    }),
  )
}

export async function mockChat(
  page: Page,
  reply: (body: ChatRequestBody) => string,
): Promise<ChatRequestBody[]> {
  const seen: ChatRequestBody[] = []
  await page.route('https://openrouter.ai/api/v1/chat/completions', (route) => {
    const body = route.request().postDataJSON() as ChatRequestBody
    seen.push(body)
    return route.fulfill({
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
      body: sse(reply(body)),
    })
  })
  return seen
}
