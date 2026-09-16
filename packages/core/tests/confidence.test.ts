import { describe, expect, it } from 'vitest'
import {
  buildQualityScore,
  candidateAgreement,
  combinedConfidence,
  jaccard,
  overallScore,
} from '../src/scoring/confidence.ts'
import type { Candidate } from '../src/types.ts'

const cand = (role: Candidate['role'], text: string, chunkIndex = 0): Candidate => ({
  role,
  text,
  chunkIndex,
  model: 'm',
  usage: { promptTokens: 0, completionTokens: 0, costUsd: 0 },
})

describe('confidence', () => {
  it('computes jaccard similarity on word sets', () => {
    expect(jaccard('bonjour le monde', 'bonjour le monde')).toBe(1)
    expect(jaccard('bonjour le monde', 'salut tout le monde')).toBeCloseTo(2 / 5)
  })

  it('averages agreement across candidate pairs per chunk', () => {
    expect(candidateAgreement([cand('translatorA', 'a b c')])).toBe(1)
    expect(
      candidateAgreement([cand('translatorA', 'aa bb cc'), cand('translatorB', 'aa bb cc')]),
    ).toBe(1)
    expect(candidateAgreement([cand('translatorA', 'aa bb'), cand('translatorB', 'cc dd')])).toBe(0)
  })

  it('weights the overall score and penalises unresolved issues', () => {
    const raw = {
      fidelity: 90,
      terminology: 80,
      grammar: 100,
      naturalness: 70,
      register: 60,
      consistency: 50,
      confidence: 80,
      notes: [],
    }
    expect(overallScore(raw)).toBe(80)
    expect(combinedConfidence({ scorerConfidence: 80, agreement: 1, unresolvedMajor: 0 })).toBe(90)
    expect(combinedConfidence({ scorerConfidence: 80, agreement: 0, unresolvedMajor: 2 })).toBe(40)
    const score = buildQualityScore(
      raw,
      [cand('translatorA', 'x y'), cand('translatorB', 'x y')],
      [],
    )
    expect(score.overall).toBe(80)
    expect(score.confidence).toBe(90)
  })
})
