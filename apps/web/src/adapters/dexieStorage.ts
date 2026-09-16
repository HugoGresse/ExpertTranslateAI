import type {
  ContextSource,
  GlossaryEntry,
  GlossaryScope,
  GuidelineSet,
  ModelInfo,
  Repo,
  StoragePort,
  TargetResult,
  TmEntry,
  TranslationJob,
} from '@experttranslate/core'
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
  contextSources!: EntityTable<ContextSource, 'id'>
  guidelineSets!: EntityTable<GuidelineSet, 'id'>
  glossaryScopes!: EntityTable<GlossaryScope, 'id'>
  glossaryEntries!: EntityTable<GlossaryEntry, 'id'>
  tm!: EntityTable<TmEntry, 'id'>

  constructor() {
    super('experttranslateai')
    this.version(1).stores({
      jobs: 'id, createdAt, status',
      results: 'key, jobId, lang',
      modelCache: 'id',
    })
    this.version(2).stores({
      contextSources: 'id, createdAt, enabled',
      guidelineSets: 'id, createdAt, enabled',
    })
    this.version(3).stores({
      glossaryScopes: 'id, createdAt, parentId, level',
      glossaryEntries: 'id, createdAt, scopeId, lang',
      tm: 'id, createdAt, sourceLang, targetLang',
    })
  }
}

interface RepoTable<T> {
  get(key: string): Promise<T | undefined>
  put(item: T): Promise<unknown>
  delete(key: string): Promise<void>
  orderBy(index: string): { reverse(): { toArray(): Promise<T[]> } }
}

function tableRepo<T extends { id: string; createdAt: number }>(table: RepoTable<T>): Repo<T> {
  return {
    get: (id) => table.get(id),
    put: async (item) => {
      await table.put(item)
    },
    list: () => table.orderBy('createdAt').reverse().toArray(),
    delete: async (id) => {
      await table.delete(id)
    },
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
    contexts: tableRepo<ContextSource>(database.contextSources),
    guidelines: tableRepo<GuidelineSet>(database.guidelineSets),
    glossaryScopes: tableRepo<GlossaryScope>(database.glossaryScopes),
    glossaryEntries: tableRepo<GlossaryEntry>(database.glossaryEntries),
    tm: tableRepo<TmEntry>(database.tm),
  }
}

export const storage: StoragePort = createDexieStorage()
