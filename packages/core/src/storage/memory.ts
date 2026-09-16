import { resultKey } from '../pipeline/targetKey.ts'
import type { Repo, ResultRepo, StoragePort } from '../ports.ts'
import type {
  ContextSource,
  EvalRecord,
  GlossaryEntry,
  GlossaryScope,
  GuidelineSet,
  TargetResult,
  TmEntry,
  TranslationJob,
} from '../types.ts'

export function memoryRepo<T extends { id: string }>(seed: T[] = []): Repo<T> {
  const map = new Map(seed.map((row) => [row.id, row]))
  return {
    get: (id) => Promise.resolve(map.get(id)),
    put: (item) => {
      map.set(item.id, item)
      return Promise.resolve()
    },
    list: () => Promise.resolve([...map.values()]),
    delete: (id) => {
      map.delete(id)
      return Promise.resolve()
    },
  }
}

function memoryResults(): ResultRepo {
  const map = new Map<string, TargetResult>()
  return {
    get: (jobId, key) => Promise.resolve(map.get(resultKey(jobId, key))),
    put: (r) => {
      map.set(resultKey(r.jobId, r.targetKey), r)
      return Promise.resolve()
    },
    listByJob: (jobId) => Promise.resolve([...map.values()].filter((r) => r.jobId === jobId)),
    deleteByJob: (jobId) => {
      for (const [k, r] of [...map]) if (r.jobId === jobId) map.delete(k)
      return Promise.resolve()
    },
  }
}

/** A StoragePort that lives for the process (or the request): tests, ephemeral server jobs. */
export const createMemoryStorage = (): StoragePort => ({
  jobs: memoryRepo<TranslationJob>(),
  results: memoryResults(),
  contexts: memoryRepo<ContextSource>(),
  guidelines: memoryRepo<GuidelineSet>(),
  glossaryScopes: memoryRepo<GlossaryScope>(),
  glossaryEntries: memoryRepo<GlossaryEntry>(),
  tm: memoryRepo<TmEntry>(),
  evals: memoryRepo<EvalRecord>(),
})
