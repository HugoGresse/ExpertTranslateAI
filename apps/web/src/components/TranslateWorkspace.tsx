import {
  type ContextSource,
  DEFAULT_JOB_OPTIONS,
  type GlossaryScope,
  type GuidelineSet,
  type JobEstimate,
  type PromptOverrides,
  type RouterRule,
  type Target,
  type TranslationJob,
} from '@experttranslate/core'
import { useStore } from '@nanostores/react'
import { type FC, useEffect, useMemo, useRef, useState } from 'react'
import { storage } from '../adapters/dexieStorage'
import { createEngineHandle } from '../adapters/engineFactory'
import { $apiKey } from '../adapters/keyVault'
import { logger } from '../adapters/logger'
import { LANGUAGES, languageName } from '../data/languages'
import { useModels } from '../hooks/useModels'
import { useRepo } from '../hooks/useRepo'
import { pickOneOf } from '../lib/guards'
import { $run, applyProgress, beginRun, idleRun } from '../stores/run'
import {
  $onboardingDone,
  $promptOverrides,
  $routing,
  $selectedContextIds,
  $selectedGlossaryIds,
  $selectedGuidelineIds,
  $settings,
  $sourceDraft,
  $targets,
  $useMemory,
  numberSetting,
  roleModels,
  type Settings,
  toggleId,
  usesServer,
} from '../stores/settings'
import { ContextQuickAdd } from './ContextQuickAdd'
import { FirstRunCard } from './FirstRunCard'
import { BriefCard } from './ResultDetails'
import { ResultPanel } from './ResultPanel'
import { RunStatus } from './RunStatus'
import { SourceInput } from './SourceInput'
import { TargetPicker } from './TargetPicker'
import { Button, basePath, Card, Chip, Field, formatUsd, inputClass, Segmented } from './ui'

const DOMAIN_OPTIONS = [
  'auto',
  'general',
  'legal',
  'technical',
  'marketing',
  'medical',
  'literary',
  'ui',
] as const
const DIFFICULTY_OPTIONS = ['auto', 'simple', 'normal', 'hard'] as const

const QUALITY: Array<{ value: (typeof DIFFICULTY_OPTIONS)[number]; label: string; hint: string }> =
  [
    { value: 'simple', label: 'Fast', hint: 'One model, no review' },
    { value: 'normal', label: 'Balanced', hint: 'Two translators, review, finalize, score' },
    { value: 'hard', label: 'Best', hint: 'Three translators, review, judge, finalize, score' },
    { value: 'auto', label: 'Auto', hint: 'The brief decides' },
  ]

const shortModel = (id: string): string => (id.split('/')[1] ?? id).replace(/-\d{4,}$/, '')

interface Selection {
  contextSourceIds: string[]
  guidelineSetIds: string[]
  glossaryScopeIds: string[]
  useMemory: boolean
  routing: RouterRule[]
  promptOverrides: PromptOverrides
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
    domain: s.domain,
    difficulty: s.difficulty,
    models: roleModels(s),
    options: {
      preserveFormatting: s.preserveFormatting === 'true',
      maxTokensPerChunk: numberSetting(s.maxTokensPerChunk, DEFAULT_JOB_OPTIONS.maxTokensPerChunk),
      contextSourceIds: selection.contextSourceIds,
      guidelineSetIds: selection.guidelineSetIds,
      contextTokenBudget: numberSetting(
        s.contextTokenBudget,
        DEFAULT_JOB_OPTIONS.contextTokenBudget,
      ),
      guidelinesTokenBudget: numberSetting(
        s.guidelinesTokenBudget,
        DEFAULT_JOB_OPTIONS.guidelinesTokenBudget,
      ),
      budgetUsd: s.budgetUsd.trim() ? numberSetting(s.budgetUsd, 0) || null : null,
      reasoningEffort: s.reasoningEffort,
      glossaryScopeIds: selection.glossaryScopeIds,
      useMemory: selection.useMemory,
      autoEscalate: s.autoEscalate === 'true',
      escalationConfidence: numberSetting(
        s.escalationConfidence,
        DEFAULT_JOB_OPTIONS.escalationConfidence,
        0,
      ),
      routing: selection.routing,
      backTranslate: s.backTranslate === 'true',
      suggestGlossary: s.suggestGlossary === 'true',
      promptOverrides: selection.promptOverrides,
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
  const selectedGlossaryIds = useStore($selectedGlossaryIds)
  const useMemory = useStore($useMemory) === 'true'
  const routing = useStore($routing)
  const promptOverrides = useStore($promptOverrides)
  const glossaryScopes = useRepo<GlossaryScope>(storage.glossaryScopes)
  const contexts = useRepo<ContextSource>(storage.contexts)
  const guidelines = useRepo<GuidelineSet>(storage.guidelines)
  const { models, loading } = useModels()
  const controller = useRef<AbortController | null>(null)
  const [estimate, setEstimate] = useState<JobEstimate | null>(null)
  const [styleOpen, setStyleOpen] = useState(false)
  const [addContext, setAddContext] = useState(false)
  const [editing, setEditing] = useState(false)
  const selection = useMemo<Selection>(
    () => ({
      contextSourceIds: selectedContextIds.filter((id) =>
        contexts.items.some((c) => c.id === id && c.enabled),
      ),
      guidelineSetIds: selectedGuidelineIds.filter((id) =>
        guidelines.items.some((g) => g.id === id && g.enabled),
      ),
      glossaryScopeIds: selectedGlossaryIds.filter((id) =>
        glossaryScopes.items.some((g) => g.id === id),
      ),
      useMemory,
      routing,
      promptOverrides,
    }),
    [
      selectedContextIds,
      selectedGuidelineIds,
      selectedGlossaryIds,
      useMemory,
      routing,
      promptOverrides,
      contexts.items,
      guidelines.items,
      glossaryScopes.items,
    ],
  )

  const remote = usesServer(settings)
  const { serverUrl, serverToken, concurrency } = settings
  const engineFactory = useMemo(() => {
    const handle = createEngineHandle(
      { serverUrl, serverToken },
      apiKey,
      numberSetting(concurrency, 4),
    )
    return handle ? () => handle : null
  }, [apiKey, serverUrl, serverToken, concurrency])

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
    beginRun(job.difficulty)
    setEditing(false)
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
      if ($run.get().status === 'done') $onboardingDone.set('true')
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
  const canRun = engineFactory !== null && !busy && source.trim().length > 0 && targets.length > 0
  const resolved = roleModels(settings)
  const translators = [
    ...new Set([resolved.translatorA, resolved.translatorB, resolved.translatorC]),
  ]
  const styleSummary = [
    settings.formality !== 'auto' ? settings.formality : null,
    settings.tone || null,
    settings.audience ? `for ${settings.audience}` : null,
    settings.domain !== 'auto' ? settings.domain : null,
    settings.backTranslate === 'true' ? 'back-translate' : null,
  ].filter(Boolean)
  const wordCount = source.trim() ? source.trim().split(/\s+/).length : 0
  const focused = run.status !== 'idle' && !editing
  const materialsCount =
    selection.contextSourceIds.length +
    selection.glossaryScopeIds.length +
    selection.guidelineSetIds.length +
    (useMemory ? 1 : 0)
  const firstLine =
    source
      .trim()
      .split('\n')[0]
      ?.replace(/^#+\s*/, '') ?? ''

  const translateButton = (
    <Button
      variant="primary"
      size="lg"
      className="w-full"
      disabled={!canRun}
      loading={busy}
      onClick={() => void start()}
    >
      {busy ? 'Translating…' : 'Translate'}
      {!busy && estimate?.estimatedUsd !== null && estimate?.estimatedUsd !== undefined
        ? ` · est. ${formatUsd(estimate.estimatedUsd)}`
        : ''}
    </Button>
  )

  return (
    <div
      className="flex flex-col gap-5"
      style={{ '--result-h': 'calc(100vh - 25rem)' } as React.CSSProperties}
    >
      {focused ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-line bg-canvas px-5 py-3 text-sm">
          <span className="max-w-[40ch] truncate font-semibold text-fg" title={firstLine}>
            {firstLine || 'Untitled text'}
          </span>
          <span className="text-body">
            {wordCount} words → {targets.map((t) => languageName(t.lang)).join(', ')}
          </span>
          <span className="text-muted">
            {QUALITY.find((q) => q.value === run.difficulty)?.label ?? run.difficulty} ·{' '}
            {materialsCount} material{materialsCount === 1 ? '' : 's'}
          </span>
          <span className="ml-auto flex gap-2">
            <Button size="sm" onClick={() => setEditing(true)}>
              {busy ? 'Show source' : 'Edit and rerun'}
            </Button>
            {!busy ? (
              <Button
                size="sm"
                variant="weak"
                onClick={() => {
                  $run.set(idleRun)
                  $sourceDraft.set('')
                  setEditing(false)
                }}
              >
                New translation
              </Button>
            ) : null}
          </span>
        </div>
      ) : null}
      {!focused ? <FirstRunCard /> : null}
      <div className={`grid gap-5 xl:grid-cols-[minmax(0,1fr)_400px] ${focused ? 'hidden' : ''}`}>
        <Card
          title="Source"
          actions={
            <span className="text-xs text-muted">
              {wordCount > 0
                ? `${wordCount} words · ${settings.sourceLang === 'auto' ? 'language auto-detected' : languageName(settings.sourceLang)}`
                : 'Paste text or Markdown, or drop a file'}
            </span>
          }
        >
          <SourceInput value={source} onChange={(text) => $sourceDraft.set(text)} />
        </Card>

        <Card title="Recipe" className="self-start">
          <dl className="flex flex-col divide-y divide-line text-sm">
            <div className="grid grid-cols-[88px_1fr] gap-3 py-3">
              <dt className="pt-1 font-semibold text-body">Into</dt>
              <dd>
                <TargetPicker targets={targets} onChange={(t) => $targets.set(t)} />
              </dd>
            </div>
            <div className="grid grid-cols-[88px_1fr] gap-3 py-3">
              <dt className="pt-1 font-semibold text-body">Quality</dt>
              <dd className="flex flex-col gap-1">
                <Segmented
                  label="Quality"
                  options={QUALITY}
                  value={settings.difficulty}
                  onChange={(v) => $settings.setKey('difficulty', v)}
                />
                <span className="text-xs text-muted">
                  {QUALITY.find((q) => q.value === settings.difficulty)?.hint}
                </span>
              </dd>
            </div>
            <div className="grid grid-cols-[88px_1fr] gap-3 py-3">
              <dt className="pt-0.5 font-semibold text-body">Models</dt>
              <dd className="text-xs text-body">
                {loading ? (
                  'Loading catalog…'
                ) : (
                  <>
                    <span className="font-medium text-fg">
                      {translators.map(shortModel).join(' + ')}
                    </span>
                    {settings.difficulty !== 'simple' ? (
                      <>
                        {' → review '}
                        {shortModel(resolved.reviewer)}
                        {' → final '}
                        {shortModel(resolved.finalizer)}
                      </>
                    ) : null}
                    <br />
                    <a href={basePath('/settings#quality')} className="text-weak-fg underline">
                      Change models or preset
                    </a>
                  </>
                )}
              </dd>
            </div>
            <div className="grid grid-cols-[88px_1fr] gap-3 py-3">
              <dt className="pt-1 font-semibold text-body">Context</dt>
              <dd className="flex flex-wrap items-center gap-1.5">
                {contexts.items
                  .filter((c) => c.enabled)
                  .map((c) => (
                    <Chip
                      key={c.id}
                      active={selectedContextIds.includes(c.id)}
                      {...(c.lang ? { title: `Only for ${languageName(c.lang)}` } : {})}
                      onClick={() => $selectedContextIds.set(toggleId(selectedContextIds, c.id))}
                    >
                      {c.name}
                    </Chip>
                  ))}
                <Chip onClick={() => setAddContext((v) => !v)} active={addContext}>
                  + add
                </Chip>
                {addContext ? (
                  <div className="w-full">
                    <ContextQuickAdd
                      onAdd={async (sourceItem) => {
                        await contexts.save(sourceItem)
                        $selectedContextIds.set([...$selectedContextIds.get(), sourceItem.id])
                        setAddContext(false)
                      }}
                    />
                  </div>
                ) : null}
              </dd>
            </div>
            <div className="grid grid-cols-[88px_1fr] gap-3 py-3">
              <dt className="pt-1 font-semibold text-body">Glossary</dt>
              <dd className="flex flex-wrap items-center gap-1.5">
                {glossaryScopes.items.length === 0 ? (
                  <span className="text-xs text-muted">
                    None yet. Terms get suggested after each run.
                  </span>
                ) : null}
                {glossaryScopes.items.map((g) => (
                  <Chip
                    key={g.id}
                    active={selectedGlossaryIds.includes(g.id)}
                    title={g.level}
                    onClick={() => $selectedGlossaryIds.set(toggleId(selectedGlossaryIds, g.id))}
                  >
                    {g.name}
                  </Chip>
                ))}
              </dd>
            </div>
            <div className="grid grid-cols-[88px_1fr] gap-3 py-3">
              <dt className="pt-1 font-semibold text-body">Guidelines</dt>
              <dd className="flex flex-wrap items-center gap-1.5">
                {guidelines.items.filter((g) => g.enabled).length === 0 ? (
                  <a href={basePath('/guidelines')} className="text-xs text-weak-fg underline">
                    Add a style guide
                  </a>
                ) : null}
                {guidelines.items
                  .filter((g) => g.enabled)
                  .map((g) => (
                    <Chip
                      key={g.id}
                      active={selectedGuidelineIds.includes(g.id)}
                      onClick={() =>
                        $selectedGuidelineIds.set(toggleId(selectedGuidelineIds, g.id))
                      }
                    >
                      {g.name}
                    </Chip>
                  ))}
              </dd>
            </div>
            <div className="grid grid-cols-[88px_1fr] gap-3 py-3">
              <dt className="pt-1 font-semibold text-body">Memory</dt>
              <dd>
                <Chip
                  active={useMemory}
                  onClick={() => $useMemory.set(useMemory ? 'false' : 'true')}
                >
                  {useMemory ? 'Reuse past translations' : 'Off'}
                </Chip>
              </dd>
            </div>
            <div className="grid grid-cols-[88px_1fr] gap-3 py-3">
              <dt className="pt-0.5 font-semibold text-body">Style</dt>
              <dd className="text-xs text-body">
                {styleSummary.length > 0 ? styleSummary.join(' · ') : 'Default tone and register'}{' '}
                <button
                  type="button"
                  className="text-weak-fg underline"
                  onClick={() => setStyleOpen((v) => !v)}
                >
                  {styleOpen ? 'close' : 'edit'}
                </button>
                {styleOpen ? (
                  <div className="mt-2 grid gap-2">
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
                    <Field label="Tone">
                      <input
                        className={inputClass}
                        placeholder="e.g. warm, concise"
                        value={settings.tone}
                        onChange={(e) => $settings.setKey('tone', e.target.value)}
                      />
                    </Field>
                    <Field label="Audience">
                      <input
                        className={inputClass}
                        placeholder="e.g. developers"
                        value={settings.audience}
                        onChange={(e) => $settings.setKey('audience', e.target.value)}
                      />
                    </Field>
                    <Field label="Domain" hint="Auto lets the brief detect it.">
                      <select
                        className={inputClass}
                        value={settings.domain}
                        onChange={(e) =>
                          $settings.setKey(
                            'domain',
                            pickOneOf(DOMAIN_OPTIONS, e.target.value, 'auto'),
                          )
                        }
                      >
                        {DOMAIN_OPTIONS.map((d) => (
                          <option key={d} value={d}>
                            {d}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={settings.backTranslate === 'true'}
                        onChange={(e) =>
                          $settings.setKey('backTranslate', e.target.checked ? 'true' : 'false')
                        }
                      />
                      Back-translate and list meaning deltas
                    </label>
                  </div>
                ) : null}
              </dd>
            </div>
            <div className="grid grid-cols-[88px_1fr] gap-3 py-3">
              <dt className="pt-1 font-semibold text-body">Cap</dt>
              <dd className="flex items-center gap-2 text-xs text-body">
                <span>$</span>
                <input
                  className={`${inputClass} w-24`}
                  type="number"
                  min={0}
                  step={0.05}
                  placeholder="none"
                  aria-label="Budget cap in USD"
                  value={settings.budgetUsd}
                  onChange={(e) => $settings.setKey('budgetUsd', e.target.value)}
                />
                <span>per run</span>
              </dd>
            </div>
          </dl>
          <div className="mt-4 flex flex-col gap-2">
            {translateButton}
            {busy ? (
              <Button variant="danger" onClick={cancel}>
                Cancel
              </Button>
            ) : null}
            {estimate ? (
              <p className="text-center text-xs text-muted">
                ~{estimate.sourceTokens} tokens · {estimate.chunkCount} chunk
                {estimate.chunkCount > 1 ? 's' : ''} · {estimate.callCount} calls
                {!engineFactory && !remote ? ' · connect a key to run' : ''}
              </p>
            ) : null}
          </div>
        </Card>
      </div>

      {run.status !== 'idle' ? (
        <Card
          className={focused ? 'min-h-[calc(100vh-9rem)]' : ''}
          actions={
            <div className="flex items-center gap-3">
              <RunStatus run={run} compact />
              {busy ? (
                <Button variant="danger" size="sm" onClick={cancel}>
                  Cancel
                </Button>
              ) : null}
              {!busy && editing ? (
                <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
                  Focus
                </Button>
              ) : null}
            </div>
          }
        >
          {run.error ? <p className="mb-2 text-sm text-danger">{run.error}</p> : null}
          {run.status === 'cancelled' ? (
            <p className="mb-2 text-sm text-warning">Cancelled.</p>
          ) : null}
          {run.brief ? <BriefCard brief={run.brief} /> : null}
          <ResultPanel
            targets={run.targets}
            board={{
              stages: run.stages,
              difficulty: run.difficulty,
              models: resolved,
              suggestGlossary: settings.suggestGlossary === 'true',
              backTranslate: settings.backTranslate === 'true',
            }}
          />
          {run.cost ? (
            <p className="mt-4 text-sm">
              Total: {run.cost.calls} calls · {run.cost.tokensIn} in / {run.cost.tokensOut} out ·{' '}
              <strong>{formatUsd(run.cost.usd)}</strong>
            </p>
          ) : null}
        </Card>
      ) : null}
    </div>
  )
}
