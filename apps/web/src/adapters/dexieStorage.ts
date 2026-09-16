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
import { logger } from './logger'

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

const resultKey = (jobId: string, key: string): string => `${jobId}:${key}`

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
      get: (jobId, key) => database.results.get(resultKey(jobId, key)),
      put: async (result) => {
        await database.results.put({ ...result, key: resultKey(result.jobId, result.targetKey) })
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

export interface ExportBundle {
  version: 1
  exportedAt: number
  tables: Record<string, unknown[]>
  settings: Record<string, string>
}

const EXPORTABLE_SETTING_PREFIXES = [
  'eta.settings.',
  'eta.targets',
  'eta.routing',
  'eta.promptOverrides',
  'eta.selected',
  'eta.useMemory',
  'eta.sourceDraft',
]
const isExportableSetting = (key: string): boolean =>
  EXPORTABLE_SETTING_PREFIXES.some((p) => key.startsWith(p)) && !key.includes('openrouter')

export async function exportAll(database: EtaDatabase = db): Promise<ExportBundle> {
  const tables: Record<string, unknown[]> = {}
  for (const table of database.tables) tables[table.name] = await table.toArray()
  const settings: Record<string, string> = {}
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key && isExportableSetting(key)) settings[key] = localStorage.getItem(key) ?? ''
  }
  logger.info('data.exported', {
    tables: Object.keys(tables).length,
    settings: Object.keys(settings).length,
  })
  return { version: 1, exportedAt: Date.now(), tables, settings }
}

const isRow = (row: unknown): row is Record<string, unknown> =>
  typeof row === 'object' && row !== null

export async function importAll(bundle: ExportBundle, database: EtaDatabase = db): Promise<number> {
  let count = 0
  const known = database.tables.filter((t) => Array.isArray(bundle.tables[t.name]))
  await database.transaction('rw', known, async () => {
    for (const table of known) {
      const rows = (bundle.tables[table.name] ?? []).filter(isRow)
      if (rows.length === 0) continue
      await table.bulkPut(rows)
      logger.debug('data.importTable', { table: table.name, rows: rows.length })
      count += rows.length
    }
  })
  for (const [key, value] of Object.entries(bundle.settings ?? {})) {
    if (isExportableSetting(key) && typeof value === 'string') localStorage.setItem(key, value)
  }
  return count
}
