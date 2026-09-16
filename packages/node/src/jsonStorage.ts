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
  type StorageTable,
  type TargetResult,
  type TmEntry,
  type TranslationJob,
} from '@experttranslate/core'

const isErrno = (error: unknown): error is NodeJS.ErrnoException =>
  error instanceof Error && 'code' in error

/**
 * One compact JSON file per table under `dir`, loaded once and rewritten atomically after changes.
 * Puts that arrive while a write is in flight are coalesced into a single trailing write, and a
 * failed write never poisons later ones. Meant for one process at a time: two `eta` runs sharing
 * a data dir overwrite each other's rows.
 */
class JsonTable<T> {
  readonly name: StorageTable
  private loaded: Promise<Map<string, T>> | null = null
  private writing: Promise<void> = Promise.resolve()
  private pending: Promise<void> | null = null
  private readonly dir: string
  private readonly file: string
  private readonly keyOf: (row: T) => string
  private readonly logger: LoggerPort

  constructor(dir: string, name: StorageTable, keyOf: (row: T) => string, logger: LoggerPort) {
    this.dir = dir
    this.name = name
    this.keyOf = keyOf
    this.logger = logger
    this.file = join(dir, `${name}.json`)
  }

  private load(): Promise<Map<string, T>> {
    // A failed read is not cached, so a later call retries once the cause is fixed.
    this.loaded ??= this.read().catch((error: unknown) => {
      this.loaded = null
      throw error
    })
    return this.loaded
  }

  private async read(): Promise<Map<string, T>> {
    let parsed: unknown = []
    try {
      parsed = JSON.parse(await readFile(this.file, 'utf8'))
    } catch (error) {
      if (!isErrno(error) || error.code !== 'ENOENT') {
        this.logger.error('storage.readFailed', {
          table: this.name,
          file: this.file,
          error: String(error),
        })
        throw error
      }
    }
    // Our own file format: an array of rows of this table's type.
    const list = Array.isArray(parsed) ? (parsed as T[]) : []
    const rows = new Map(list.map((row) => [this.keyOf(row), row]))
    this.logger.debug('storage.loaded', { table: this.name, rows: rows.size })
    return rows
  }

  /** Schedules one write for every change made before it starts; callers await their own change. */
  private flush(): Promise<void> {
    if (this.pending) return this.pending
    const write = this.writing.then(async () => {
      this.pending = null
      const rows = [...(await this.load()).values()]
      await mkdir(this.dir, { recursive: true })
      const tmp = `${this.file}.${process.pid}.tmp`
      await writeFile(tmp, JSON.stringify(rows), 'utf8')
      await rename(tmp, this.file)
      this.logger.debug('storage.flushed', { table: this.name, rows: rows.length })
    })
    this.pending = write
    // The chain keeps ordering; a rejection surfaces to this caller only.
    this.writing = write.catch((error: unknown) => {
      this.logger.warn('storage.flushFailed', { table: this.name, error: String(error) })
    })
    return write
  }

  async get(key: string): Promise<T | undefined> {
    return (await this.load()).get(key)
  }

  async list(): Promise<T[]> {
    return [...(await this.load()).values()]
  }

  async find(predicate: (row: T) => boolean): Promise<T[]> {
    const out: T[] = []
    for (const row of (await this.load()).values()) if (predicate(row)) out.push(row)
    return out
  }

  async put(row: T): Promise<void> {
    ;(await this.load()).set(this.keyOf(row), row)
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

export function createJsonStorage(dir: string, logger: LoggerPort): StoragePort {
  const byId = <T extends { id: string }>(row: T): string => row.id
  const results = new JsonTable<TargetResult>(
    dir,
    'results',
    (r) => resultKey(r.jobId, r.targetKey),
    logger,
  )
  const resultRepo: ResultRepo = {
    get: (jobId, targetKey) => results.get(resultKey(jobId, targetKey)),
    put: (r) => results.put(r),
    listByJob: (jobId) => results.find((r) => r.jobId === jobId),
    deleteByJob: (jobId) => results.deleteWhere((r) => r.jobId === jobId),
  }
  return {
    jobs: repo(new JsonTable<TranslationJob>(dir, 'jobs', byId, logger)),
    results: resultRepo,
    contexts: repo(new JsonTable<ContextSource>(dir, 'contexts', byId, logger)),
    guidelines: repo(new JsonTable<GuidelineSet>(dir, 'guidelines', byId, logger)),
    glossaryScopes: repo(new JsonTable<GlossaryScope>(dir, 'glossaryScopes', byId, logger)),
    glossaryEntries: repo(new JsonTable<GlossaryEntry>(dir, 'glossaryEntries', byId, logger)),
    tm: repo(new JsonTable<TmEntry>(dir, 'tm', byId, logger)),
    evals: repo(new JsonTable<EvalRecord>(dir, 'evals', byId, logger)),
  }
}
