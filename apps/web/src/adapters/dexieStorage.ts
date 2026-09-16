import type {
  ContextSource,
  EvalRecord,
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
  evals!: EntityTable<EvalRecord, 'id'>

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
    this.version(4).stores({
      evals: 'id, createdAt, jobId, lang, difficulty',
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
    evals: tableRepo<EvalRecord>(database.evals),
  }
}

export const storage: StoragePort = createDexieStorage()

export const ALL_TABLES = [
  'jobs',
  'results',
  'contextSources',
  'guidelineSets',
  'glossaryScopes',
  'glossaryEntries',
  'tm',
  'evals',
] as const
export type ExportTable = (typeof ALL_TABLES)[number]

export interface ExportBundle {
  version: 1
  exportedAt: number
  tables: Record<ExportTable, unknown[]>
  settings: Record<string, string>
}

export async function exportAll(database: EtaDatabase = db): Promise<ExportBundle> {
  const tables = {} as Record<ExportTable, unknown[]>
  for (const name of ALL_TABLES) tables[name] = await database.table(name).toArray()
  const settings: Record<string, string> = {}
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key?.startsWith('eta.') && !key.includes('openrouter'))
      settings[key] = localStorage.getItem(key) ?? ''
  }
  return { version: 1, exportedAt: Date.now(), tables, settings }
}

export async function importAll(bundle: ExportBundle, database: EtaDatabase = db): Promise<number> {
  let count = 0
  await database.transaction(
    'rw',
    ALL_TABLES.map((n) => database.table(n)),
    async () => {
      for (const name of ALL_TABLES) {
        const rows = bundle.tables[name] ?? []
        if (rows.length === 0) continue
        await database.table(name).bulkPut(rows)
        count += rows.length
      }
    },
  )
  for (const [key, value] of Object.entries(bundle.settings ?? {})) {
    if (key.startsWith('eta.') && !key.includes('openrouter')) localStorage.setItem(key, value)
  }
  return count
}
