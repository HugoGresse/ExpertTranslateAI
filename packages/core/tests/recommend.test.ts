import { describe, expect, it } from 'vitest'
import { recommendModels } from '../src/models/recommend.ts'
import type { ModelInfo } from '../src/types.ts'

const m = (id: string, out: number): ModelInfo => ({
  id,
  name: id,
  contextLength: 100000,
  pricing: { promptUsdPerToken: out / 4e6, completionUsdPerToken: out / 1e6 },
  supportsStructuredOutput: true,
})

const catalog = [
  m('anthropic/claude-opus-4.6', 25),
  m('anthropic/claude-sonnet-4.5', 15),
  m('anthropic/claude-haiku-4.5', 5),
  m('openai/gpt-5', 10),
  m('openai/gpt-5-mini', 2),
  m('google/gemini-2.5-pro', 10),
  m('google/gemini-2.5-flash', 2.5),
  m('google/gemini-2.5-flash-lite', 0.4),
  m('deepseek/deepseek-v4-flash', 0.3),
  m('meta-llama/llama-3-8b:free', 0),
  m('some/unknown-model', 0.1),
]

describe('recommendModels', () => {
  it('picks strong translators from different families and cheap helpers', () => {
    const { models, reasons } = recommendModels(catalog, 'balanced')
    expect(['anthropic/claude-sonnet-4.5', 'openai/gpt-5']).toContain(models.translatorA)
    expect(models.translatorB.split('/')[0]).not.toBe(models.translatorA.split('/')[0])
    expect(new Set([models.translatorA, models.translatorB, models.translatorC]).size).toBe(3)
    expect(models.helper).toBe('deepseek/deepseek-v4-flash')
    expect(models.scorer).toBe('deepseek/deepseek-v4-flash')
    expect(reasons.translatorA).toContain('quality 92')
    expect(Object.values(models)).not.toContain('meta-llama/llama-3-8b:free')
  })

  it('respects the preset ceilings', () => {
    const economy = recommendModels(catalog, 'economy')
    expect(economy.models.translatorA).toBe('deepseek/deepseek-v4-flash')
    const best = recommendModels(catalog, 'best')
    expect(best.models.translatorA).toBe('anthropic/claude-opus-4.6')
    expect(best.models.reviewer.split('/')[0]).not.toBe('anthropic')
  })

  it('falls back sanely on a tiny catalog', () => {
    const { models } = recommendModels([m('x/only', 1)], 'balanced')
    expect(models.translatorA).toBe('x/only')
    expect(models.helper).toBe('x/only')
    expect(() => recommendModels([], 'balanced')).toThrow()
  })
})
