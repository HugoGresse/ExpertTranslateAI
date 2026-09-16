import {
  createEngine,
  createOpenRouterLlm,
  createRemoteEngine,
  type Engine,
  type LlmPort,
  type ModelInfo,
  type ServerHealth,
  systemClock,
} from '@experttranslate/core'
import { type Settings, usesServer } from '../stores/settings'
import { storage } from './dexieStorage'
import { logger } from './logger'

export interface EngineHandle {
  engine: Engine
  models: () => Promise<ModelInfo[]>
  /** Cache key for the model catalog: one per key, one per server. */
  catalogId: string
  /** Present only for a server-backed engine. */
  health: (() => Promise<ServerHealth>) | null
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

/** Accepts what the user typed and rejects anything that is not an absolute http(s) URL. */
export function serverOrigin(serverUrl: string): string | null {
  const trimmed = serverUrl.trim()
  if (!trimmed || !URL.canParse(trimmed)) return null
  const url = new URL(trimmed)
  return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : null
}

export function createRemoteHandle(serverUrl: string, token: string): EngineHandle {
  const engine = createRemoteEngine({
    baseUrl: serverUrl.trim(),
    ...(token.trim() ? { token: token.trim() } : {}),
    storage,
    clock: systemClock,
    logger,
    idleTimeoutMs: 120_000,
  })
  return {
    engine,
    models: () => engine.models(),
    catalogId: `catalog:${serverOrigin(serverUrl) ?? serverUrl.trim()}`,
    health: () => engine.health(),
  }
}

export function createBrowserHandle(apiKey: string, concurrency: number): EngineHandle {
  const llm = createBrowserLlm(apiKey, concurrency)
  return {
    engine: createEngine({ llm, storage, clock: systemClock, logger }),
    models: () => llm.models(),
    catalogId: 'catalog',
    health: null,
  }
}

/** The server when a valid URL is configured, otherwise the in-browser engine (needs a key). */
export function createEngineHandle(
  settings: Pick<Settings, 'serverUrl' | 'serverToken'>,
  apiKey: string | null,
  concurrency: number,
): EngineHandle | null {
  if (usesServer(settings))
    return serverOrigin(settings.serverUrl)
      ? createRemoteHandle(settings.serverUrl, settings.serverToken)
      : null
  return apiKey ? createBrowserHandle(apiKey, concurrency) : null
}
