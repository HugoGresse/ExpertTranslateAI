import { expect, test } from '@playwright/test'
import { type ChatRequestBody, mockChat, mockModels } from './helpers'

test('same-language region targets get separate tabs, files load into the source, RTL panes flip', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem('eta.openrouter.key', 'sk-or-e2e')
    localStorage.setItem('eta.settings.translatorModel', 'test/model')
    localStorage.setItem('eta.settings.difficulty', 'simple')
    localStorage.setItem('eta.settings.autoEscalate', 'false')
    localStorage.setItem('eta.settings.sourceLang', 'en')
    localStorage.setItem(
      'eta.targets',
      JSON.stringify([{ lang: 'fr' }, { lang: 'fr', region: 'Canada' }, { lang: 'ar' }]),
    )
  })
  await mockModels(page)
  await mockChat(page, (body: ChatRequestBody) => {
    const system = body.messages[0]?.content ?? ''
    if (system.includes('to ar')) return 'مرحبا بالعالم'
    return system.includes('Canada') ? 'Allo le monde' : 'Bonjour le monde'
  })

  await page.goto('/')
  await page.locator('input[type="file"]').setInputFiles({
    name: 'hello.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('# Hello world'),
  })
  await expect(page.getByPlaceholder('Paste text or Markdown to translate')).toHaveValue(
    '# Hello world',
  )
  await page.getByRole('button', { name: 'Translate' }).click()

  await expect(page.getByRole('tab', { name: /^French ✓/ })).toBeVisible()
  await expect(page.getByRole('tab', { name: /French \(Canada\) ✓/ })).toBeVisible()
  await expect(page.locator('textarea').nth(1)).toHaveValue('Bonjour le monde')
  await page.getByRole('tab', { name: /French \(Canada\)/ }).click()
  await expect(page.locator('textarea').nth(1)).toHaveValue('Allo le monde')
  await expect(page.locator('textarea').nth(1)).toHaveAttribute('dir', 'ltr')

  await page.getByRole('tab', { name: /Arabic/ }).click()
  await expect(page.locator('textarea').nth(1)).toHaveValue('مرحبا بالعالم')
  await expect(page.locator('textarea').nth(1)).toHaveAttribute('dir', 'rtl')
  await expect(page.getByText(/Total: 3 calls/)).toBeVisible()
})

test('the PWA manifest and service worker are served', async ({ page, request }) => {
  await page.goto('/')
  const manifestHref = await page.locator('link[rel="manifest"]').getAttribute('href')
  expect(manifestHref).toBeTruthy()
  const manifest = await request.get(manifestHref ?? '')
  expect(manifest.ok()).toBe(true)
  expect((await manifest.json()).name).toBe('ExpertTranslateAI')
  const sw = await request.get(manifestHref?.replace('manifest.webmanifest', 'sw.js') ?? '')
  expect(sw.ok()).toBe(true)
  expect(await sw.text()).toContain("addEventListener('fetch'")
})
