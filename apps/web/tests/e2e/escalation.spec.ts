import { expect, test } from '@playwright/test'
import { sse } from './helpers'

const brief = JSON.stringify({
  detectedLang: 'en',
  domain: 'legal',
  difficulty: 'normal',
  summary: 'Contract',
  tone: '',
  audience: '',
  keyTerms: [],
  risks: [],
})

test('candidate disagreement escalates normal to hard and routing picks the legal model', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem('eta.openrouter.key', 'sk-or-e2e')
    localStorage.setItem('eta.settings.translatorModel', 'test/model')
    localStorage.setItem('eta.settings.translatorBModel', 'test/model-b')
    localStorage.setItem('eta.settings.translatorCModel', 'test/model-c')
    localStorage.setItem('eta.settings.reviewerModel', 'test/reviewer')
    localStorage.setItem('eta.settings.judgeModel', 'test/judge')
    localStorage.setItem('eta.settings.finalizerModel', 'test/finalizer')
    localStorage.setItem('eta.settings.scorerModel', 'test/scorer')
    localStorage.setItem('eta.settings.helperModel', 'test/helper')
    localStorage.setItem('eta.settings.difficulty', 'auto')
    localStorage.setItem('eta.settings.autoEscalate', 'true')
    localStorage.setItem(
      'eta.routing',
      JSON.stringify([{ domain: 'legal', role: 'translatorA', model: 'legal/model' }]),
    )
    localStorage.setItem('eta.targets', JSON.stringify([{ lang: 'fr' }]))
  })
  const models: string[] = []
  await page.route('https://openrouter.ai/api/v1/models', (route) =>
    route.fulfill({ json: { data: [] } }),
  )
  await page.route('https://openrouter.ai/api/v1/chat/completions', (route) => {
    const body = route.request().postDataJSON() as {
      model: string
      messages: { content: string }[]
    }
    models.push(body.model)
    const replies: Record<string, string> = {
      'test/helper': body.messages[0]?.content.includes('terminologist') ? '[]' : brief,
      'legal/model': 'Il y a 12 clauses.',
      'test/model-b': 'Il y a 21 clauses.',
      'test/model-c': 'Il y a 12 clauses.',
      'test/reviewer': body.messages[0]?.content.includes('audit')
        ? '{"violations": []}'
        : JSON.stringify({ issues: [], suggestions: [], preferred: 'translatorA' }),
      'test/judge': JSON.stringify({
        winner: 'translatorA',
        rationale: 'A matches the source number.',
      }),
      'test/finalizer': 'Il y a 12 clauses.',
      'test/scorer': JSON.stringify({
        fidelity: 95,
        terminology: 95,
        grammar: 95,
        naturalness: 95,
        register: 95,
        consistency: 95,
        confidence: 80,
        notes: [],
      }),
    }
    return route.fulfill({
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
      body: sse(replies[body.model] ?? 'x'),
    })
  })

  await page.goto('/')
  await page.getByPlaceholder('Paste text or Markdown to translate…').fill('There are 12 clauses.')
  await page.getByRole('button', { name: 'Translate' }).click()
  await expect(page.locator('textarea').nth(1)).toHaveValue('Il y a 12 clauses.')
  await expect(page.getByText(/escalated normal → hard/)).toBeVisible()
  await page.getByRole('button', { name: /Show disagreements/ }).click()
  await expect(page.getByText('numbers differ')).toBeVisible()
  expect(models.filter((m) => m === 'legal/model')).toHaveLength(2)
  expect(models).toContain('test/model-c')
  expect(models).toContain('test/judge')
})
