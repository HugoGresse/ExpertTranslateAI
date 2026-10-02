import { describe, expect, it } from 'vitest'
import { languageLabel, languageName, languageTag } from '../../src/data/languages'

describe('language labels', () => {
  it('show the ISO code next to the name', () => {
    expect(languageName('nl')).toBe('Dutch (NL)')
    expect(languageName('ca')).toBe('Catalan (CA)')
    expect(languageName('pt-BR')).toBe('Brazilian Portuguese (PT-BR)')
    expect(languageTag('zh-Hans')).toBe('ZH-Hans')
  })

  it('add the region inside the same parentheses and keep unknown codes as typed', () => {
    expect(languageLabel('es', 'Mexico')).toBe('Spanish (ES, Mexico)')
    expect(languageLabel('fr')).toBe('French (FR)')
    expect(languageName('xx')).toBe('xx')
  })
})
