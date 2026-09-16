import {
  createEngine,
  createOpenRouterLlm,
  type Engine,
  type LlmPort,
  systemClock,
} from '@experttranslate/core'
import { storage } from './dexieStorage'
import { logger } from './logger'

export interface BrowserEngine {
  engine: Engine
  llm: LlmPort
}

export function createBrowserLlm(apiKey: string, concurrency: number): LlmPort {
  return createOpenRouterLlm({
    apiKey,
    concurrency,
    referer: window.location.origin,
    title: 'ExpertTranslateAI',
    logger,
  })
}

export function createBrowserEngine(apiKey: string, concurrency: number): BrowserEngine {
  const llm = createBrowserLlm(apiKey, concurrency)
  return { engine: createEngine({ llm, storage, clock: systemClock, logger }), llm }
}
