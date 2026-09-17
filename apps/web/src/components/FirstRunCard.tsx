import { useStore } from '@nanostores/react'
import type { FC } from 'react'
import { $apiKey, $keyLocked } from '../adapters/keyVault'
import { useModels } from '../hooks/useModels'
import {
  $onboardingDone,
  $settings,
  $sourceDraft,
  DEFAULT_MODEL,
  usesServer,
} from '../stores/settings'
import { UnlockForm } from './KeyVaultCard'
import { ModelAutoPick } from './ModelAutoPick'
import { Button, basePath } from './ui'

export const SAMPLE_TEXT = `# Release notes

The workflow editor now saves drafts automatically every thirty seconds. You can restore any draft from the History panel.

Exports to CSV include the new **owner** column. Existing integrations keep working because the column is appended at the end.

We fixed a bug where {{count}} items were reported as one item in the summary email.`

const Step: FC<{ n: number; done: boolean; title: string; children?: React.ReactNode }> = ({
  n,
  done,
  title,
  children,
}) => (
  <li
    className={`rounded-xl border p-4 ${done ? 'border-success/40 bg-success-bg' : 'border-line bg-canvas'}`}
  >
    <p className="text-sm font-semibold">
      <span
        className={`mr-2 inline-flex h-6 w-6 items-center justify-center rounded-full text-xs ${done ? 'bg-success text-white' : 'bg-weak-bg text-weak-fg'}`}
      >
        {done ? '✓' : n}
      </span>
      {title}
    </p>
    {children ? <div className="mt-2 text-sm text-body">{children}</div> : null}
  </li>
)

/** Three steps for a first visit; disappears after the first successful translation. */
export const FirstRunCard: FC = () => {
  const apiKey = useStore($apiKey)
  const locked = useStore($keyLocked)
  const settings = useStore($settings)
  const done = useStore($onboardingDone) === 'true'
  const { models } = useModels()
  const remote = usesServer(settings)
  const connected = Boolean(apiKey) || remote
  const picked = settings.translatorModel !== DEFAULT_MODEL || settings.helperModel !== ''
  if (done && connected) return null
  if (locked)
    return (
      <div className="rounded-2xl border border-warning/40 bg-warning-bg p-4">
        <UnlockForm />
      </div>
    )
  return (
    <section className="rounded-2xl border border-primary/30 bg-canvas p-5">
      <h2 className="text-xl font-bold">Three things, then you never see this again.</h2>
      <ol className="mt-4 grid gap-3 md:grid-cols-3">
        <Step n={1} done={connected} title="Connect OpenRouter">
          {connected ? (
            'Connected. The key stays in this browser.'
          ) : (
            <>
              Paste a key or sign in on the{' '}
              <a href={basePath('/settings')} className="font-semibold text-weak-fg underline">
                Settings page
              </a>
              . Set a spend limit on it; it never leaves this browser.
            </>
          )}
        </Step>
        <Step n={2} done={picked} title="Pick models">
          {connected ? (
            <ModelAutoPick models={models} compact />
          ) : (
            'Once connected, one click picks translators, a reviewer and a helper from the live catalog.'
          )}
        </Step>
        <Step n={3} done={false} title="Translate something">
          <Button
            variant="weak"
            size="sm"
            disabled={!connected}
            onClick={() => $sourceDraft.set(SAMPLE_TEXT)}
          >
            Load a sample text
          </Button>
          <span className="ml-2 text-xs text-muted">or paste your own below.</span>
        </Step>
      </ol>
    </section>
  )
}
