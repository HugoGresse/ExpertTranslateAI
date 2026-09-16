import { expect, test } from '@playwright/test'

const sse = (text: string): string =>
  [
    `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}`,
    `data: ${JSON.stringify({ choices: [{ delta: {} }], usage: { prompt_tokens: 30, completion_tokens: 5, cost: 0.0001 } })}`,
    'data: [DONE]',
    '',
  ].join('\n\n')

test('context from a pasted llms.txt and a guideline rule reach the prompt and the report', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem('eta.openrouter.key', 'sk-or-e2e')
    localStorage.setItem('eta.settings.autoEscalate', 'false')
    localStorage.setItem('eta.settings.translatorModel', 'test/model')
    localStorage.setItem('eta.settings.difficulty', 'simple')
    localStorage.setItem('eta.targets', JSON.stringify([{ lang: 'fr' }]))
  })
  const systemPrompts: string[] = []
  await page.route('https://openrouter.ai/api/v1/models', (route) =>
    route.fulfill({
      json: {
        data: [{ id: 'test/model', name: 'Test Model', pricing: { prompt: '0', completion: '0' } }],
      },
    }),
  )
  await page.route('https://openrouter.ai/api/v1/chat/completions', (route) => {
    const body = route.request().postDataJSON() as { messages: { role: string; content: string }[] }
    systemPrompts.push(body.messages[0]?.content ?? '')
    return route.fulfill({
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
      body: sse('Bienvenue sur Hyperfluide'),
    })
  })

  await page.goto('/context')
  await page.getByRole('button', { name: 'Paste text' }).click()
  await page.getByLabel('Name (optional)').fill('Product notes')
  await page
    .getByLabel('Text')
    .fill('# Hyperfluid\n> AI platform.\n\n## Docs\n- [Start](https://x/start.md): Getting started')
  await page.getByRole('button', { name: 'Add source' }).click()
  await expect(page.getByText('Product notes')).toBeVisible()
  await expect(page.getByText('llms-txt')).toBeVisible()

  await page.goto('/guidelines')
  await page.getByRole('button', { name: 'New set' }).click()
  await page.getByLabel('Name', { exact: true }).fill('Names')
  await page.getByLabel('Rule kind').selectOption('must-not')
  await page.getByLabel('Rule text').fill('Never translate Hyperfluid')
  await page.getByLabel('Rule pattern').fill('Hyperfluide')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText('1 rule')).toBeVisible()

  await page.goto('/')
  await page.getByRole('button', { name: 'Product notes' }).click()
  await page.getByRole('button', { name: 'Names' }).click()
  await page.getByPlaceholder('Paste text or Markdown to translate…').fill('Welcome to Hyperfluid')
  await page.getByRole('button', { name: 'Translate' }).click()

  await expect(page.getByText('Guidelines: 1 violation')).toBeVisible()
  await expect(page.getByText('Forbidden pattern found: "Hyperfluide"')).toBeVisible()
  expect(systemPrompts[0]).toContain('<CONTEXT>')
  expect(systemPrompts[0]).toContain('# Hyperfluid')
  expect(systemPrompts[0]).toContain('- Start: Getting started')
  expect(systemPrompts[0]).toContain('1. MUST NOT translate Hyperfluid')
})
