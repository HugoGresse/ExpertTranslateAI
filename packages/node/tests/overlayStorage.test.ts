import type { GuidelineSet, StoragePort } from '@experttranslate/core'
import { describe, expect, it } from 'vitest'
import { withInlineMaterials } from '../src/overlayStorage.ts'

const set = (id: string): GuidelineSet => ({ id, name: id, rules: [], enabled: true, createdAt: 0 })

const memoryRepo = <T extends { id: string }>(rows: T[]) => {
  const map = new Map(rows.map((r) => [r.id, r]))
  return {
    get: (id: string) => Promise.resolve(map.get(id)),
    put: (r: T) => {
      map.set(r.id, r)
      return Promise.resolve()
    },
    list: () => Promise.resolve([...map.values()]),
    delete: (id: string) => {
      map.delete(id)
      return Promise.resolve()
    },
  }
}

describe('withInlineMaterials', () => {
  it('serves inline rows first, keeps base rows, and writes through to the base', async () => {
    const guidelines = memoryRepo([set('base'), set('shared')])
    const base = { guidelines } as unknown as StoragePort
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
    await storage.guidelines.put(set('new'))
    expect(await guidelines.get('new')).toBeDefined()
    expect(await guidelines.get('adhoc')).toBeUndefined()
  })
})
