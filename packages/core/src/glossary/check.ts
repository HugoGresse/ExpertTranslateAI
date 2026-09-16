import { wholeTermRe } from '../text/terms.ts'
import type { GlossaryEntry, TermViolation } from '../types.ts'

const compiled = new WeakMap<GlossaryEntry, { source: RegExp | null; target: RegExp | null }>()

function regexes(entry: GlossaryEntry): { source: RegExp | null; target: RegExp | null } {
  const cached = compiled.get(entry)
  if (cached) return cached
  const made = {
    source: entry.source.trim() ? wholeTermRe(entry.source, entry.caseSensitive) : null,
    target: entry.target.trim() ? wholeTermRe(entry.target, entry.caseSensitive) : null,
  }
  compiled.set(entry, made)
  return made
}

const has = (text: string, re: RegExp | null): boolean => re !== null && re.test(text)

export const termRe = wholeTermRe

export function checkEntry(
  source: string,
  target: string,
  entry: GlossaryEntry,
): TermViolation | null {
  const re = regexes(entry)
  if (entry.kind === 'forbidden') {
    if (!has(target, re.target)) return null
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
  if (!has(source, re.source)) return null
  if (entry.kind === 'doNotTranslate') {
    if (has(target, wholeTermRe(entry.source, true))) return null
    return {
      entryId: entry.id,
      kind: entry.kind,
      source: entry.source,
      expected: entry.source,
      severity: 'major',
      explanation: `"${entry.source}" must stay unchanged but does not appear verbatim in the translation`,
    }
  }
  if (re.target === null || has(target, re.target)) return null
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

export const glossaryTargetTerms = (entries: GlossaryEntry[]): string[] =>
  entries
    .map((e) => (e.kind === 'doNotTranslate' ? e.source : e.target))
    .filter((t) => t.trim().length > 0)
