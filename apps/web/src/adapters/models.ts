import type { ModelInfo } from '@experttranslate/core'
import { db } from './dexieStorage'
import { logger } from './logger'

const ONE_DAY_MS = 24 * 60 * 60 * 1000

export interface ModelSource {
  models(): Promise<ModelInfo[]>
  /** Cache key; the local key and each server keep separate catalogs. */
  catalogId: string
}

export async function loadModels(
  source: ModelSource,
  opts: { force?: boolean } = {},
): Promise<ModelInfo[]> {
  const cached = await db.modelCache.get(source.catalogId)
  const fresh = cached && Date.now() - cached.fetchedAt < ONE_DAY_MS
  if (cached && fresh && !opts.force) {
    logger.debug('models.cacheHit', { catalog: source.catalogId, count: cached.models.length })
    return cached.models
  }
  const models = (await source.models()).sort((a, b) => a.name.localeCompare(b.name))
  await db.modelCache.put({ id: source.catalogId, fetchedAt: Date.now(), models })
  logger.info('models.refreshed', { catalog: source.catalogId, count: models.length })
  return models
}
