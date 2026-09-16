import { expect, test } from '@playwright/test'
import { type ChatRequestBody, mockChat, mockModels } from './helpers'

test('prompt override reaches the translator, back-translation shows deltas, insights logs the run', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem('eta.openrouter.key', 'sk-or-e2e')
    localStorage.setItem('eta.settings.translatorModel', 'test/model')
    localStorage.setItem('eta.settings.backTranslatorModel', 'test/back')
    localStorage.setItem('eta.settings.difficulty', 'simple')
    localStorage.setItem('eta.settings.autoEscalate', 'false')
    localStorage.setItem('eta.settings.backTranslate', 'true')
    localStorage.setItem('eta.settings.sourceLang', 'en')
    localStorage.setItem('eta.targets', JSON.stringify([{ lang: 'fr' }]))
  })
  await mockModels(page)
  const seen = await mockChat(page, (body: ChatRequestBody) => {
    const system = body.messages[0]?.content ?? ''
    if (body.model === 'test/back')
      return system.includes('compare')
        ? JSON.stringify({
            deltas: [
              { source: 'twelve', back: '12', kind: 'shift', severity: 'minor', note: 'digits' },
            ],
          })
        : 'There are 12 clauses.'
    return 'Il y a 12 clauses.'
  })

  await page.goto('/prompts')
  const translator = page.getByLabel('Translator prompt', { exact: true })
  await translator.fill('You are a sworn legal translator.')
  await expect(page.getByText('Translator · overridden')).toBeVisible()

  await page.goto('/')
  await page
    .getByPlaceholder('Paste text or Markdown to translate…')
    .fill('There are twelve clauses.')
  await page.getByRole('button', { name: 'Translate' }).click()
  await expect(page.locator('textarea').nth(1)).toHaveValue('Il y a 12 clauses.')
  await page.getByRole('button', { name: /Back-translation: 1 delta/ }).click()
  await expect(page.getByText('meaning shifted')).toBeVisible()
  expect(seen[0]?.messages[0]?.content.startsWith('You are a sworn legal translator.')).toBe(true)

  await page.goto('/insights')
  await expect(page.getByText('Insights (1 evaluated runs)')).toBeVisible()
  await page.getByLabel('Group by').selectOption('prompts')
  await expect(page.getByRole('cell', { name: /^[0-9a-f]{5,}$/ })).toBeVisible()
})

test('encrypting the key locks the workspace until the passphrase is entered', async ({ page }) => {
  await mockModels(page)
  await page.route('https://openrouter.ai/api/v1/auth/key', (route) =>
    route.fulfill({ json: { data: { label: 't', limit: null, usage: 0 } } }),
  )
  await page.goto('/settings')
  await page.evaluate(() => localStorage.setItem('eta.openrouter.key', 'sk-or-e2e-secret'))
  await page.reload()
  await page.locator('input[aria-label="New passphrase"]').fill('correct horse battery')
  await page.getByRole('button', { name: 'Encrypt' }).click()
  await expect(page.getByText('Encrypted at rest')).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('eta.openrouter.key'))).toBeNull()

  await page.getByRole('button', { name: 'Lock now' }).click()
  await page.goto('/settings')
  await page.locator('input[aria-label="Passphrase"]').fill('wrong')
  await page.getByRole('button', { name: 'Unlock' }).click()
  await expect(page.getByText(/Wrong passphrase/)).toBeVisible()
  await page.locator('input[aria-label="Passphrase"]').fill('correct horse battery')
  await page.getByRole('button', { name: 'Unlock' }).click()
  await expect(page.getByText('Encrypted at rest')).toBeVisible()
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Source' })).toBeVisible()
  await expect(page.locator('input[aria-label="Passphrase"]')).toHaveCount(0)
  await expect(page.getByText('No OpenRouter key on this device.')).toHaveCount(0)
})
