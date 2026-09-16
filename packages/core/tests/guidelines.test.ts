import { describe, expect, it } from 'vitest'
import { checkGuidelines, isCheckable } from '../src/guidelines/check.ts'
import { normalizeRules } from '../src/guidelines/extract.ts'
import { activeGuidelineSets, formatGuidelinesBlock } from '../src/guidelines/format.ts'
import type { GuidelineSet } from '../src/types.ts'

const sets: GuidelineSet[] = [
  {
    id: 's1',
    name: 'Product',
    enabled: true,
    createdAt: 0,
    rules: [
      {
        id: 'r1',
        text: 'Keep product names in English',
        kind: 'must-not',
        pattern: 'Hyperfluide|Bifrost\\s*pont',
      },
      {
        id: 'r2',
        text: 'Use the informal "tu" form',
        kind: 'prefer',
        examples: { good: 'Tu peux', bad: 'Vous pouvez' },
      },
      { id: 'r3', text: 'Mention the CLI name hfctl', kind: 'must', pattern: 'hfctl' },
    ],
  },
  {
    id: 's2',
    name: 'German only',
    enabled: true,
    lang: 'de',
    createdAt: 0,
    rules: [],
    freeText: 'Use Sie.',
  },
  {
    id: 's3',
    name: 'Disabled',
    enabled: false,
    createdAt: 0,
    rules: [{ id: 'r9', text: 'x', kind: 'must' }],
  },
]

describe('guidelines', () => {
  it('filters sets by enabled flag and language', () => {
    expect(activeGuidelineSets(sets, 'fr').map((s) => s.id)).toEqual(['s1'])
    expect(activeGuidelineSets(sets, 'de').map((s) => s.id)).toEqual(['s1', 's2'])
  })

  it('formats a numbered block with examples and free text', () => {
    expect(formatGuidelinesBlock(activeGuidelineSets(sets, 'de'))).toMatchSnapshot()
    expect(formatGuidelinesBlock([])).toBe('')
  })

  it('checks must-not and must patterns', () => {
    const violations = checkGuidelines('Bienvenue sur Hyperfluide. Lance la commande.', [
      sets[0] as GuidelineSet,
    ])
    expect(violations.map((v) => v.ruleId)).toEqual(['r1', 'r3'])
    expect(violations[0]?.targetSpan).toBe('Hyperfluide')
    expect(
      checkGuidelines('Bienvenue sur Hyperfluid. Lance hfctl.', [sets[0] as GuidelineSet]),
    ).toEqual([])
  })

  it('checks keep rules against the source text', () => {
    const keep: GuidelineSet = {
      id: 'k',
      name: 'Keep',
      enabled: true,
      createdAt: 0,
      rules: [
        { id: 'k1', text: 'Keep the product name', kind: 'keep', pattern: '\\bHyperfluid\\b' },
      ],
    }
    expect(
      checkGuidelines('Bienvenue sur Hyperfluide', [keep], 'Welcome to Hyperfluid'),
    ).toHaveLength(1)
    expect(checkGuidelines('Bienvenue sur Hyperfluid', [keep], 'Welcome to Hyperfluid')).toEqual([])
    expect(checkGuidelines('Bonjour', [keep], 'Hello')).toEqual([])
    expect(checkGuidelines('Bonjour', [keep])).toEqual([])
  })

  it('only strips a leading verb that agrees with the rule kind', () => {
    const line = (kind: GuidelineSet['rules'][number]['kind'], text: string): string =>
      formatGuidelinesBlock([
        { id: 'x', name: 'X', enabled: true, createdAt: 0, rules: [{ id: 'r', text, kind }] },
      ]).split('\n')[1] ?? ''
    expect(line('must', 'Never translate Hyperfluid')).toBe('1. MUST Never translate Hyperfluid')
    expect(line('must-not', 'Never translate Hyperfluid')).toBe('1. MUST NOT translate Hyperfluid')
    expect(line('prefer', 'Avoid anglicisms')).toBe('1. PREFER Avoid anglicisms')
    expect(line('must', 'Always use the tu form')).toBe('1. MUST use the tu form')
  })

  it('reports checkability', () => {
    const rules = sets[0]?.rules ?? []
    expect(rules.map(isCheckable)).toEqual([true, false, true])
  })

  it('normalizes extracted rules defensively', () => {
    let n = 0
    const rules = normalizeRules(
      [
        { text: 'Never translate Bifrost', kind: 'must-not', pattern: 'Bifröst' },
        { text: 'Be concise', kind: 'weird', examples: { good: 'Short.' } },
        { text: '' },
        'junk',
      ],
      () => `id${++n}`,
    )
    expect(rules).toEqual([
      { id: 'id1', text: 'Never translate Bifrost', kind: 'must-not', pattern: 'Bifröst' },
      { id: 'id2', text: 'Be concise', kind: 'prefer', examples: { good: 'Short.' } },
    ])
  })
})
