import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { noopLogger, type TargetResult, type TmEntry } from '@experttranslate/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createJsonStorage } from '../src/jsonStorage.ts'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'eta-'))
})
afterEach(() => rm(dir, { recursive: true, force: true }))

const entry = (id: string): TmEntry => ({
  id,
  sourceLang: 'en',
  targetLang: 'fr',
  source: 'hello',
  target: 'bonjour',
  origin: 'human-correction',
  createdAt: 1,
})

describe('json storage', () => {
  it('persists rows across instances and deletes by id', async () => {
    const a = createJsonStorage(dir, noopLogger)
    await a.tm.put(entry('t1'))
    await a.tm.put(entry('t2'))
    await a.tm.delete('t1')
    const b = createJsonStorage(dir, noopLogger)
    expect((await b.tm.list()).map((e) => e.id)).toEqual(['t2'])
    expect(JSON.parse(await readFile(join(dir, 'tm.json'), 'utf8'))).toHaveLength(1)
  })

  it('keys results by job and target and deletes them per job', async () => {
    const s = createJsonStorage(dir, noopLogger)
    const result = (jobId: string, targetKey: string): TargetResult =>
      ({ jobId, lang: 'fr', targetKey, finalText: targetKey }) as TargetResult
    await s.results.put(result('j1', 'fr'))
    await s.results.put(result('j1', 'fr#canada'))
    await s.results.put(result('j2', 'fr'))
    expect((await s.results.listByJob('j1')).map((r) => r.targetKey).sort()).toEqual([
      'fr',
      'fr#canada',
    ])
    expect((await s.results.get('j1', 'fr#canada'))?.finalText).toBe('fr#canada')
    await s.results.deleteByJob('j1')
    expect(await s.results.listByJob('j1')).toEqual([])
    expect(await s.results.listByJob('j2')).toHaveLength(1)
  })

  it('serialises concurrent writes to one table', async () => {
    const s = createJsonStorage(dir, noopLogger)
    await Promise.all(Array.from({ length: 20 }, (_, i) => s.tm.put(entry(`c${i}`))))
    expect(await createJsonStorage(dir, noopLogger).tm.list()).toHaveLength(20)
  })

  it('coalesces writes that arrive while one is in flight', async () => {
    const flushes: string[] = []
    const logger = { ...noopLogger, debug: (msg: string) => void flushes.push(msg) }
    const s = createJsonStorage(dir, logger)
    await Promise.all(Array.from({ length: 20 }, (_, i) => s.tm.put(entry(`c${i}`))))
    const writes = flushes.filter((m) => m === 'storage.flushed').length
    expect(writes).toBeGreaterThanOrEqual(1)
    expect(writes).toBeLessThan(20)
  })

  it('recovers after a failed write instead of failing every later one', async () => {
    const locked = join(dir, 'locked')
    await mkdir(locked, { mode: 0o555 })
    const s = createJsonStorage(locked, noopLogger)
    await expect(s.tm.put(entry('x1'))).rejects.toThrow()
    await chmod(locked, 0o755)
    await s.tm.put(entry('x2'))
    expect((await createJsonStorage(locked, noopLogger).tm.list()).map((e) => e.id)).toEqual([
      'x1',
      'x2',
    ])
  })

  it('retries a failed table read once the cause is fixed', async () => {
    const blocked = join(dir, 'blocked')
    await writeFile(blocked, 'not a directory')
    const s = createJsonStorage(blocked, noopLogger)
    await expect(s.tm.list()).rejects.toThrow()
    await rm(blocked)
    expect(await s.tm.list()).toEqual([])
  })

  it('reports a corrupt table file instead of silently starting empty', async () => {
    await writeFile(join(dir, 'tm.json'), '{not json')
    await chmod(join(dir, 'tm.json'), 0o644)
    await expect(createJsonStorage(dir, noopLogger).tm.list()).rejects.toThrow()
  })
})
