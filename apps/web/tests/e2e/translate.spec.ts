import { expect, type Page, test } from '@playwright/test'
import { sse } from './helpers'

const mockOpenRouter = async (
  page: Page,
  /** While set, calls for this language answer 402 like an account out of credit. */
  outOfCredit: { lang: string | null } = { lang: null },
): Promise<string[]> => {
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
    if (lang === outOfCredit.lang)
      return route.fulfill({
        status: 402,
        json: { error: { message: 'Insufficient credits', code: 402 } },
      })
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
    localStorage.setItem('eta.settings.autoEscalate', 'false')
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
  await expect(
    page.getByText('French (FR), Spanish (ES, Mexico) · test/model · done'),
  ).toBeVisible()
  await page.getByRole('link', { name: 'Open' }).click()
  await expect(page.getByRole('tab', { name: /Spanish/ })).toBeVisible()
  await expect(page.locator('textarea').nth(1)).toHaveValue(
    'Bonjour fr {{name}} https://example.com',
  )
  await expect(page.getByText(/Total: 2 calls/)).toBeVisible()
})

test('retry re-runs only the target that ran out of credit and history keeps both', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem('eta.openrouter.key', 'sk-or-e2e')
    localStorage.setItem('eta.settings.autoEscalate', 'false')
    localStorage.setItem('eta.settings.translatorModel', 'test/model')
    localStorage.setItem('eta.settings.difficulty', 'simple')
    localStorage.setItem(
      'eta.targets',
      JSON.stringify([{ lang: 'fr' }, { lang: 'es', region: 'Mexico' }]),
    )
  })
  const outOfCredit: { lang: string | null } = { lang: 'es' }
  const seenModels = await mockOpenRouter(page, outOfCredit)

  await page.goto('/')
  await page.getByPlaceholder('Paste text or Markdown to translate…').fill('Hello')
  await page.getByRole('button', { name: 'Translate' }).click()
  const retry = page.getByRole('button', { name: 'Retry 1 unfinished' })
  await expect(retry).toBeVisible()
  await page.getByRole('tab', { name: /Spanish/ }).click()
  await expect(page.getByText(/Insufficient credits|402/).first()).toBeVisible()

  outOfCredit.lang = null
  const before = seenModels.length
  await retry.click()
  await expect(page.locator('textarea').nth(1)).toHaveValue('Bonjour es')
  await expect(retry).toHaveCount(0)
  expect(seenModels.length - before).toBe(1)
  await page.getByRole('tab', { name: /French/ }).click()
  await expect(page.locator('textarea').nth(1)).toHaveValue('Bonjour fr')

  await page.goto('/history')
  await expect(
    page.getByText('French (FR), Spanish (ES, Mexico) · test/model · done'),
  ).toBeVisible()
})
