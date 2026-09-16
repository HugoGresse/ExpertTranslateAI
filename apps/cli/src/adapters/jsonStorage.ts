import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  type ContextSource,
  type EvalRecord,
  type GlossaryEntry,
  type GlossaryScope,
  type GuidelineSet,
  type LoggerPort,
  type Repo,
  type ResultRepo,
  resultKey,
  type StoragePort,
  type TargetResult,
  type TmEntry,
  type TranslationJob,
} from '@experttranslate/core'

export const TABLE_NAMES = [
  'jobs',
  'results',
  'contexts',
  'guidelines',
  'glossaryScopes',
  'glossaryEntries',
  'tm',
  'evals',
] as const
export type TableName = (typeof TABLE_NAMES)[number]

/**
 * One JSON file per table under `dir`, loaded lazily and written atomically on every change.
 * Writes are serialised per table so concurrent puts from parallel targets cannot interleave.
 */
class JsonTable<T> {
  readonly name: TableName
  private rows: Map<string, T> | null = null
  private loading: Promise<Map<string, T>> | null = null
  private queue: Promise<void> = Promise.resolve()
  private readonly dir: string
  private readonly file: string
  private readonly keyOf: (row: T) => string
  private readonly logger: LoggerPort

  constructor(dir: string, name: TableName, keyOf: (row: T) => string, logger: LoggerPort) {
    this.dir = dir
    this.name = name
    this.keyOf = keyOf
    this.logger = logger
    this.file = join(dir, `${name}.json`)
  }

  private load(): Promise<Map<string, T>> {
    if (this.rows) return Promise.resolve(this.rows)
    // Concurrent first calls share one read so a late loader cannot replace rows already written.
    this.loading ??= this.read()
    return this.loading
  }

  private async read(): Promise<Map<string, T>> {
    let parsed: unknown = []
    try {
      parsed = JSON.parse(await readFile(this.file, 'utf8'))
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') {
        this.logger.error('storage.readFailed', {
          table: this.name,
          file: this.file,
          error: String(error),
        })
        throw error
      }
    }
    const list = Array.isArray(parsed) ? (parsed as T[]) : []
    this.rows = new Map(list.map((row) => [this.keyOf(row), row]))
    this.logger.debug('storage.loaded', { table: this.name, rows: this.rows.size })
    return this.rows
  }

  private flush(): Promise<void> {
    this.queue = this.queue.then(async () => {
      const rows = [...(this.rows?.values() ?? [])]
      await mkdir(this.dir, { recursive: true })
      const tmp = `${this.file}.${process.pid}.tmp`
      await writeFile(tmp, JSON.stringify(rows, null, 2), 'utf8')
      await rename(tmp, this.file)
      this.logger.debug('storage.flushed', { table: this.name, rows: rows.length })
    })
    return this.queue
  }

  async get(key: string): Promise<T | undefined> {
    return (await this.load()).get(key)
  }

  async list(): Promise<T[]> {
    return [...(await this.load()).values()]
  }

  async put(row: T): Promise<void> {
    ;(await this.load()).set(this.keyOf(row), row)
    await this.flush()
  }

  async putMany(rows: T[]): Promise<void> {
    const map = await this.load()
    for (const row of rows) map.set(this.keyOf(row), row)
    await this.flush()
  }

  async delete(key: string): Promise<void> {
    if ((await this.load()).delete(key)) await this.flush()
  }

  async deleteWhere(predicate: (row: T) => boolean): Promise<void> {
    const map = await this.load()
    let removed = 0
    for (const [key, row] of map) if (predicate(row)) removed += map.delete(key) ? 1 : 0
    if (removed > 0) await this.flush()
  }
}

const repo = <T extends { id: string }>(table: JsonTable<T>): Repo<T> => ({
  get: (id) => table.get(id),
  put: (row) => table.put(row),
  list: () => table.list(),
  delete: (id) => table.delete(id),
})

export interface JsonStorage extends StoragePort {
  /** Bulk insert rows exported from the web app (same table names, same row shapes). */
  importTable(name: TableName, rows: unknown[]): Promise<number>
}

export function createJsonStorage(dir: string, logger: LoggerPort): JsonStorage {
  const byId = <T extends { id: string }>(row: T): string => row.id
  const jobs = new JsonTable<TranslationJob>(dir, 'jobs', byId, logger)
  const results = new JsonTable<TargetResult>(
    dir,
    'results',
    (r) => resultKey(r.jobId, r.targetKey),
    logger,
  )
  const contexts = new JsonTable<ContextSource>(dir, 'contexts', byId, logger)
  const guidelines = new JsonTable<GuidelineSet>(dir, 'guidelines', byId, logger)
  const glossaryScopes = new JsonTable<GlossaryScope>(dir, 'glossaryScopes', byId, logger)
  const glossaryEntries = new JsonTable<GlossaryEntry>(dir, 'glossaryEntries', byId, logger)
  const tm = new JsonTable<TmEntry>(dir, 'tm', byId, logger)
  const evals = new JsonTable<EvalRecord>(dir, 'evals', byId, logger)
  // Rows come from this app's own export of the same table, so the shape is trusted structurally;
  // the cast only bridges the untyped JSON boundary.
  const importers: Record<TableName, (rows: object[]) => Promise<void>> = {
    jobs: (rows) => jobs.putMany(rows as TranslationJob[]),
    results: (rows) => results.putMany(rows as TargetResult[]),
    contexts: (rows) => contexts.putMany(rows as ContextSource[]),
    guidelines: (rows) => guidelines.putMany(rows as GuidelineSet[]),
    glossaryScopes: (rows) => glossaryScopes.putMany(rows as GlossaryScope[]),
    glossaryEntries: (rows) => glossaryEntries.putMany(rows as GlossaryEntry[]),
    tm: (rows) => tm.putMany(rows as TmEntry[]),
    evals: (rows) => evals.putMany(rows as EvalRecord[]),
  }
  const resultRepo: ResultRepo = {
    get: (jobId, targetKey) => results.get(resultKey(jobId, targetKey)),
    put: (r) => results.put(r),
    listByJob: async (jobId) => (await results.list()).filter((r) => r.jobId === jobId),
    deleteByJob: (jobId) => results.deleteWhere((r) => r.jobId === jobId),
  }
  const isRow = (row: unknown): row is object => typeof row === 'object' && row !== null
  return {
    jobs: repo(jobs),
    results: resultRepo,
    contexts: repo(contexts),
    guidelines: repo(guidelines),
    glossaryScopes: repo(glossaryScopes),
    glossaryEntries: repo(glossaryEntries),
    tm: repo(tm),
    evals: repo(evals),
    async importTable(name, rows) {
      const valid = rows.filter(isRow)
      await importers[name](valid)
      logger.info('storage.imported', { table: name, rows: valid.length })
      return valid.length
    },
  }
}
