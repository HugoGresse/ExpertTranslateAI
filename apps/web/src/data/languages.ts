export interface LanguageOption {
  code: string
  name: string
}

const byCode = (a: LanguageOption, b: LanguageOption): number => a.code.localeCompare(b.code)

/** Every language the pickers offer, sorted by code. */
export const LANGUAGES: LanguageOption[] = [
  { code: 'af', name: 'Afrikaans' },
  { code: 'am', name: 'Amharic' },
  { code: 'ar', name: 'Arabic' },
  { code: 'az', name: 'Azerbaijani' },
  { code: 'be', name: 'Belarusian' },
  { code: 'bg', name: 'Bulgarian' },
  { code: 'bn', name: 'Bengali' },
  { code: 'bs', name: 'Bosnian' },
  { code: 'ca', name: 'Catalan' },
  { code: 'cs', name: 'Czech' },
  { code: 'cy', name: 'Welsh' },
  { code: 'da', name: 'Danish' },
  { code: 'de', name: 'German' },
  { code: 'el', name: 'Greek' },
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Spanish' },
  { code: 'et', name: 'Estonian' },
  { code: 'eu', name: 'Basque' },
  { code: 'fa', name: 'Persian' },
  { code: 'fi', name: 'Finnish' },
  { code: 'fil', name: 'Filipino' },
  { code: 'fr', name: 'French' },
  { code: 'ga', name: 'Irish' },
  { code: 'gl', name: 'Galician' },
  { code: 'gu', name: 'Gujarati' },
  { code: 'ha', name: 'Hausa' },
  { code: 'he', name: 'Hebrew' },
  { code: 'hi', name: 'Hindi' },
  { code: 'hr', name: 'Croatian' },
  { code: 'hu', name: 'Hungarian' },
  { code: 'hy', name: 'Armenian' },
  { code: 'id', name: 'Indonesian' },
  { code: 'is', name: 'Icelandic' },
  { code: 'it', name: 'Italian' },
  { code: 'ja', name: 'Japanese' },
  { code: 'ka', name: 'Georgian' },
  { code: 'kk', name: 'Kazakh' },
  { code: 'km', name: 'Khmer' },
  { code: 'kn', name: 'Kannada' },
  { code: 'ko', name: 'Korean' },
  { code: 'lb', name: 'Luxembourgish' },
  { code: 'lo', name: 'Lao' },
  { code: 'lt', name: 'Lithuanian' },
  { code: 'lv', name: 'Latvian' },
  { code: 'mk', name: 'Macedonian' },
  { code: 'ml', name: 'Malayalam' },
  { code: 'mn', name: 'Mongolian' },
  { code: 'mr', name: 'Marathi' },
  { code: 'ms', name: 'Malay' },
  { code: 'mt', name: 'Maltese' },
  { code: 'my', name: 'Burmese' },
  { code: 'nb', name: 'Norwegian' },
  { code: 'ne', name: 'Nepali' },
  { code: 'nl', name: 'Dutch' },
  { code: 'pa', name: 'Punjabi' },
  { code: 'pl', name: 'Polish' },
  { code: 'ps', name: 'Pashto' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'pt-BR', name: 'Brazilian Portuguese' },
  { code: 'ro', name: 'Romanian' },
  { code: 'ru', name: 'Russian' },
  { code: 'si', name: 'Sinhala' },
  { code: 'sk', name: 'Slovak' },
  { code: 'sl', name: 'Slovenian' },
  { code: 'so', name: 'Somali' },
  { code: 'sq', name: 'Albanian' },
  { code: 'sr', name: 'Serbian' },
  { code: 'sv', name: 'Swedish' },
  { code: 'sw', name: 'Swahili' },
  { code: 'ta', name: 'Tamil' },
  { code: 'te', name: 'Telugu' },
  { code: 'th', name: 'Thai' },
  { code: 'tr', name: 'Turkish' },
  { code: 'uk', name: 'Ukrainian' },
  { code: 'ur', name: 'Urdu' },
  { code: 'uz', name: 'Uzbek' },
  { code: 'vi', name: 'Vietnamese' },
  { code: 'xh', name: 'Xhosa' },
  { code: 'yo', name: 'Yoruba' },
  { code: 'zh-Hans', name: 'Simplified Chinese' },
  { code: 'zh-Hant', name: 'Traditional Chinese' },
  { code: 'zu', name: 'Zulu' },
].sort(byCode)

export const RTL_LANGS = new Set(['ar', 'fa', 'he', 'ps', 'ur'])

export const textDirection = (code: string): 'rtl' | 'ltr' =>
  RTL_LANGS.has(code.split('-')[0] ?? code) ? 'rtl' : 'ltr'

/** The code as shown to people: `nl` → `NL`, `pt-BR` → `PT-BR`, `zh-Hans` keeps its script casing. */
export const languageTag = (code: string): string =>
  code
    .split('-')
    .map((part, i) => (i === 0 || part.length === 2 ? part.toUpperCase() : part))
    .join('-')

const baseName = (code: string): string => LANGUAGES.find((l) => l.code === code)?.name ?? code

/** `Dutch (NL)`; an unknown code shows as itself. */
export const languageName = (code: string): string => {
  const name = baseName(code)
  return name === code ? code : `${name} (${languageTag(code)})`
}

/** `Spanish (ES, Mexico)` for a target with a region, otherwise the same as `languageName`. */
export const languageLabel = (code: string, region?: string): string =>
  region ? `${baseName(code)} (${languageTag(code)}, ${region})` : languageName(code)

const RANKS: ((l: LanguageOption, q: string) => boolean)[] = [
  (l, q) => l.code.toLowerCase() === q,
  (l, q) => l.code.toLowerCase().startsWith(q),
  (l, q) => l.name.toLowerCase().startsWith(q),
  (l, q) =>
    l.name
      .toLowerCase()
      .split(/\s+/)
      .some((word) => word.startsWith(q)),
  (l, q) => l.name.toLowerCase().includes(q),
]

/**
 * Languages matching what someone typed, best match first: exact code, code prefix, name prefix,
 * word prefix, then anywhere in the name. Ties keep code order; an empty query returns everything.
 */
export const searchLanguages = (
  query: string,
  options: LanguageOption[] = LANGUAGES,
): LanguageOption[] => {
  const q = query.trim().toLowerCase()
  if (!q) return options
  const rank = (l: LanguageOption): number => RANKS.findIndex((matches) => matches(l, q))
  return options
    .map((l) => ({ l, r: rank(l) }))
    .filter(({ r }) => r >= 0)
    .sort((a, b) => a.r - b.r)
    .map(({ l }) => l)
}
