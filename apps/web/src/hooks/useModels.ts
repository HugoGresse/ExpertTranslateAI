import type { ModelInfo } from '@experttranslate/core'
import { useStore } from '@nanostores/react'
import { useCallback, useEffect, useState } from 'react'
import { createEngineHandle } from '../adapters/engineFactory'
import { $apiKey } from '../adapters/keyVault'
import { logger } from '../adapters/logger'
import { loadModels } from '../adapters/models'
import { $settings } from '../stores/settings'

export interface ModelsState {
  models: ModelInfo[]
  loading: boolean
  error: string | null
  refresh: () => void
}

/** Typing a server URL or token should not fire a request per keystroke. */
const SETTLE_MS = 400

export function useModels(): ModelsState {
  const apiKey = useStore($apiKey)
  const { serverUrl, serverToken } = useStore($settings)
  const [models, setModels] = useState<ModelInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let cancelled = false
    const handle = setTimeout(() => {
      const source = createEngineHandle({ serverUrl, serverToken }, apiKey, 2)
      if (!source) {
        setModels([])
        setLoading(false)
        return
      }
      setLoading(true)
      loadModels(source, { force: tick > 0 })
        .then((list) => {
          if (!cancelled) {
            setModels(list)
            setError(null)
          }
        })
        .catch((e: unknown) => {
          logger.warn('models.loadFailed', { error: String(e), catalog: source.catalogId })
          if (!cancelled) setError(e instanceof Error ? e.message : String(e))
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    }, SETTLE_MS)
    return () => {
      cancelled = true
      clearTimeout(handle)
    }
  }, [apiKey, serverUrl, serverToken, tick])

  const refresh = useCallback(() => setTick((t) => t + 1), [])
  return { models, loading, error, refresh }
}
