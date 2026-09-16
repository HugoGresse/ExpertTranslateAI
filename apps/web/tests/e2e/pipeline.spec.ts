import { expect, test } from '@playwright/test'

const sse = (text: string): string =>
  [
    `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}`,
    `data: ${JSON.stringify({ choices: [{ delta: {} }], usage: { prompt_tokens: 30, completion_tokens: 5, cost: 0.001 } })}`,
    'data: [DONE]',
    '',
  ].join('\n\n')

const replies: Record<string, string> = {
  'test/helper': JSON.stringify({
    detectedLang: 'en',
    domain: 'technical',
    difficulty: 'normal',
    summary: 'Intro text',
    tone: 'friendly',
    audience: 'devs',
    keyTerms: [],
    risks: [],
  }),
  'test/model': 'Bonjour A',
  'test/model-b': 'Salut B',
  'test/reviewer': JSON.stringify({
    issues: [
      { candidate: 'translatorB', category: 'style', severity: 'minor', explanation: 'too casual' },
    ],
    suggestions: [],
    preferred: 'translatorA',
  }),
  'test/finalizer': 'Bonjour final',
  'test/scorer': JSON.stringify({
    fidelity: 90,
    terminology: 95,
    grammar: 100,
    naturalness: 85,
    register: 80,
    consistency: 90,
    confidence: 75,
    notes: ['fine'],
  }),
}

test('normal difficulty runs brief, two translators, review, finalize and score', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem('eta.openrouter.key', 'sk-or-e2e')
    localStorage.setItem('eta.settings.translatorModel', 'test/model')
    localStorage.setItem('eta.settings.translatorBModel', 'test/model-b')
    localStorage.setItem('eta.settings.reviewerModel', 'test/reviewer')
    localStorage.setItem('eta.settings.finalizerModel', 'test/finalizer')
    localStorage.setItem('eta.settings.scorerModel', 'test/scorer')
    localStorage.setItem('eta.settings.helperModel', 'test/helper')
    localStorage.setItem('eta.settings.difficulty', 'auto')
    localStorage.setItem('eta.targets', JSON.stringify([{ lang: 'fr' }]))
  })
  const models: string[] = []
  await page.route('https://openrouter.ai/api/v1/models', (route) =>
    route.fulfill({ json: { data: [] } }),
  )
  await page.route('https://openrouter.ai/api/v1/chat/completions', (route) => {
    const body = route.request().postDataJSON() as { model: string }
    models.push(body.model)
    return route.fulfill({
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
      body: sse(replies[body.model] ?? 'x'),
    })
  })

  await page.goto('/')
  await page.getByPlaceholder('Paste text or Markdown to translate…').fill('Hello there')
  await page.getByRole('button', { name: 'Translate' }).click()

  await expect(page.locator('textarea').nth(1)).toHaveValue('Bonjour final')
  await expect(page.getByText('technical')).toBeVisible()
  await expect(page.getByText('overall · confidence')).toBeVisible()
  await expect(page.getByText('Pipeline: normal · 2 translators · reviewed')).toBeVisible()
  await page.getByRole('button', { name: /Show review/ }).click()
  await expect(page.getByText('too casual')).toBeVisible()
  await page.getByRole('button', { name: /Compare candidates/ }).click()
  await expect(page.getByText('Salut B')).toBeVisible()
  expect(models.sort()).toEqual([
    'test/finalizer',
    'test/helper',
    'test/model',
    'test/model-b',
    'test/reviewer',
    'test/scorer',
  ])
})
