export const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export const wholeTermRe = (term: string, caseSensitive: boolean): RegExp =>
  new RegExp(
    `(?<![\\p{L}\\p{N}])${escapeRe(term.trim())}(?![\\p{L}\\p{N}])`,
    caseSensitive ? 'u' : 'iu',
  )
