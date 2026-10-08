import { describe, expect, it } from 'vitest'
import {
  LANGUAGES,
  languageLabel,
  languageName,
  languageTag,
  searchLanguages,
} from '../../src/data/languages'

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

describe('language list', () => {
  it('is sorted by code with no duplicates', () => {
    const codes = LANGUAGES.map((l) => l.code)
    expect(codes).toEqual([...codes].sort((a, b) => a.localeCompare(b)))
    expect(new Set(codes).size).toBe(codes.length)
    expect(codes).toContain('sk')
  })
})

describe('searchLanguages', () => {
  const codes = (q: string): string[] => searchLanguages(q).map((l) => l.code)

  it('puts the exact code first, then code and name prefixes', () => {
    expect(codes('sk')[0]).toBe('sk')
    expect(codes('SL').slice(0, 2)).toEqual(['sl', 'sk'])
    expect(codes('pt')).toEqual(['pt', 'pt-BR'])
  })

  it('matches names by prefix, word prefix, then anywhere', () => {
    expect(codes('span')[0]).toBe('es')
    expect(codes('chinese')).toEqual(['zh-Hans', 'zh-Hant'])
    expect(codes('portug')).toEqual(['pt', 'pt-BR'])
  })

  it('returns everything for an empty query and nothing for gibberish', () => {
    expect(searchLanguages('  ')).toHaveLength(LANGUAGES.length)
    expect(searchLanguages('qqq')).toEqual([])
  })
})
