import type { ScoreOutput } from '../schemas/pipeline.ts'
import type { Candidate, Issue, QualityScore } from '../types.ts'

const tokens = (text: string): Set<string> =>
  new Set(
    text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((t) => t.length > 1),
  )

export function jaccard(a: string, b: string): number {
  const ta = tokens(a)
  const tb = tokens(b)
  if (ta.size === 0 && tb.size === 0) return 1
  let inter = 0
  for (const t of ta) if (tb.has(t)) inter++
  return inter / (ta.size + tb.size - inter)
}

export function candidateAgreement(candidates: Candidate[]): number {
  const byChunk = new Map<number, Candidate[]>()
  for (const c of candidates) byChunk.set(c.chunkIndex, [...(byChunk.get(c.chunkIndex) ?? []), c])
  const sims: number[] = []
  for (const group of byChunk.values()) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i]
        const b = group[j]
        if (a && b) sims.push(jaccard(a.text, b.text))
      }
    }
  }
  if (sims.length === 0) return 1
  return sims.reduce((x, y) => x + y, 0) / sims.length
}

export const DEFAULT_WEIGHTS = {
  fidelity: 0.3,
  terminology: 0.2,
  grammar: 0.15,
  naturalness: 0.15,
  register: 0.1,
  consistency: 0.1,
}

export function overallScore(s: ScoreOutput, weights = DEFAULT_WEIGHTS): number {
  return Math.round(
    s.fidelity * weights.fidelity +
      s.terminology * weights.terminology +
      s.grammar * weights.grammar +
      s.naturalness * weights.naturalness +
      s.register * weights.register +
      s.consistency * weights.consistency,
  )
}

export function combinedConfidence(input: {
  scorerConfidence: number
  agreement: number
  unresolvedMajor: number
}): number {
  const agreementPart = 40 + 60 * Math.min(1, Math.max(0, input.agreement))
  const penalty = Math.min(40, input.unresolvedMajor * 10)
  return Math.round(
    Math.max(0, Math.min(100, 0.5 * input.scorerConfidence + 0.5 * agreementPart - penalty)),
  )
}

export function buildQualityScore(
  raw: ScoreOutput,
  candidates: Candidate[],
  unresolved: Issue[],
): QualityScore {
  const unresolvedMajor = unresolved.filter((i) => i.severity !== 'minor').length
  return {
    fidelity: raw.fidelity,
    terminology: raw.terminology,
    grammar: raw.grammar,
    naturalness: raw.naturalness,
    register: raw.register,
    consistency: raw.consistency,
    overall: overallScore(raw),
    confidence: combinedConfidence({
      scorerConfidence: raw.confidence,
      agreement: candidateAgreement(candidates),
      unresolvedMajor,
    }),
    notes: raw.notes,
  }
}
