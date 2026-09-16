import { describe, expect, it } from 'vitest'
import { aggregateEvals, issueTotals, markHumanEdit } from '../src/eval/aggregate.ts'
import { targetKey } from '../src/pipeline/targetKey.ts'
import { wordEditDistance } from '../src/text/editDistance.ts'
import type { EvalRecord } from '../src/types.ts'

const rec = (over: Partial<EvalRecord>): EvalRecord => ({
  id: 'j:fr',
  jobId: 'j',
  lang: 'fr',
  createdAt: 0,
  domain: 'general',
  difficulty: 'normal',
  models: {
    translatorA: 'a',
    translatorB: 'b',
    translatorC: 'c',
    reviewer: 'r',
    judge: 'j',
    finalizer: 'f',
    scorer: 's',
    backTranslator: 'bt',
    helper: 'h',
  },
  score: {
    fidelity: 80,
    terminology: 80,
    grammar: 80,
    naturalness: 80,
    register: 80,
    consistency: 80,
    overall: 80,
    confidence: 70,
    notes: [],
  },
  issueCounts: { accuracy: 1 },
  violations: 0,
  disagreements: 0,
  escalated: false,
  costUsd: 0.01,
  calls: 3,
  words: 100,
  promptOverrideHash: 'default',
  humanEdited: false,
  editDistance: null,
  ...over,
})

describe('eval helpers', () => {
  it('aggregates by group with averages, cost per 1k words and rates', () => {
    const rows = aggregateEvals(
      [
        rec({}),
        rec({
          id: 'k',
          score: null,
          escalated: true,
          humanEdited: true,
          costUsd: 0.03,
          words: 100,
        }),
        rec({ id: 'l', models: { ...rec({}).models, translatorA: 'z' } }),
      ],
      'translator',
    )
    expect(rows.map((r) => r.key)).toEqual(['a', 'z'])
    expect(rows[0]).toMatchObject({
      runs: 2,
      avgScore: 80,
      avgConfidence: 70,
      totalUsd: 0.04,
      escalatedRate: 50,
      humanEditRate: 50,
    })
    expect(rows[0]?.costPer1kWords).toBeCloseTo(0.2)
    expect(aggregateEvals([], 'domain')).toEqual([])
  })

  it('tolerates rows missing optional fields', () => {
    // simulates a hand-edited or older backup
    const broken = { id: 'x', jobId: 'x', lang: 'de', createdAt: 0 } as unknown as EvalRecord
    expect(aggregateEvals([broken], 'translator')[0]?.key).toBe('unknown')
    expect(aggregateEvals([broken], 'prompts')[0]?.key).toBe('default')
    expect(issueTotals([broken])).toEqual([])
  })

  it('sums issue categories', () => {
    expect(issueTotals([rec({}), rec({ issueCounts: { accuracy: 2, style: 1 } })])).toEqual([
      ['accuracy', 3],
      ['style', 1],
    ])
  })

  it('computes a word edit distance ignoring surrounding whitespace', () => {
    expect(wordEditDistance('a b c', 'a b c')).toBe(0)
    expect(wordEditDistance('a b c', ' a b c ')).toBe(0)
    expect(wordEditDistance('a b c', 'a x c d')).toBe(2)
    expect(wordEditDistance('', 'x y')).toBe(2)
    expect(markHumanEdit(rec({}), 'a', 'b', 1)).toMatchObject({
      humanEdited: true,
      editDistance: 1,
    })
  })

  it('derives a stable target key with region', () => {
    expect(targetKey({ lang: 'fr' })).toBe('fr')
    expect(targetKey({ lang: 'fr', region: ' Canada ' })).toBe('fr#canada')
  })
})
