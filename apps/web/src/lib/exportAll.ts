import type { TargetResult } from '@experttranslate/core'
import { languageLabel } from '../data/languages'

export const EXPORT_FORMATS = ['txt', 'json'] as const
export type ExportFormat = (typeof EXPORT_FORMATS)[number]

export interface ExportFile {
  filename: string
  text: string
  type: string
}

const label = (r: TargetResult): string => languageLabel(r.lang, r.region)

const toTxt = (results: TargetResult[]): string =>
  `${results.map((r) => `=== ${label(r)} ===\n\n${r.finalText.trim()}`).join('\n\n\n')}\n`

const toJson = (results: TargetResult[]): string =>
  `${JSON.stringify(
    {
      sourceLang: results[0]?.sourceLang ?? null,
      sourceText: results[0]?.sourceText ?? '',
      translations: results.map((r) => ({
        lang: r.lang,
        region: r.region ?? null,
        language: label(r),
        text: r.finalText,
      })),
    },
    null,
    2,
  )}\n`

/** Every finished translation of a run in one file, in tab order. */
export function buildExport(results: TargetResult[], format: ExportFormat): ExportFile {
  return format === 'json'
    ? {
        filename: 'translations.json',
        text: toJson(results),
        type: 'application/json;charset=utf-8',
      }
    : { filename: 'translations.txt', text: toTxt(results), type: 'text/plain;charset=utf-8' }
}
