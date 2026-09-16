import { normalizeSentence, splitSentences } from '../text/sentences.ts'
import type { MemoryHit, TmEntry } from '../types.ts'

export const FUZZY_THRESHOLD = 0.85

const trigrams = (text: string): Set<string> => {
  const padded = `  ${text} `
  const out = new Set<string>()
  for (let i = 0; i + 3 <= padded.length; i++) out.add(padded.slice(i, i + 3))
  return out
}

export const trigramSimilarity = (a: string, b: string): number =>
  setSimilarity(trigrams(a), trigrams(b))

export interface MemoryMatches {
  exact: MemoryHit[]
  fuzzy: MemoryHit[]
}

interface Indexed {
  entry: TmEntry
  norm: string
  grams: Set<string>
}

function indexEntries(entries: TmEntry[]): {
  byNormalized: Map<string, TmEntry>
  indexed: Indexed[]
} {
  const byNormalized = new Map<string, TmEntry>()
  const indexed: Indexed[] = []
  for (const entry of entries) {
    const norm = normalizeSentence(entry.source)
    const current = byNormalized.get(norm)
    if (!current || entry.createdAt > current.createdAt) byNormalized.set(norm, entry)
    indexed.push({ entry, norm, grams: trigrams(norm) })
  }
  return { byNormalized, indexed }
}

const setSimilarity = (a: Set<string>, b: Set<string>): number => {
  if (a.size === 0 && b.size === 0) return 1
  let inter = 0
  for (const t of a) if (b.has(t)) inter++
  return inter / (a.size + b.size - inter)
}

export function matchMemory(
  sourceText: string,
  entries: TmEntry[],
  sourceLang: string | null,
  targetLang: string,
): MemoryMatches {
  if (sourceLang === null) return { exact: [], fuzzy: [] }
  const candidates = entries.filter(
    (e) => e.targetLang === targetLang && e.sourceLang === sourceLang,
  )
  if (candidates.length === 0) return { exact: [], fuzzy: [] }
  const { byNormalized, indexed } = indexEntries(candidates)
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
    const grams = trigrams(norm)
    let best: { entry: TmEntry; score: number } | null = null
    for (const item of indexed) {
      const score = setSimilarity(grams, item.grams)
      if (
        score >= FUZZY_THRESHOLD &&
        (!best ||
          score > best.score ||
          (score === best.score && item.entry.createdAt > best.entry.createdAt))
      )
        best = { entry: item.entry, score }
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
