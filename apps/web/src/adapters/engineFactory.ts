import {
  createEngine,
  createOpenRouterLlm,
  createRemoteEngine,
  type Engine,
  type LlmPort,
  type ModelInfo,
  systemClock,
} from '@experttranslate/core'
import { type Settings, usesServer } from '../stores/settings'
import { storage } from './dexieStorage'
import { logger } from './logger'

export interface EngineHandle {
  engine: Engine
  models: () => Promise<ModelInfo[]>
  /** Present only when the engine runs in this browser with the user's own key. */
  llm: LlmPort | null
  remote: boolean
  /** Server reachability probe; only a remote handle has one. */
  health: (() => Promise<{ ok: boolean; version?: string }>) | null
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

const noLlm: LlmPort = {
  chat: () => {
    throw new Error('The engine runs on the server; no local model calls')
  },
  models: () => Promise.resolve([]),
  keyInfo: () => Promise.reject(new Error('No local key')),
}

export function createRemoteHandle(serverUrl: string, token: string): EngineHandle {
  const engine = createRemoteEngine({
    baseUrl: serverUrl.trim(),
    ...(token.trim() ? { token: token.trim() } : {}),
    storage,
    clock: systemClock,
    logger,
    local: createEngine({ llm: noLlm, storage, clock: systemClock, logger }),
    idleTimeoutMs: 120_000,
  })
  return {
    engine,
    models: () => engine.models(),
    llm: null,
    remote: true,
    health: () => engine.health(),
  }
}

export function createBrowserHandle(apiKey: string, concurrency: number): EngineHandle {
  const llm = createBrowserLlm(apiKey, concurrency)
  return {
    engine: createEngine({ llm, storage, clock: systemClock, logger }),
    models: () => llm.models(),
    llm,
    remote: false,
    health: null,
  }
}

/** Picks the server when one is configured, otherwise the in-browser engine (needs a key). */
export function createEngineHandle(
  settings: Pick<Settings, 'serverUrl' | 'serverToken' | 'concurrency'>,
  apiKey: string | null,
  concurrency: number,
): EngineHandle | null {
  if (usesServer(settings)) return createRemoteHandle(settings.serverUrl, settings.serverToken)
  return apiKey ? createBrowserHandle(apiKey, concurrency) : null
}
