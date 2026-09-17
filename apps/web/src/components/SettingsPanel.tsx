import type { KeyInfo } from '@experttranslate/core'
import { useStore } from '@nanostores/react'
import { type FC, useState } from 'react'
import { startOAuth } from '../adapters/auth'
import { createBrowserLlm } from '../adapters/engineFactory'
import { $apiKey, $keyLocked, forgetApiKey, maskKey, saveApiKey } from '../adapters/keyVault'
import { logger } from '../adapters/logger'
import { useModels } from '../hooks/useModels'
import { $settings } from '../stores/settings'
import { DataCard } from './DataCard'
import { KeyVaultCard, UnlockForm } from './KeyVaultCard'
import { ModelAutoPick } from './ModelAutoPick'
import { ModelPicker } from './ModelPicker'
import { RoleModelsCard } from './RoleModelsCard'
import { ServerCard } from './ServerCard'
import { Button, basePath, Card, Field, formatUsd, inputClass } from './ui'

const KeySection: FC = () => {
  const apiKey = useStore($apiKey)
  const locked = useStore($keyLocked)
  const [draft, setDraft] = useState('')
  const [info, setInfo] = useState<KeyInfo | null>(null)
  const [status, setStatus] = useState<string | null>(null)

  const validate = async (key: string): Promise<boolean> => {
    setStatus('Checking key…')
    try {
      const result = await createBrowserLlm(key, 1).keyInfo()
      setInfo(result)
      setStatus(null)
      return true
    } catch (error) {
      logger.warn('settings.keyInvalid', { error: String(error) })
      setStatus(error instanceof Error ? error.message : String(error))
      setInfo(null)
      return false
    }
  }

  const save = async (): Promise<void> => {
    const key = draft.trim()
    if (!key) return
    if (await validate(key)) {
      saveApiKey(key)
      setDraft('')
    }
  }

  const connect = (): void => {
    void startOAuth(new URL(basePath('/auth/callback'), window.location.origin).toString())
  }

  return (
    <Card title="OpenRouter key">
      {locked ? (
        <div className="flex flex-col gap-3">
          <UnlockForm />
          <Button variant="danger" className="self-start" onClick={forgetApiKey}>
            Forget encrypted key
          </Button>
        </div>
      ) : apiKey ? (
        <div className="flex flex-col gap-2 text-sm">
          <p>
            Key on this device:{' '}
            <code className="rounded bg-neutral-100 px-1">{maskKey(apiKey)}</code>
          </p>
          {info ? (
            <p className="text-neutral-600">
              {info.label || 'unnamed key'} · used {formatUsd(info.usageUsd)}
              {info.limitUsd !== null ? ` of ${formatUsd(info.limitUsd)} limit` : ' · no limit set'}
            </p>
          ) : null}
          <div className="flex gap-2">
            <Button onClick={() => void validate(apiKey)}>Check credits</Button>
            <Button variant="danger" onClick={forgetApiKey}>
              Forget key
            </Button>
          </div>
          <KeyVaultCard />
        </div>
      ) : (
        <div className="flex flex-col gap-3 text-sm">
          <Button variant="primary" onClick={connect}>
            Connect with OpenRouter
          </Button>
          <p className="text-neutral-600">or paste a key:</p>
          <div className="flex gap-2">
            <input
              className={`${inputClass} flex-1`}
              type="password"
              placeholder="sk-or-…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              aria-label="OpenRouter API key"
            />
            <Button onClick={() => void save()}>Save</Button>
          </div>
        </div>
      )}
      {status ? <p className="mt-2 text-xs text-neutral-600">{status}</p> : null}
      <p className="mt-3 text-xs text-neutral-500">
        The key never leaves this browser except to call openrouter.ai. Set a spend limit on it in
        your OpenRouter dashboard.
      </p>
    </Card>
  )
}

const SECTIONS = [
  { id: 'connection', label: 'Connection' },
  { id: 'quality', label: 'Quality & models' },
  { id: 'defaults', label: 'Defaults' },
  { id: 'data', label: 'Your data' },
] as const

export const SettingsPanel: FC = () => {
  const settings = useStore($settings)
  const vaultReplaced =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('vaultReplaced') === '1'
  const { models, loading, refresh } = useModels()

  return (
    <div className="grid gap-5 lg:grid-cols-[200px_minmax(0,1fr)]">
      <nav aria-label="Settings sections" className="lg:sticky lg:top-4 lg:self-start">
        <ul className="flex flex-wrap gap-1 lg:flex-col">
          {SECTIONS.map((s) => (
            <li key={s.id}>
              <a
                href={`#${s.id}`}
                className="block rounded-lg px-3 py-1.5 text-sm font-medium text-body hover:bg-neutral-100 hover:text-fg"
              >
                {s.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <div className="flex flex-col gap-5">
        {vaultReplaced ? (
          <p className="rounded-xl border border-warning/40 bg-warning-bg p-3 text-sm">
            The new key from OpenRouter replaced your encrypted key and is stored unencrypted.
            Encrypt it again below if you want it protected.
          </p>
        ) : null}
        <section id="connection" className="grid gap-5 md:grid-cols-2 scroll-mt-4">
          <KeySection />
          <ServerCard />
        </section>
        <section id="quality" className="grid gap-5 scroll-mt-4">
          <Card title="Quality & models">
            <p className="mb-3 text-sm text-body">
              The translator model is the promise; the other roles follow it unless set below. A
              preset fills every role from the live catalog.
            </p>
            <Field label="Translator model">
              <ModelPicker
                models={models}
                value={settings.translatorModel}
                loading={loading}
                onChange={(id) => $settings.setKey('translatorModel', id)}
              />
              <Button className="self-start" size="sm" onClick={refresh}>
                Refresh catalog
              </Button>
            </Field>
            <ModelAutoPick models={models} />
          </Card>
          <RoleModelsCard />
        </section>
        <section id="defaults" className="scroll-mt-4">
          <Card title="Defaults">
            <div className="flex flex-col gap-3">
              <Field
                label="Context budget (tokens per source)"
                hint="Sources above this size are condensed once by the helper model."
              >
                <input
                  className={inputClass}
                  type="number"
                  min={500}
                  max={32000}
                  value={settings.contextTokenBudget}
                  onChange={(e) => $settings.setKey('contextTokenBudget', e.target.value)}
                />
              </Field>
              <Field label="Guidelines budget (tokens)">
                <input
                  className={inputClass}
                  type="number"
                  min={200}
                  max={8000}
                  value={settings.guidelinesTokenBudget}
                  onChange={(e) => $settings.setKey('guidelinesTokenBudget', e.target.value)}
                />
              </Field>
              <Field
                label="Max tokens per chunk"
                hint="Longer texts are split into balanced chunks of at most this size."
              >
                <input
                  className={inputClass}
                  type="number"
                  min={200}
                  max={8000}
                  value={settings.maxTokensPerChunk}
                  onChange={(e) => $settings.setKey('maxTokensPerChunk', e.target.value)}
                />
              </Field>
              <Field label="Parallel requests" hint="Concurrent calls to OpenRouter.">
                <input
                  className={inputClass}
                  type="number"
                  min={1}
                  max={16}
                  value={settings.concurrency}
                  onChange={(e) => $settings.setKey('concurrency', e.target.value)}
                />
              </Field>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={settings.preserveFormatting === 'true'}
                  onChange={(e) =>
                    $settings.setKey('preserveFormatting', e.target.checked ? 'true' : 'false')
                  }
                />
                Preserve Markdown formatting
              </label>
            </div>
          </Card>
        </section>
        <section id="data" className="scroll-mt-4">
          <DataCard />
        </section>
      </div>
    </div>
  )
}
