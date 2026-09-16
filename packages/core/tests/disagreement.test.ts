import { describe, expect, it } from 'vitest'
import { decideEscalation, nextDifficulty } from '../src/pipeline/escalation.ts'
import { routeModels } from '../src/pipeline/router.ts'
import { detectDisagreements, formatDisagreements } from '../src/scoring/disagreement.ts'
import type { Candidate, QualityScore, RoleModels } from '../src/types.ts'

const cand = (role: Candidate['role'], text: string): Candidate => ({
  role,
  text,
  chunkIndex: 0,
  model: 'm',
  usage: { promptTokens: 0, completionTokens: 0, costUsd: 0 },
})

describe('detectDisagreements', () => {
  it('returns nothing for a single candidate or identical candidates', () => {
    expect(detectDisagreements([cand('translatorA', 'Bonjour.')], 0)).toEqual([])
    expect(
      detectDisagreements([cand('translatorA', 'Bonjour.'), cand('translatorB', 'Bonjour.')], 0),
    ).toEqual([])
  })

  it('flags numbers, placeholders and glossary terms as high severity', () => {
    const d = detectDisagreements(
      [
        cand('translatorA', 'Il y a 12 apps. Ouvre ⟦PH0⟧. Utilise le flux de travail.'),
        cand('translatorB', 'Il y a 21 apps. Ouvre le menu. Utilise le processus.'),
      ],
      0,
      ['flux de travail'],
    )
    expect(d.map((x) => x.severity)).toEqual(['high', 'high', 'high'])
    expect(d[0]?.reasons).toContain('numbers differ')
    expect(d[1]?.reasons).toContain('placeholders differ')
    expect(d[2]?.reasons).toContain('glossary term "flux de travail" differs')
    expect(d[2]?.variants.translatorB).toBe('Utilise le processus.')
  })

  it('grades wording differences as medium or low', () => {
    const d = detectDisagreements(
      [
        cand('translatorA', 'Cliquez sur le bouton pour continuer.'),
        cand('translatorB', 'Appuyez sur la touche afin de poursuivre.'),
      ],
      0,
    )
    expect(d).toHaveLength(1)
    expect(d[0]?.severity).toBe('medium')
    const low = detectDisagreements(
      [
        cand('translatorA', 'Cliquez sur le bouton pour continuer.'),
        cand('translatorB', 'Cliquez sur le bouton pour continuer maintenant.'),
      ],
      0,
    )
    expect(low.every((x) => x.severity === 'low')).toBe(true)
    expect(formatDisagreements(d)).toContain('translatorB: Appuyez')
  })
})

describe('decideEscalation', () => {
  const score = (confidence: number): QualityScore => ({
    fidelity: 90,
    terminology: 90,
    grammar: 90,
    naturalness: 90,
    register: 90,
    consistency: 90,
    overall: 90,
    confidence,
    notes: [],
  })
  const high = {
    chunkIndex: 1,
    sentenceIndex: 0,
    variants: {},
    similarity: 0.2,
    severity: 'high' as const,
    reasons: [],
  }

  it('escalates the chunks with high disagreement', () => {
    expect(
      decideEscalation({
        difficulty: 'normal',
        chunkCount: 3,
        disagreements: [high],
        score: score(90),
        confidenceThreshold: 60,
        violations: [],
      }),
    ).toEqual({ chunks: [1], reason: 'high-severity disagreement between candidates' })
  })
  it('escalates every chunk on low confidence without disagreements', () => {
    expect(
      decideEscalation({
        difficulty: 'normal',
        chunkCount: 2,
        disagreements: [],
        score: score(40),
        confidenceThreshold: 60,
        violations: [],
      })?.chunks,
    ).toEqual([0, 1])
  })
  it('escalates simple output only on rule violations and never past hard', () => {
    const v = { ruleId: 'r', ruleText: 't', severity: 'major' as const, explanation: 'x' }
    expect(
      decideEscalation({
        difficulty: 'simple',
        chunkCount: 1,
        disagreements: [],
        score: null,
        confidenceThreshold: 60,
        violations: [v],
      })?.reason,
    ).toContain('rule violations')
    expect(
      decideEscalation({
        difficulty: 'simple',
        chunkCount: 1,
        disagreements: [],
        score: null,
        confidenceThreshold: 60,
        violations: [],
      }),
    ).toBeNull()
    expect(
      decideEscalation({
        difficulty: 'hard',
        chunkCount: 1,
        disagreements: [high],
        score: score(10),
        confidenceThreshold: 60,
        violations: [v],
      }),
    ).toBeNull()
    expect(nextDifficulty('normal')).toBe('hard')
    expect(nextDifficulty('hard')).toBeNull()
  })
})

describe('routeModels', () => {
  const base: RoleModels = {
    translatorA: 'a',
    translatorB: 'b',
    translatorC: 'c',
    reviewer: 'r',
    judge: 'j',
    finalizer: 'f',
    scorer: 's',
    helper: 'h',
  }
  it('overrides roles for the matching domain only', () => {
    const routed = routeModels(
      base,
      [
        { domain: 'legal', role: 'translatorA', model: 'legal-a' },
        { domain: 'marketing', role: 'translatorA', model: 'mk-a' },
        { domain: 'legal', role: 'reviewer', model: ' ' },
      ],
      'legal',
    )
    expect(routed.translatorA).toBe('legal-a')
    expect(routed.reviewer).toBe('r')
    expect(routeModels(base, [{ domain: 'legal', role: 'translatorA', model: 'x' }], null)).toEqual(
      base,
    )
  })
})

describe('glossaryTargetTerms', () => {
  it('maps preferred entries to their target rendering and keeps do-not-translate sources', async () => {
    const { glossaryTargetTerms } = await import('../src/glossary/check.ts')
    const base = { scopeId: 'g', lang: 'fr', caseSensitive: false, createdAt: 0 } as const
    expect(
      glossaryTargetTerms([
        { ...base, id: '1', source: 'workflow', target: 'flux de travail', kind: 'preferred' },
        { ...base, id: '2', source: 'Hyperfluid', target: '', kind: 'doNotTranslate' },
        { ...base, id: '3', source: 'dashboard', target: 'tableau de bord', kind: 'forbidden' },
      ]),
    ).toEqual(['flux de travail', 'Hyperfluid', 'tableau de bord'])
  })
})
