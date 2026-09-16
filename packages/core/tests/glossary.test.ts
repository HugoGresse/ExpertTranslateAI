import { describe, expect, it } from 'vitest'
import { checkTerminology } from '../src/glossary/check.ts'
import { formatGlossaryBlock } from '../src/glossary/format.ts'
import { expandScopeIds, resolveGlossary } from '../src/glossary/resolve.ts'
import type { GlossaryEntry, GlossaryScope } from '../src/types.ts'

const scopes: GlossaryScope[] = [
  { id: 'g', level: 'global', name: 'Global', createdAt: 0 },
  { id: 'fr', level: 'language', name: 'French', lang: 'fr', parentId: 'g', createdAt: 0 },
  { id: 'acme', level: 'client', name: 'Acme', parentId: 'fr', createdAt: 0 },
  { id: 'doc', level: 'document', name: 'Doc', parentId: 'acme', createdAt: 0 },
]

const entry = (
  id: string,
  scopeId: string,
  source: string,
  target: string,
  kind: GlossaryEntry['kind'] = 'preferred',
): GlossaryEntry => ({
  id,
  scopeId,
  source,
  target,
  lang: 'fr',
  kind,
  caseSensitive: false,
  createdAt: 0,
})

const entries: GlossaryEntry[] = [
  entry('e1', 'g', 'workflow', 'processus'),
  entry('e2', 'fr', 'workflow', 'flux de travail'),
  entry('e3', 'doc', 'workflow', 'workflow'),
  entry('e4', 'acme', 'dashboard', 'tableau de bord', 'forbidden'),
  entry('e5', 'g', 'Hyperfluid', '', 'doNotTranslate'),
  { ...entry('e6', 'g', 'deployment', 'Bereitstellung'), lang: 'de' },
]

describe('resolveGlossary', () => {
  it('expands selected scopes to their ancestors', () => {
    expect([...expandScopeIds(scopes, ['doc'])].sort()).toEqual(['acme', 'doc', 'fr', 'g'])
  })

  it('lets the most specific scope win and keeps forbidden entries separately', () => {
    const resolved = resolveGlossary(scopes, entries, ['doc'], 'fr')
    expect(resolved.map((e) => e.id).sort()).toEqual(['e3', 'e4', 'e5'])
    const client = resolveGlossary(scopes, entries, ['acme'], 'fr')
    expect(client.find((e) => e.source === 'workflow')?.id).toBe('e2')
  })

  it('filters by target language but keeps do-not-translate entries', () => {
    const de = resolveGlossary(scopes, entries, ['g'], 'de')
    expect(de.map((e) => e.id).sort()).toEqual(['e5', 'e6'])
  })

  it('formats a glossary block', () => {
    expect(formatGlossaryBlock(resolveGlossary(scopes, entries, ['doc'], 'fr'))).toMatchSnapshot()
    expect(formatGlossaryBlock([])).toBe('')
  })
})

describe('checkTerminology', () => {
  const resolved = resolveGlossary(scopes, entries, ['acme'], 'fr')

  it('flags a missing preferred rendering, forbidden term and altered do-not-translate term', () => {
    const source = 'Open the workflow dashboard in Hyperfluid.'
    const bad = 'Ouvre le processus dans le tableau de bord Hyperfluide.'
    const report = checkTerminology(source, bad, resolved)
    expect(report.map((v) => v.kind).sort()).toEqual(['doNotTranslate', 'forbidden', 'preferred'])
    const good = 'Ouvre le flux de travail dans le dashboard Hyperfluid.'
    expect(checkTerminology(source, good, resolved)).toEqual([])
  })

  it('ignores entries whose source term is absent and respects word boundaries', () => {
    expect(checkTerminology('Nothing here', 'Rien ici', resolved)).toEqual([])
    expect(checkTerminology('workflows', 'processus', resolved)).toEqual([])
  })
})
