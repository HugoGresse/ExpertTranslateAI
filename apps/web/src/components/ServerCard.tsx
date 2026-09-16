import { useStore } from '@nanostores/react'
import { type FC, useState } from 'react'
import { createRemoteHandle } from '../adapters/engineFactory'
import { logger } from '../adapters/logger'
import { $settings, usesServer } from '../stores/settings'
import { Button, Card, Field, inputClass } from './ui'

export const ServerCard: FC = () => {
  const settings = useStore($settings)
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const test = async (): Promise<void> => {
    setBusy(true)
    setStatus(null)
    try {
      const handle = createRemoteHandle(settings.serverUrl, settings.serverToken)
      const health = await handle.models().then(
        (models) => `Connected: ${models.length} models available.`,
        async (error: unknown) => {
          const info = await handle.health?.().catch(() => null)
          if (info?.ok)
            throw new Error(`Server reachable but rejected the token (${String(error)})`)
          throw error
        },
      )
      setStatus(health)
      logger.info('server.tested', { url: settings.serverUrl })
    } catch (error) {
      logger.warn('server.testFailed', { url: settings.serverUrl, error: String(error) })
      setStatus(`Could not connect: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card title="Server (optional)">
      <p className="text-sm text-neutral-600">
        Point the app at an <code>eta-server</code> to run translations with a key held on that
        machine. The browser then needs no OpenRouter key; materials stay in this browser and are
        sent with each job. Leave empty to run everything locally.
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label="Server URL" hint="e.g. https://translate.example.com">
          <input
            className={inputClass}
            placeholder="https://…"
            value={settings.serverUrl}
            onChange={(e) => $settings.setKey('serverUrl', e.target.value)}
          />
        </Field>
        <Field label="Access token" hint="ETA_SERVER_TOKEN on the server; never exported">
          <input
            className={inputClass}
            type="password"
            autoComplete="off"
            value={settings.serverToken}
            onChange={(e) => $settings.setKey('serverToken', e.target.value)}
          />
        </Field>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <Button disabled={!usesServer(settings) || busy} onClick={() => void test()}>
          Test connection
        </Button>
        {usesServer(settings) ? (
          <span className="text-xs text-neutral-500">Translations run on the server.</span>
        ) : null}
        {status ? <span className="text-xs">{status}</span> : null}
      </div>
    </Card>
  )
}
