import { expect, test } from '@playwright/test'

test('home page renders the workspace and key gate', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Source' })).toBeVisible()
  await expect(page.getByText('No OpenRouter key on this device.')).toBeVisible()
})

test('settings page accepts a pasted key and lists models from a mocked catalog', async ({
  page,
}) => {
  await page.route('https://openrouter.ai/api/v1/auth/key', (route) =>
    route.fulfill({
      json: { data: { label: 'test', limit: 5, usage: 1.25, is_free_tier: false } },
    }),
  )
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
  await page.goto('/settings')
  await page.getByLabel('OpenRouter API key').fill('sk-or-test-key-1234567890')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText('used $1.250 of $5.000 limit')).toBeVisible()
  await expect(page.getByRole('option', { name: /Test Model/ })).toHaveCount(1)
})
