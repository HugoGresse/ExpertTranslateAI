import { expect, type Page, test } from '@playwright/test'

const sse = (deltas: string[]): string =>
  [
    ...deltas.map((d) => `data: ${JSON.stringify({ choices: [{ delta: { content: d } }] })}`),
    `data: ${JSON.stringify({ choices: [{ delta: {} }], usage: { prompt_tokens: 20, completion_tokens: 4, cost: 0.0002 } })}`,
    'data: [DONE]',
    '',
  ].join('\n\n')

const mockOpenRouter = async (page: Page): Promise<string[]> => {
  const seenModels: string[] = []
  await page.route('https://openrouter.ai/api/v1/models', (route) =>
    route.fulfill({
      json: {
        data: [
          {
            id: 'test/model',
            name: 'Test Model',
            context_length: 1000,
            pricing: { prompt: '0.000001', completion: '0.000002' },
          },
        ],
      },
    }),
  )
  await page.route('https://openrouter.ai/api/v1/chat/completions', (route) => {
    const body = route.request().postDataJSON() as {
      model: string
      messages: { role: string; content: string }[]
    }
    seenModels.push(body.model)
    const system = body.messages[0]?.content ?? ''
    const lang = system.includes('to fr') ? 'fr' : 'es'
    const user = body.messages[1]?.content ?? ''
    const tokens = user.match(/⟦PH\d+⟧/g) ?? []
    return route.fulfill({
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
      body: sse([`Bonjour ${lang} `, ...tokens.map((t) => `${t} `)]),
    })
  })
  return seenModels
}

test('translates into two languages with placeholders restored and stores history', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem('eta.openrouter.key', 'sk-or-e2e')
    localStorage.setItem('eta.settings.translatorModel', 'test/model')
    localStorage.setItem('eta.settings.difficulty', 'simple')
    localStorage.setItem(
      'eta.targets',
      JSON.stringify([{ lang: 'fr' }, { lang: 'es', region: 'Mexico' }]),
    )
  })
  const seenModels = await mockOpenRouter(page)

  await page.goto('/')
  await page
    .getByPlaceholder('Paste text or Markdown to translate…')
    .fill('Hello {{name}}, see https://example.com')
  await page.getByRole('button', { name: 'Translate' }).click()

  await expect(page.getByRole('tab', { name: /French/ })).toBeVisible()
  await expect(page.locator('textarea').nth(1)).toHaveValue(
    'Bonjour fr {{name}} https://example.com',
  )
  await page.getByRole('tab', { name: /Spanish/ }).click()
  await expect(page.locator('textarea').nth(1)).toHaveValue(
    'Bonjour es {{name}} https://example.com',
  )
  await expect(page.getByText(/Total: 2 calls/)).toBeVisible()
  expect(seenModels).toEqual(['test/model', 'test/model'])

  await page.goto('/history')
  await expect(page.getByText('French, Spanish (Mexico) · test/model · done')).toBeVisible()
  await page.getByRole('button', { name: 'Open' }).click()
  await expect(page.getByText('Bonjour fr {{name}} https://example.com')).toBeVisible()
})
