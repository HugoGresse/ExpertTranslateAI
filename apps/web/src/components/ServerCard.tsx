import { RemoteHttpError, type ServerHealth } from '@experttranslate/core'
import { useStore } from '@nanostores/react'
import { type FC, useState } from 'react'
import { createRemoteHandle, serverOrigin } from '../adapters/engineFactory'
import { logger } from '../adapters/logger'
import { $settings, usesServer } from '../stores/settings'
import { Button, Card, Field, inputClass } from './ui'

const describe = (health: ServerHealth, models: number): string => {
  const caps = [
    health.maxJobs !== undefined ? `${health.maxJobs} parallel jobs` : null,
    health.maxBudgetUsd === null
      ? 'no budget cap'
      : health.maxBudgetUsd !== undefined
        ? `budget cap $${health.maxBudgetUsd}`
        : null,
    health.maxSourceChars !== undefined ? `${health.maxSourceChars} source chars max` : null,
  ].filter(Boolean)
  return `Connected (v${health.version ?? '?'}): ${models} models available${caps.length ? `; ${caps.join(', ')}` : ''}.`
}

const explain = (error: unknown, url: string): string => {
  if (error instanceof RemoteHttpError && error.status === 401)
    return 'The server rejected the token. Check ETA_SERVER_TOKEN on the server.'
  if (error instanceof TypeError)
    return `Could not reach ${url}. If the server is up, add ${window.location.origin} to ETA_ALLOWED_ORIGINS on the server.`
  return `Could not connect: ${error instanceof Error ? error.message : String(error)}`
}

export const ServerCard: FC = () => {
  const settings = useStore($settings)
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const validUrl = serverOrigin(settings.serverUrl) !== null

  const test = async (): Promise<void> => {
    setBusy(true)
    setStatus(null)
    try {
      const handle = createRemoteHandle(settings.serverUrl, settings.serverToken)
      const info = await (handle.health ? handle.health() : Promise.resolve({ ok: false }))
      if (!info.ok) throw new Error('The URL answered but is not an ExpertTranslateAI server')
      const models = await handle.models()
      setStatus(describe(info, models.length))
      logger.info('server.tested', { url: settings.serverUrl, models: models.length })
    } catch (error) {
      logger.warn('server.testFailed', { url: settings.serverUrl, error: String(error) })
      setStatus(explain(error, settings.serverUrl))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card title="Server (optional)">
      <p className="text-sm text-neutral-600">
        Point the app at an <code>eta-server</code> to run translations with a key held on that
        machine. The browser then needs no OpenRouter key for translating; materials stay in this
        browser and travel with each job. Rule extraction for guidelines still uses a local key.
        Neither the URL nor the token is ever included in exports.
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
        <Field
          label="Access token"
          hint="ETA_SERVER_TOKEN on the server; stored on this device only"
        >
          <input
            className={inputClass}
            type="password"
            autoComplete="off"
            value={settings.serverToken}
            onChange={(e) => $settings.setKey('serverToken', e.target.value)}
          />
        </Field>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button disabled={!validUrl || busy} onClick={() => void test()}>
          Test connection
        </Button>
        {usesServer(settings) && !validUrl ? (
          <span className="text-xs text-red-700">Enter a full http(s) URL.</span>
        ) : null}
        {validUrl ? (
          <span className="text-xs text-neutral-500">Translations run on the server.</span>
        ) : null}
        {status ? <span className="text-xs">{status}</span> : null}
      </div>
    </Card>
  )
}
