import { expect, test } from '@playwright/test'

const sse = (text: string): string =>
  [
    `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}`,
    `data: ${JSON.stringify({ choices: [{ delta: {} }], usage: { prompt_tokens: 20, completion_tokens: 4, cost: 0.0001 } })}`,
    'data: [DONE]',
    '',
  ].join('\n\n')

test('glossary scope and memory reach the prompt, violations are reported, corrections are learned', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem('eta.openrouter.key', 'sk-or-e2e')
    localStorage.setItem('eta.settings.translatorModel', 'test/model')
    localStorage.setItem('eta.settings.difficulty', 'simple')
    localStorage.setItem('eta.settings.sourceLang', 'en')
    localStorage.setItem('eta.targets', JSON.stringify([{ lang: 'fr' }]))
  })
  const systemPrompts: string[] = []
  await page.route('https://openrouter.ai/api/v1/models', (route) =>
    route.fulfill({ json: { data: [] } }),
  )
  await page.route('https://openrouter.ai/api/v1/chat/completions', (route) => {
    const body = route.request().postDataJSON() as { messages: { role: string; content: string }[] }
    systemPrompts.push(body.messages[0]?.content ?? '')
    return route.fulfill({
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
      body: sse('Ouvre le processus.'),
    })
  })

  await page.goto('/glossary')
  await page.getByLabel('Scope name').fill('Acme')
  await page.getByLabel('Scope level').selectOption('client')
  await page.getByRole('button', { name: 'Add scope' }).click()
  await expect(page.getByRole('heading', { name: /Entries in Acme/ })).toBeVisible()
  await page.getByLabel('Source term').fill('workflow')
  await page.getByLabel('Target rendering').fill('flux de travail')
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(page.getByRole('cell', { name: 'flux de travail' })).toBeVisible()

  await page.goto('/')
  await page.getByRole('button', { name: 'Acme (client)' }).click()
  await page.getByPlaceholder('Paste text or Markdown to translate…').fill('Open the workflow.')
  await page.getByRole('button', { name: 'Translate' }).click()
  await expect(page.getByText('Glossary: 1 violation')).toBeVisible()
  expect(systemPrompts[0]).toContain('<GLOSSARY>\n"workflow" → "flux de travail"')

  const result = page.locator('textarea').nth(1)
  await result.fill('Ouvre le flux de travail.')
  await page.getByRole('button', { name: 'Save as correction' }).click()
  await expect(page.getByText('Saved 1 correction to memory.')).toBeVisible()

  await page.goto('/memory')
  await expect(page.getByText('Ouvre le flux de travail.')).toBeVisible()

  await page.goto('/')
  await page.getByRole('button', { name: 'Translate' }).click()
  await expect(page.getByText(/Memory: 1 exact/)).toBeVisible()
  expect(systemPrompts[1]).toContain(
    'EXACT (reuse verbatim): "Open the workflow." → "Ouvre le flux de travail."',
  )
})
