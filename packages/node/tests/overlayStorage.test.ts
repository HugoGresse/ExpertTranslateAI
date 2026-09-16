import type { GuidelineSet } from '@experttranslate/core'
import { createMemoryStorage } from '@experttranslate/core/testing'
import { describe, expect, it } from 'vitest'
import { withInlineMaterials } from '../src/overlayStorage.ts'

const set = (id: string): GuidelineSet => ({ id, name: id, rules: [], enabled: true, createdAt: 0 })

describe('withInlineMaterials', () => {
  it('serves inline rows first, keeps base rows, and keeps writes off the base store', async () => {
    const base = createMemoryStorage()
    await base.guidelines.put(set('base'))
    await base.guidelines.put(set('shared'))
    const storage = withInlineMaterials(base, {
      guidelines: [{ ...set('shared'), name: 'inline' }, set('adhoc')],
    })
    expect((await storage.guidelines.get('shared'))?.name).toBe('inline')
    expect((await storage.guidelines.get('base'))?.id).toBe('base')
    expect((await storage.guidelines.list()).map((g) => g.id).sort()).toEqual([
      'adhoc',
      'base',
      'shared',
    ])
    await storage.guidelines.put({ ...set('adhoc'), name: 'updated' })
    expect((await storage.guidelines.get('adhoc'))?.name).toBe('updated')
    expect(await base.guidelines.get('adhoc')).toBeUndefined()
    await storage.jobs.put({
      ...(await import('@experttranslate/core/testing')).sampleJob(),
      id: 'j',
    })
    expect(await base.jobs.get('j')).toBeDefined()
  })
})
