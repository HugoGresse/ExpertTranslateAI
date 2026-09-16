import { describe, expect, it } from 'vitest'
import { resolveRoleModels } from '../src/job/defaults.ts'
import { noopLogger } from '../src/ports.ts'
import { importBundle, normalizeBundleTables } from '../src/storage/bundle.ts'
import { createMemoryStorage } from './fakes.ts'

describe('resolveRoleModels', () => {
  it('falls back along one chain and treats empty strings as unset', () => {
    expect(resolveRoleModels({ translatorA: 'a', helper: '', reviewer: 'r' })).toEqual({
      translatorA: 'a',
      translatorB: 'a',
      translatorC: 'a',
      reviewer: 'r',
      judge: 'r',
      finalizer: 'a',
      scorer: 'r',
      backTranslator: 'r',
      helper: 'a',
    })
    const m = resolveRoleModels({ translatorA: 'a', translatorB: 'b', helper: 'h' })
    expect(m.translatorC).toBe('b')
    expect(m.backTranslator).toBe('b')
    expect(m.judge).toBe('h')
    expect(m.finalizer).toBe('a')
  })
})

describe('export bundle', () => {
  it('maps legacy web table names and imports well-formed rows only', async () => {
    const storage = createMemoryStorage()
    const counts = await importBundle(
      storage,
      {
        version: 1,
        exportedAt: 0,
        tables: {
          guidelineSets: [{ id: 'g1', name: 'x', rules: [], enabled: true, createdAt: 0 }, 'junk'],
          contextSources: [{ id: 'c1' }],
          results: [{ jobId: 'j', targetKey: 'fr', finalText: 'x' }, { nope: true }],
          bogus: [{ id: 'z' }],
        },
      },
      noopLogger,
    )
    expect(counts.guidelines).toBe(1)
    expect(counts.contexts).toBe(1)
    expect(counts.results).toBe(1)
    expect(await storage.guidelines.get('g1')).toBeDefined()
    expect(await storage.results.get('j', 'fr')).toBeDefined()
    expect(Object.keys(normalizeBundleTables({ bogus: [], tm: [] }))).toEqual(['tm'])
  })
})
