import type {
  Difficulty,
  Disagreement,
  GuidelineViolation,
  QualityScore,
  TermViolation,
} from '../types.ts'

export const DIFFICULTY_ORDER: Difficulty[] = ['simple', 'normal', 'hard', 'critical']

export const nextDifficulty = (d: Difficulty): Difficulty | null => {
  const i = DIFFICULTY_ORDER.indexOf(d)
  return i >= 0 && i < DIFFICULTY_ORDER.length - 2 ? (DIFFICULTY_ORDER[i + 1] ?? null) : null
}

export interface EscalationDecision {
  chunks: number[]
  reason: string
}

export function decideEscalation(input: {
  difficulty: Difficulty
  chunkCount: number
  disagreements: Disagreement[]
  score: QualityScore | null
  confidenceThreshold: number
  violations: Array<GuidelineViolation | TermViolation>
}): EscalationDecision | null {
  if (nextDifficulty(input.difficulty) === null) return null
  const highChunks = [
    ...new Set(input.disagreements.filter((d) => d.severity === 'high').map((d) => d.chunkIndex)),
  ]
  if (highChunks.length > 0)
    return { chunks: highChunks, reason: 'high-severity disagreement between candidates' }
  if (input.score && input.score.confidence < input.confidenceThreshold) {
    const mediumChunks = [
      ...new Set(
        input.disagreements.filter((d) => d.severity === 'medium').map((d) => d.chunkIndex),
      ),
    ]
    const chunks =
      mediumChunks.length > 0 ? mediumChunks : Array.from({ length: input.chunkCount }, (_, i) => i)
    return {
      chunks,
      reason: `confidence ${input.score.confidence} below ${input.confidenceThreshold}`,
    }
  }
  if (input.difficulty === 'simple' && input.violations.length > 0) {
    return {
      chunks: Array.from({ length: input.chunkCount }, (_, i) => i),
      reason: 'rule violations in single-model output',
    }
  }
  return null
}
