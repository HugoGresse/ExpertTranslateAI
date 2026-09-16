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

export function useModels(): ModelsState {
  const apiKey = useStore($apiKey)
  const settings = useStore($settings)
  const { serverUrl, serverToken } = settings
  const [models, setModels] = useState<ModelInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const handle = createEngineHandle({ serverUrl, serverToken, concurrency: '2' }, apiKey, 2)
    if (!handle) {
      setModels([])
      return
    }
    let cancelled = false
    setLoading(true)
    loadModels(handle, { force: tick > 0 })
      .then((list) => {
        if (!cancelled) {
          setModels(list)
          setError(null)
        }
      })
      .catch((e: unknown) => {
        logger.warn('models.loadFailed', { error: String(e), remote: handle.remote })
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [apiKey, serverUrl, serverToken, tick])

  const refresh = useCallback(() => setTick((t) => t + 1), [])
  return { models, loading, error, refresh }
}
