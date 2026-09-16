import { describe, expect, it } from 'vitest'
import { buildTranslatePrompt } from '../src/prompts/translate.ts'

describe('translate prompt', () => {
  const base = {
    sourceLang: 'English',
    target: { lang: 'es', region: 'Mexico' },
    options: { preserveFormatting: true, tone: 'friendly' },
    fullText: 'First part. Second part.',
    materials: {},
  }

  it('single chunk asks for the translation only', () => {
    const prompt = buildTranslatePrompt({ ...base, chunkText: base.fullText, isMultiChunk: false })
    expect(prompt.system).toContain('es as spoken in Mexico')
    expect(prompt.system).toContain('Tone: friendly.')
    expect(prompt.user).toContain('Do not provide any explanations')
    expect(prompt.user).not.toContain('<TRANSLATE_THIS>')
  })

  it('multi chunk wraps the chunk in TRANSLATE_THIS with full context', () => {
    const prompt = buildTranslatePrompt({ ...base, chunkText: 'Second part.', isMultiChunk: true })
    expect(prompt.user).toContain(
      '<SOURCE_TEXT>\nFirst part. <TRANSLATE_THIS>Second part.</TRANSLATE_THIS>\n</SOURCE_TEXT>',
    )
  })

  it('matches snapshot', () => {
    expect(
      buildTranslatePrompt({ ...base, chunkText: base.fullText, isMultiChunk: false }),
    ).toMatchSnapshot()
  })
})
