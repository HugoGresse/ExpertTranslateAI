import type { LoggerPort, StoragePort } from '../ports.ts'

/** Tables every StoragePort exposes, in import order (scopes before entries, jobs before results). */
export const STORAGE_TABLES = [
  'jobs',
  'results',
  'contexts',
  'guidelines',
  'glossaryScopes',
  'glossaryEntries',
  'tm',
  'evals',
] as const satisfies ReadonlyArray<keyof StoragePort>
export type StorageTable = (typeof STORAGE_TABLES)[number]

/** Names older web exports used for two tables (their IndexedDB store names). */
const LEGACY_TABLE_NAMES: Record<string, StorageTable> = {
  contextSources: 'contexts',
  guidelineSets: 'guidelines',
}

export interface ExportBundle {
  version: 1
  exportedAt: number
  tables: Record<string, unknown[]>
  settings?: Record<string, string>
}

export const isExportBundle = (x: unknown): x is ExportBundle =>
  typeof x === 'object' &&
  x !== null &&
  'version' in x &&
  x.version === 1 &&
  'tables' in x &&
  typeof x.tables === 'object' &&
  x.tables !== null

const isTable = (name: string): name is StorageTable =>
  (STORAGE_TABLES as readonly string[]).includes(name)

/** Maps every key of a bundle's tables to a StoragePort table name, dropping unknown ones. */
export function normalizeBundleTables(
  tables: Record<string, unknown[]>,
): Partial<Record<StorageTable, unknown[]>> {
  const out: Partial<Record<StorageTable, unknown[]>> = {}
  for (const [name, rows] of Object.entries(tables)) {
    const table = isTable(name) ? name : LEGACY_TABLE_NAMES[name]
    if (table && Array.isArray(rows)) out[table] = rows
  }
  return out
}

const isRow = (row: unknown): row is { id: string } =>
  typeof row === 'object' && row !== null && 'id' in row && typeof row.id === 'string'

const isResultRow = (row: unknown): row is { jobId: string; targetKey: string } =>
  typeof row === 'object' &&
  row !== null &&
  'jobId' in row &&
  typeof row.jobId === 'string' &&
  'targetKey' in row &&
  typeof row.targetKey === 'string'

export async function exportBundle(storage: StoragePort, now: number): Promise<ExportBundle> {
  const tables: Record<string, unknown[]> = {}
  for (const name of STORAGE_TABLES) {
    if (name === 'results') continue
    tables[name] = await storage[name].list()
  }
  return { version: 1, exportedAt: now, tables }
}

/**
 * Puts every well-formed row of a bundle through the port's repos. Rows are trusted structurally
 * because they come from this app's own export; only the id (or job/target key) is checked.
 */
export async function importBundle(
  storage: StoragePort,
  bundle: ExportBundle,
  logger: LoggerPort,
): Promise<Record<StorageTable, number>> {
  // Object.fromEntries widens keys to string; every STORAGE_TABLES entry is present.
  const counts = Object.fromEntries(STORAGE_TABLES.map((t) => [t, 0])) as Record<
    StorageTable,
    number
  >
  const tables = normalizeBundleTables(bundle.tables)
  for (const name of STORAGE_TABLES) {
    const rows = tables[name]
    if (!rows) {
      logger.debug('bundle.tableMissing', { table: name })
      continue
    }
    for (const row of rows) {
      if (name === 'results') {
        if (!isResultRow(row)) continue
        // Structural trust of our own export format (see the function comment).
        await storage.results.put(row as Parameters<typeof storage.results.put>[0])
      } else {
        if (!isRow(row)) continue
        // Same structural trust; the repo type is fixed by `name`.
        await (storage[name] as { put(item: { id: string }): Promise<void> }).put(row)
      }
      counts[name]++
    }
    logger.info('bundle.tableImported', { table: name, rows: counts[name], offered: rows.length })
  }
  return counts
}
