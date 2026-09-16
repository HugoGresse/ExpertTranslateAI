import { type FC, useEffect, useState } from 'react'
import { exchangeCode } from '../adapters/auth'
import { saveApiKey } from '../adapters/keyVault'
import { logger } from '../adapters/logger'
import { basePath } from './ui'

export const AuthCallback: FC = () => {
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get('code')
    if (!code) {
      setError('No authorization code in the URL.')
      return
    }
    exchangeCode(code)
      .then((key) => {
        saveApiKey(key)
        logger.info('auth.connected')
        window.location.replace(basePath('/settings'))
      })
      .catch((e: unknown) => {
        logger.error('auth.exchangeFailed', { error: String(e) })
        setError(e instanceof Error ? e.message : String(e))
      })
  }, [])

  if (error) {
    return (
      <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm">
        <p className="font-medium">Could not connect to OpenRouter.</p>
        <p className="mt-1">{error}</p>
        <a href={basePath('/settings')} className="mt-2 inline-block text-accent underline">
          Back to Settings
        </a>
      </div>
    )
  }
  return <p className="text-sm text-neutral-600">Connecting to OpenRouter…</p>
}
