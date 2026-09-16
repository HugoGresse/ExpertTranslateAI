import type { ModelInfo, StoragePort, TargetResult, TranslationJob } from '@experttranslate/core'
import Dexie, { type EntityTable } from 'dexie'

export interface ModelCache {
  id: 'catalog'
  fetchedAt: number
  models: ModelInfo[]
}

export class EtaDatabase extends Dexie {
  jobs!: EntityTable<TranslationJob, 'id'>
  results!: EntityTable<TargetResult & { key: string }, 'key'>
  modelCache!: EntityTable<ModelCache, 'id'>

  constructor() {
    super('experttranslateai')
    this.version(1).stores({
      jobs: 'id, createdAt, status',
      results: 'key, jobId, lang',
      modelCache: 'id',
    })
  }
}

export const db = new EtaDatabase()

const resultKey = (jobId: string, lang: string): string => `${jobId}:${lang}`

export function createDexieStorage(database: EtaDatabase = db): StoragePort {
  return {
    jobs: {
      get: (id) => database.jobs.get(id),
      put: async (job) => {
        await database.jobs.put(job)
      },
      list: () => database.jobs.orderBy('createdAt').reverse().toArray(),
      delete: async (id) => {
        await database.jobs.delete(id)
      },
    },
    results: {
      get: (jobId, lang) => database.results.get(resultKey(jobId, lang)),
      put: async (result) => {
        await database.results.put({ ...result, key: resultKey(result.jobId, result.lang) })
      },
      listByJob: (jobId) => database.results.where('jobId').equals(jobId).toArray(),
      deleteByJob: async (jobId) => {
        await database.results.where('jobId').equals(jobId).delete()
      },
    },
  }
}

export const storage: StoragePort = createDexieStorage()
