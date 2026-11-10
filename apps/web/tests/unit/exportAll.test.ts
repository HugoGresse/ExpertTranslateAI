import type { TargetResult } from '@experttranslate/core'
import { describe, expect, it } from 'vitest'
import { buildExport } from '../../src/lib/exportAll'

const result = (targetKey: string, lang: string, finalText: string, region?: string) =>
  ({
    targetKey,
    lang,
    region,
    finalText,
    sourceLang: 'en',
    sourceText: 'Hello',
  }) as TargetResult

const results = [result('fr', 'fr', 'Bonjour\n'), result('es-MX', 'es', 'Hola', 'Mexico')]

describe('buildExport', () => {
  it('writes every language under its own header in txt', () => {
    const file = buildExport(results, 'txt')
    expect(file.filename).toBe('translations.txt')
    expect(file.type).toContain('text/plain')
    expect(file.text).toBe(
      '=== French (FR) ===\n\nBonjour\n\n\n=== Spanish (ES, Mexico) ===\n\nHola\n',
    )
  })

  it('writes source and translations in json', () => {
    const file = buildExport(results, 'json')
    expect(file.filename).toBe('translations.json')
    expect(JSON.parse(file.text)).toEqual({
      sourceLang: 'en',
      sourceText: 'Hello',
      translations: [
        { lang: 'fr', region: null, language: 'French (FR)', text: 'Bonjour\n' },
        {
          lang: 'es',
          region: 'Mexico',
          language: 'Spanish (ES, Mexico)',
          text: 'Hola',
        },
      ],
    })
  })
})
