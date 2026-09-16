import type { GlossaryEntry, TermViolation } from '../types.ts'

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export const termRe = (term: string, caseSensitive: boolean): RegExp =>
  new RegExp(
    `(?<![\\p{L}\\p{N}])${escapeRe(term.trim())}(?![\\p{L}\\p{N}])`,
    caseSensitive ? 'u' : 'iu',
  )

const has = (text: string, term: string, caseSensitive: boolean): boolean =>
  term.trim().length > 0 && termRe(term, caseSensitive).test(text)

export function checkEntry(
  source: string,
  target: string,
  entry: GlossaryEntry,
): TermViolation | null {
  const inSource = has(source, entry.source, entry.caseSensitive)
  if (entry.kind === 'forbidden') {
    if (!has(target, entry.target, entry.caseSensitive)) return null
    return {
      entryId: entry.id,
      kind: entry.kind,
      source: entry.source,
      expected: `not "${entry.target}"`,
      found: entry.target,
      severity: 'major',
      explanation: `Forbidden rendering "${entry.target}" used for "${entry.source}"`,
    }
  }
  if (!inSource) return null
  if (entry.kind === 'doNotTranslate') {
    if (has(target, entry.source, true)) return null
    return {
      entryId: entry.id,
      kind: entry.kind,
      source: entry.source,
      expected: entry.source,
      severity: 'major',
      explanation: `"${entry.source}" must stay unchanged but does not appear verbatim in the translation`,
    }
  }
  if (has(target, entry.target, entry.caseSensitive)) return null
  return {
    entryId: entry.id,
    kind: entry.kind,
    source: entry.source,
    expected: entry.target,
    severity: 'major',
    explanation: `"${entry.source}" should be rendered as "${entry.target}"`,
  }
}

export function checkTerminology(
  source: string,
  target: string,
  entries: GlossaryEntry[],
): TermViolation[] {
  const out: TermViolation[] = []
  for (const entry of entries) {
    const v = checkEntry(source, target, entry)
    if (v) out.push(v)
  }
  return out
}
