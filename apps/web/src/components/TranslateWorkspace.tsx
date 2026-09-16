import type {
  ContextSource,
  GuidelineSet,
  JobEstimate,
  Target,
  TranslationJob,
} from '@experttranslate/core'
import { useStore } from '@nanostores/react'
import { type FC, useEffect, useMemo, useRef, useState } from 'react'
import { storage } from '../adapters/dexieStorage'
import { createBrowserEngine } from '../adapters/engineFactory'
import { $apiKey } from '../adapters/keyVault'
import { logger } from '../adapters/logger'
import { LANGUAGES } from '../data/languages'
import { useModels } from '../hooks/useModels'
import { useRepo } from '../hooks/useRepo'
import { $run, applyProgress, idleRun } from '../stores/run'
import {
  $selectedContextIds,
  $selectedGuidelineIds,
  $settings,
  $sourceDraft,
  $targets,
  numberSetting,
  type Settings,
  toggleId,
} from '../stores/settings'
import { KeyGate } from './KeyGate'
import { MaterialChips } from './MaterialChips'
import { ModelPicker } from './ModelPicker'
import { ResultPanel } from './ResultPanel'
import { TargetPicker } from './TargetPicker'
import { Button, Card, Field, formatUsd, inputClass } from './ui'

interface Selection {
  contextSourceIds: string[]
  guidelineSetIds: string[]
}

const buildJob = (
  source: string,
  s: Settings,
  targets: Target[],
  selection: Selection,
): TranslationJob => {
  return {
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    sourceText: source,
    sourceLang: s.sourceLang,
    targets,
    domain: 'auto',
    difficulty: 'simple',
    models: { translatorA: s.translatorModel, helper: s.helperModel || s.translatorModel },
    options: {
      preserveFormatting: s.preserveFormatting === 'true',
      maxTokensPerChunk: numberSetting(s.maxTokensPerChunk, 1000),
      contextSourceIds: selection.contextSourceIds,
      guidelineSetIds: selection.guidelineSetIds,
      contextTokenBudget: numberSetting(s.contextTokenBudget, 4000),
      guidelinesTokenBudget: numberSetting(s.guidelinesTokenBudget, 1500),
      formality: s.formality,
      ...(s.tone ? { tone: s.tone } : {}),
      ...(s.audience ? { audience: s.audience } : {}),
    },
    status: 'queued',
  }
}

export const TranslateWorkspace: FC = () => {
  const apiKey = useStore($apiKey)
  const settings = useStore($settings)
  const targets = useStore($targets)
  const source = useStore($sourceDraft)
  const run = useStore($run)
  const selectedContextIds = useStore($selectedContextIds)
  const selectedGuidelineIds = useStore($selectedGuidelineIds)
  const contexts = useRepo<ContextSource>(storage.contexts)
  const guidelines = useRepo<GuidelineSet>(storage.guidelines)
  const { models, loading } = useModels()
  const controller = useRef<AbortController | null>(null)
  const [estimate, setEstimate] = useState<JobEstimate | null>(null)
  const selection = useMemo<Selection>(
    () => ({
      contextSourceIds: selectedContextIds.filter((id) =>
        contexts.items.some((c) => c.id === id && c.enabled),
      ),
      guidelineSetIds: selectedGuidelineIds.filter((id) =>
        guidelines.items.some((g) => g.id === id && g.enabled),
      ),
    }),
    [selectedContextIds, selectedGuidelineIds, contexts.items, guidelines.items],
  )

  const engineFactory = useMemo(
    () =>
      apiKey ? () => createBrowserEngine(apiKey, numberSetting(settings.concurrency, 4)) : null,
    [apiKey, settings.concurrency],
  )

  useEffect(() => {
    if (!engineFactory || source.trim().length === 0 || targets.length === 0) {
      setEstimate(null)
      return
    }
    const handle = setTimeout(() => {
      setEstimate(
        engineFactory().engine.estimate(
          buildJob(source, settings, targets, selection),
          models,
          contexts.items,
        ),
      )
    }, 300)
    return () => clearTimeout(handle)
  }, [engineFactory, source, targets, models, settings, selection, contexts.items])

  const start = async (): Promise<void> => {
    if (!engineFactory) return
    const job = buildJob(source, settings, targets, selection)
    controller.current = new AbortController()
    logger.info('run.start', {
      jobId: job.id,
      targets: job.targets.length,
      model: job.models.translatorA,
    })
    try {
      for await (const event of engineFactory().engine.run(job, {
        signal: controller.current.signal,
      })) {
        applyProgress(event)
      }
    } catch (error) {
      logger.error('run.failed', { error: String(error) })
      $run.setKey('status', 'failed')
      $run.setKey('error', error instanceof Error ? error.message : String(error))
    } finally {
      if (controller.current?.signal.aborted) $run.setKey('status', 'cancelled')
      controller.current = null
    }
  }

  const cancel = (): void => controller.current?.abort()

  const busy = run.status === 'running'
  const canRun = Boolean(apiKey) && !busy && source.trim().length > 0 && targets.length > 0

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="flex flex-col gap-4">
        {!apiKey ? <KeyGate /> : null}
        <Card title="Source">
          <textarea
            className="min-h-64 w-full rounded-md border border-neutral-300 p-2 text-sm"
            placeholder="Paste text or Markdown to translate…"
            value={source}
            onChange={(e) => $sourceDraft.set(e.target.value)}
          />
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <Field label="Source language">
              <select
                className={inputClass}
                value={settings.sourceLang}
                onChange={(e) => $settings.setKey('sourceLang', e.target.value)}
              >
                <option value="auto">Auto-detect</option>
                {LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Formality">
              <select
                className={inputClass}
                value={settings.formality}
                onChange={(e) =>
                  $settings.setKey('formality', e.target.value as typeof settings.formality)
                }
              >
                <option value="auto">Auto</option>
                <option value="formal">Formal</option>
                <option value="informal">Informal</option>
              </select>
            </Field>
            <Field label="Tone (optional)">
              <input
                className={inputClass}
                value={settings.tone}
                onChange={(e) => $settings.setKey('tone', e.target.value)}
              />
            </Field>
            <Field label="Audience (optional)">
              <input
                className={inputClass}
                value={settings.audience}
                onChange={(e) => $settings.setKey('audience', e.target.value)}
              />
            </Field>
          </div>
        </Card>
        <Card title="Targets">
          <TargetPicker targets={targets} onChange={(t) => $targets.set(t)} />
        </Card>
        <Card title="Context and guidelines">
          <MaterialChips
            label="Context"
            emptyHint="No context sources. Add an llms.txt or Markdown file on the Context page."
            items={contexts.items
              .filter((c) => c.enabled)
              .map((c) => ({ id: c.id, name: c.name, lang: c.lang }))}
            selected={selectedContextIds}
            onToggle={(id) => $selectedContextIds.set(toggleId(selectedContextIds, id))}
          />
          <MaterialChips
            label="Guidelines"
            emptyHint="No guideline sets. Create one on the Guidelines page."
            items={guidelines.items
              .filter((g) => g.enabled)
              .map((g) => ({ id: g.id, name: g.name, lang: g.lang }))}
            selected={selectedGuidelineIds}
            onToggle={(id) => $selectedGuidelineIds.set(toggleId(selectedGuidelineIds, id))}
          />
        </Card>
        <Card title="Model">
          <ModelPicker
            models={models}
            value={settings.translatorModel}
            loading={loading}
            onChange={(id) => $settings.setKey('translatorModel', id)}
          />
        </Card>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" disabled={!canRun} onClick={() => void start()}>
            Translate
          </Button>
          {busy ? (
            <Button variant="danger" onClick={cancel}>
              Cancel
            </Button>
          ) : null}
          {run.status !== 'idle' && !busy ? (
            <Button variant="ghost" onClick={() => $run.set(idleRun)}>
              Clear
            </Button>
          ) : null}
          {estimate ? (
            <span className="text-xs text-neutral-600">
              ~{estimate.sourceTokens} tokens · {estimate.chunkCount} chunk
              {estimate.chunkCount > 1 ? 's' : ''} · {estimate.callCount} calls
              {estimate.estimatedUsd !== null ? ` · est. ${formatUsd(estimate.estimatedUsd)}` : ''}
            </span>
          ) : null}
        </div>
      </div>
      <Card title="Result">
        {run.status === 'idle' ? (
          <p className="text-sm text-neutral-500">Results appear here.</p>
        ) : null}
        {run.error ? <p className="mb-2 text-sm text-red-700">{run.error}</p> : null}
        {run.status === 'cancelled' ? (
          <p className="mb-2 text-sm text-amber-700">Cancelled.</p>
        ) : null}
        <ResultPanel targets={run.targets} />
        {run.cost ? (
          <p className="mt-3 text-xs text-neutral-600">
            Total: {run.cost.calls} calls · {run.cost.tokensIn} in / {run.cost.tokensOut} out ·{' '}
            {formatUsd(run.cost.usd)}
          </p>
        ) : null}
      </Card>
    </div>
  )
}
