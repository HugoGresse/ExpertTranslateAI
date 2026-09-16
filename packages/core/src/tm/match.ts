import { normalizeSentence, splitSentences } from '../text/sentences.ts'
import type { MemoryHit, TmEntry } from '../types.ts'

export const FUZZY_THRESHOLD = 0.85

const trigrams = (text: string): Set<string> => {
  const padded = `  ${text} `
  const out = new Set<string>()
  for (let i = 0; i + 3 <= padded.length; i++) out.add(padded.slice(i, i + 3))
  return out
}

export function trigramSimilarity(a: string, b: string): number {
  const ta = trigrams(a)
  const tb = trigrams(b)
  if (ta.size === 0 && tb.size === 0) return 1
  let inter = 0
  for (const t of ta) if (tb.has(t)) inter++
  return inter / (ta.size + tb.size - inter)
}

export interface MemoryMatches {
  exact: MemoryHit[]
  fuzzy: MemoryHit[]
}

export function matchMemory(
  sourceText: string,
  entries: TmEntry[],
  sourceLang: string | null,
  targetLang: string,
): MemoryMatches {
  const candidates = entries.filter(
    (e) => e.targetLang === targetLang && (sourceLang === null || e.sourceLang === sourceLang),
  )
  if (candidates.length === 0) return { exact: [], fuzzy: [] }
  const byNormalized = new Map<string, TmEntry>()
  for (const e of candidates) byNormalized.set(normalizeSentence(e.source), e)
  const exact: MemoryHit[] = []
  const fuzzy: MemoryHit[] = []
  const seen = new Set<string>()
  for (const sentence of splitSentences(sourceText)) {
    const norm = normalizeSentence(sentence)
    if (norm.length === 0 || seen.has(norm)) continue
    seen.add(norm)
    const direct = byNormalized.get(norm)
    if (direct) {
      exact.push({ source: sentence, target: direct.target, similarity: 1, entryId: direct.id })
      continue
    }
    let best: { entry: TmEntry; score: number } | null = null
    for (const entry of candidates) {
      const score = trigramSimilarity(norm, normalizeSentence(entry.source))
      if (score >= FUZZY_THRESHOLD && (!best || score > best.score)) best = { entry, score }
    }
    if (best)
      fuzzy.push({
        source: sentence,
        target: best.entry.target,
        similarity: best.score,
        entryId: best.entry.id,
      })
  }
  return { exact, fuzzy }
}

export function formatMemoryBlock(matches: MemoryMatches): string {
  if (matches.exact.length === 0 && matches.fuzzy.length === 0) return ''
  const lines = ['<MEMORY>']
  for (const hit of matches.exact)
    lines.push(`EXACT (reuse verbatim): "${hit.source}" → "${hit.target}"`)
  for (const hit of matches.fuzzy) {
    lines.push(
      `SIMILAR (${Math.round(hit.similarity * 100)}%, adapt wording): "${hit.source}" → "${hit.target}"`,
    )
  }
  lines.push('</MEMORY>')
  return lines.join('\n')
}
