import { expect, test } from '@playwright/test'

const sse = (events: unknown[]): string =>
  [...events.map((e) => `data: ${JSON.stringify(e)}`), 'data: [DONE]', ''].join('\n\n')

test('a configured server runs the job without a local key and history keeps the result', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem('eta.settings.serverUrl', 'http://127.0.0.1:8787')
    localStorage.setItem('eta.settings.serverToken', 'secret')
    localStorage.setItem('eta.settings.difficulty', 'simple')
    localStorage.setItem('eta.targets', JSON.stringify([{ lang: 'fr' }]))
  })
  await page.route('http://127.0.0.1:8787/api/models', (route) =>
    route.fulfill({
      json: [
        {
          id: 'srv/model',
          name: 'Server Model',
          contextLength: 1000,
          pricing: { promptUsdPerToken: 0, completionUsdPerToken: 0 },
          supportsStructuredOutput: false,
        },
      ],
    }),
  )
  let received: { auth: string | undefined; guidelines: number } | null = null
  await page.route('http://127.0.0.1:8787/api/jobs', (route) => {
    const body = route.request().postDataJSON() as {
      job: { id: string }
      materials: { guidelines: unknown[] }
    }
    received = {
      auth: route.request().headers().authorization,
      guidelines: body.materials.guidelines.length,
    }
    const result = {
      jobId: body.job.id,
      lang: 'fr',
      targetKey: 'fr',
      sourceText: 'Hello',
      sourceLang: 'en',
      chunks: [],
      placeholders: {},
      candidates: [],
      finalText: 'Bonjour du serveur',
      brief: null,
      plan: { difficulty: 'simple', translators: ['translatorA'] },
      reviews: [],
      judgments: [],
      score: null,
      guidelineReport: [],
      terminologyReport: [],
      memoryHits: [],
      disagreements: [],
      escalations: [],
      backTranslation: null,
      cost: { usd: 0.001, calls: 1, tokensIn: 10, tokensOut: 5 },
      trace: [],
      status: 'done',
    }
    return route.fulfill({
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
      body: sse([
        { type: 'job-started', jobId: body.job.id, targets: [{ lang: 'fr' }] },
        { type: 'target-started', lang: 'fr', targetKey: 'fr', chunkCount: 1, placeholders: {} },
        { type: 'target-done', lang: 'fr', targetKey: 'fr', result },
        { type: 'job-done', jobId: body.job.id, cost: result.cost },
      ]),
    })
  })

  await page.goto('/')
  await expect(page.getByText('No OpenRouter key on this device.')).toHaveCount(0)
  await page.getByPlaceholder('Paste text or Markdown to translate').fill('Hello')
  await page.getByRole('button', { name: 'Translate' }).click()
  await expect(page.locator('textarea').nth(1)).toHaveValue('Bonjour du serveur')
  await expect(page.getByText(/Total: 1 calls/)).toBeVisible()
  expect(received).toEqual({ auth: 'Bearer secret', guidelines: 0 })

  await page.goto('/history')
  await expect(page.getByText('Bonjour du serveur')).toHaveCount(0)
  await page.getByRole('button', { name: 'Open' }).click()
  await expect(page.getByText('Bonjour du serveur')).toBeVisible()
})
