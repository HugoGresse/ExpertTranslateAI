import { splitSentences } from '../text/sentences.ts'
import type { Candidate, Disagreement, DisagreementSeverity, TranslatorRole } from '../types.ts'
import { jaccard } from './confidence.ts'

export const DISAGREEMENT_SIMILARITY = 0.7

const NUMBER_RE = /\d+(?:[.,]\d+)?/g
const PLACEHOLDER_RE = /⟦PH\d+⟧/g

const sortedMatches = (text: string, re: RegExp): string => (text.match(re) ?? []).sort().join('|')

export function alignSentences(
  candidates: Candidate[],
): Array<Partial<Record<TranslatorRole, string>>> {
  const split = candidates.map((c) => ({ role: c.role, sentences: splitSentences(c.text) }))
  const first = split[0]
  if (!first) return []
  const sameCount = split.every((s) => s.sentences.length === first.sentences.length)
  if (sameCount) {
    return first.sentences.map((_, i) =>
      Object.fromEntries(split.map((s) => [s.role, s.sentences[i] ?? ''])),
    )
  }
  return [Object.fromEntries(split.map((s) => [s.role, s.sentences.join(' ')]))]
}

function classify(
  variants: string[],
  glossaryTerms: string[],
): { severity: DisagreementSeverity; reasons: string[] } {
  const reasons: string[] = []
  const numbers = new Set(variants.map((v) => sortedMatches(v, NUMBER_RE)))
  if (numbers.size > 1) reasons.push('numbers differ')
  const placeholders = new Set(variants.map((v) => sortedMatches(v, PLACEHOLDER_RE)))
  if (placeholders.size > 1) reasons.push('placeholders differ')
  for (const term of glossaryTerms) {
    const present = new Set(variants.map((v) => v.toLowerCase().includes(term.toLowerCase())))
    if (present.size > 1) reasons.push(`glossary term "${term}" differs`)
  }
  if (reasons.length > 0) return { severity: 'high', reasons }
  const contentWords = (v: string): Set<string> =>
    new Set(
      v
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter((w) => w.length > 3),
    )
  const sets = variants.map(contentWords)
  const union = new Set(sets.flatMap((s) => [...s]))
  const shared = [...union].filter((w) => sets.every((s) => s.has(w)))
  if (union.size > 0 && shared.length / union.size < 0.5)
    return { severity: 'medium', reasons: ['content words differ'] }
  return { severity: 'low', reasons: ['wording differs'] }
}

export function detectDisagreements(
  candidates: Candidate[],
  chunkIndex: number,
  glossaryTerms: string[] = [],
): Disagreement[] {
  const group = candidates.filter((c) => c.chunkIndex === chunkIndex)
  if (group.length < 2) return []
  const out: Disagreement[] = []
  alignSentences(group).forEach((variants, sentenceIndex) => {
    const texts = Object.values(variants).filter((v): v is string => typeof v === 'string')
    let minSim = 1
    for (let i = 0; i < texts.length; i++) {
      for (let j = i + 1; j < texts.length; j++) {
        const a = texts[i]
        const b = texts[j]
        if (a !== undefined && b !== undefined) minSim = Math.min(minSim, jaccard(a, b))
      }
    }
    const { severity, reasons } = classify(texts, glossaryTerms)
    if (minSim >= DISAGREEMENT_SIMILARITY && severity !== 'high') return
    out.push({ chunkIndex, sentenceIndex, variants, similarity: minSim, severity, reasons })
  })
  return out
}

export function formatDisagreements(disagreements: Disagreement[]): string {
  if (disagreements.length === 0) return ''
  return disagreements
    .map((d) => {
      const variants = Object.entries(d.variants)
        .map(([role, text]) => `  ${role}: ${text}`)
        .join('\n')
      return `- Sentence ${d.sentenceIndex + 1} (${d.severity}: ${d.reasons.join(', ')}):\n${variants}`
    })
    .join('\n')
}
