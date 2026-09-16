import type { LlmPort, ModelInfo } from '@experttranslate/core'
import { db } from './dexieStorage'
import { logger } from './logger'

const ONE_DAY_MS = 24 * 60 * 60 * 1000

export async function loadModels(
  llm: LlmPort,
  opts: { force?: boolean } = {},
): Promise<ModelInfo[]> {
  const cached = await db.modelCache.get('catalog')
  const fresh = cached && Date.now() - cached.fetchedAt < ONE_DAY_MS
  if (cached && fresh && !opts.force) {
    logger.debug('models.cacheHit', { count: cached.models.length })
    return cached.models
  }
  const models = (await llm.models()).sort((a, b) => a.name.localeCompare(b.name))
  await db.modelCache.put({ id: 'catalog', fetchedAt: Date.now(), models })
  logger.info('models.refreshed', { count: models.length })
  return models
}
