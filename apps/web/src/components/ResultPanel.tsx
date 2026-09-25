import {
  fileSafeTargetKey,
  type GuidelineViolation,
  learnCorrections,
  markHumanEdit,
  restorePlaceholders,
  type TargetResult,
  type TraceEvent,
  wordEditDistance,
} from '@experttranslate/core'
import { useStore } from '@nanostores/react'
import { type FC, type ReactNode, useEffect, useMemo, useState } from 'react'
import { storage } from '../adapters/dexieStorage'
import { logger } from '../adapters/logger'
import { languageLabel, textDirection } from '../data/languages'
import { downloadText } from '../lib/download'
import { $previews, previewChunks, type TargetProgress } from '../stores/run'
import { BackTranslationCard } from './BackTranslationCard'
import { GlossarySuggestionsCard } from './GlossarySuggestionsCard'
import { PipelineBoard, type PipelineBoardProps } from './PipelineBoard'
import {
  CandidatesCard,
  DisagreementsCard,
  ReviewCard,
  ScoreCard,
  TerminologyReport,
} from './ResultDetails'
import { Button, formatUsd } from './ui'

export interface ResultPanelProps {
  targets: Record<string, TargetProgress>
  board: Omit<PipelineBoardProps, 'targetKey' | 'progress'>
  /** Rendered on the tab row, right-aligned: status, cost, cancel. */
  trailing?: ReactNode
  /** Rendered between the tab row and the board (the brief). */
  above?: ReactNode
}

const TraceDrawer: FC<{ trace: TraceEvent[] }> = ({ trace }) => {
  const [open, setOpen] = useState(false)
  return (
    <div className="mt-3">
      <Button variant="ghost" onClick={() => setOpen((o) => !o)}>
        {open ? 'Hide trace' : `Show trace (${trace.length} calls)`}
      </Button>
      {open ? (
        <ol className="mt-2 flex flex-col gap-2">
          {trace.map((t) => (
            <li
              key={`${t.stage}-${t.role}-${t.chunkIndex}`}
              className="rounded-md border border-neutral-200 bg-neutral-50 p-2 text-xs"
            >
              <div className="flex flex-wrap gap-3 font-mono">
                <span>{t.stage}</span>
                <span>{t.role}</span>
                <span>{t.model}</span>
                <span>chunk {t.chunkIndex}</span>
                <span>{t.latencyMs} ms</span>
                <span>
                  {t.usage.promptTokens} in / {t.usage.completionTokens} out
                </span>
                {t.usage.costUsd !== null ? <span>{formatUsd(t.usage.costUsd)}</span> : null}
              </div>
              <details className="mt-1">
                <summary className="cursor-pointer">Prompt</summary>
                <pre className="mt-1 whitespace-pre-wrap">{t.prompt.system}</pre>
                <pre className="mt-1 whitespace-pre-wrap">{t.prompt.user}</pre>
              </details>
              <details className="mt-1">
                <summary className="cursor-pointer">Output</summary>
                <pre className="mt-1 whitespace-pre-wrap">{t.output}</pre>
              </details>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  )
}

const GuidelineReport: FC<{ violations: GuidelineViolation[] }> = ({ violations }) => {
  if (violations.length === 0)
    return <p className="mt-2 text-xs text-green-700">Guidelines: no rule violations detected.</p>
  return (
    <div className="mt-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs">
      <p className="font-medium">
        Guidelines: {violations.length} violation{violations.length > 1 ? 's' : ''}
      </p>
      <ul className="mt-1 list-disc pl-4">
        {violations.map((v) => (
          <li key={`${v.ruleId}-${v.targetSpan ?? ''}`}>
            <span className="font-medium">{v.ruleText}</span> — {v.explanation}
          </li>
        ))}
      </ul>
    </div>
  )
}

const FinalText: FC<{ result: TargetResult }> = ({ result }) => {
  const [text, setText] = useState(result.finalText)
  const [saved, setSaved] = useState<string | null>(null)
  useEffect(() => setText(result.finalText), [result.finalText])
  const canLearn = result.sourceLang !== null
  const saveCorrection = async (): Promise<void> => {
    if (!result.sourceLang) return
    const entries = learnCorrections({
      sourceText: result.sourceText,
      originalText: result.finalText,
      editedText: text,
      sourceLang: result.sourceLang,
      targetLang: result.lang,
      makeId: () => crypto.randomUUID(),
      now: Date.now(),
    })
    try {
      for (const e of entries) await storage.tm.put(e)
      await markHumanEdited(result, text)
      // Keep the edit on the stored result so reopening the job from history shows it.
      await storage.results.put({ ...result, finalText: text })
      logger.info('memory.learned', { lang: result.lang, count: entries.length })
      setSaved(
        entries.length === 0
          ? 'No changes to save.'
          : `Saved ${entries.length} correction${entries.length > 1 ? 's' : ''} to memory.`,
      )
    } catch (error) {
      logger.error('memory.learnFailed', { lang: result.lang, error: String(error) })
      setSaved('Could not save to memory.')
    }
  }
  const dir = textDirection(result.lang)
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]">
      <div className="flex min-h-0 flex-col">
        <textarea
          className="w-full flex-1 rounded-[10px] border border-line p-3 text-[15px] leading-relaxed [min-height:var(--result-h)]"
          value={text}
          dir={dir}
          lang={result.lang}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-neutral-600">
          <Button onClick={() => void navigator.clipboard.writeText(text)}>Copy</Button>
          <Button
            onClick={() =>
              downloadText(`translation-${fileSafeTargetKey(result.targetKey)}.txt`, text)
            }
          >
            Download
          </Button>
          <Button
            disabled={text === result.finalText || !canLearn}
            title={
              canLearn
                ? undefined
                : 'Set a source language (or run with a brief) to learn corrections'
            }
            onClick={() => void saveCorrection()}
          >
            Save as correction
          </Button>
          {saved ? <span>{saved}</span> : null}
          <span>
            {result.chunks.length} chunk{result.chunks.length > 1 ? 's' : ''} ·{' '}
            {result.cost.tokensIn} in / {result.cost.tokensOut} out · {formatUsd(result.cost.usd)}
          </span>
        </div>
        <p className="mt-2 text-xs text-neutral-500">
          Pipeline: {result.plan.difficulty} · {result.plan.translators.length} translator
          {result.plan.translators.length > 1 ? 's' : ''}
          {result.reviews.length > 0 ? ' · reviewed' : ''}
          {result.judgments.length > 0 ? ' · judged' : ''}
          {result.escalations.length > 0
            ? ` · escalated ${result.escalations[0]?.from} → ${result.escalations[0]?.to} (${result.escalations[0]?.reason})`
            : ''}
        </p>
      </div>
      <div className="min-h-0 overflow-y-auto pr-1 [max-height:var(--result-h)]">
        {result.score ? <ScoreCard score={result.score} /> : null}
        <GlossarySuggestionsCard key={result.targetKey} result={result} />
        <GuidelineReport violations={result.guidelineReport} />
        <TerminologyReport violations={result.terminologyReport} hits={result.memoryHits} />
        {result.backTranslation ? (
          <BackTranslationCard
            backTranslation={result.backTranslation}
            sourceText={result.sourceText}
          />
        ) : null}
        <DisagreementsCard disagreements={result.disagreements} />
        {result.reviews.length > 0 ? <ReviewCard reviews={result.reviews} /> : null}
        {result.candidates.length > 1 ? <CandidatesCard result={result} /> : null}
        <TraceDrawer trace={result.trace} />
      </div>
    </div>
  )
}

const StreamPreview: FC<{ targetKey: string; progress: TargetProgress }> = ({
  targetKey,
  progress,
}) => {
  const previews = useStore($previews)
  const placeholders = useMemo(
    () => new Map(Object.entries(progress.placeholders)),
    [progress.placeholders],
  )
  const chunks = previewChunks(previews[targetKey], progress.chunkCount)
  return (
    <div>
      <p className="mb-1 text-xs text-neutral-500">{progress.activity}</p>
      <div
        className="overflow-y-auto whitespace-pre-wrap rounded-[10px] border border-line bg-neutral-50 p-3 text-[15px] leading-relaxed [max-height:var(--result-h)] [min-height:12rem]"
        dir={textDirection(progress.lang)}
        lang={progress.lang}
      >
        {chunks.map((text, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: chunk index is the identity
          <p key={i} className={i > 0 ? 'mt-3' : ''}>
            {restorePlaceholders(text, placeholders)}
          </p>
        ))}
      </div>
    </div>
  )
}

export const ResultPanel: FC<ResultPanelProps> = ({ targets, board, trailing, above }) => {
  const langs = Object.keys(targets)
  const [active, setActive] = useState(langs[0] ?? '')
  useEffect(() => {
    if (!langs.includes(active) && langs[0]) setActive(langs[0])
  }, [langs, active])
  const current = targets[active]
  if (!current) return null

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line">
        <div role="tablist" className="flex flex-wrap gap-1">
          {langs.map((lang) => {
            const p = targets[lang]
            const badge =
              p?.status === 'done'
                ? '✓'
                : p?.status === 'failed'
                  ? '!'
                  : p?.status === 'running'
                    ? '…'
                    : ''
            return (
              <button
                key={lang}
                role="tab"
                type="button"
                aria-selected={lang === active}
                className={`px-3 py-2 text-sm ${lang === active ? 'border-b-2 border-primary font-semibold text-fg' : 'text-muted hover:text-body'}`}
                onClick={() => setActive(lang)}
              >
                {languageLabel(p?.lang ?? lang, p?.region)} {badge}
              </button>
            )
          })}
        </div>
        {trailing ? <div className="pb-2">{trailing}</div> : null}
      </div>
      {above ? <div className="pt-3">{above}</div> : null}
      <div className="flex flex-col gap-4 pt-4">
        <PipelineBoard
          targetKey={active}
          progress={current}
          {...board}
          models={current.result?.models ?? board.models}
        />
        {current.status === 'failed' ? (
          <p className="text-sm text-danger">{current.error}</p>
        ) : null}
        {current.status === 'running' ? (
          <StreamPreview targetKey={active} progress={current} />
        ) : null}
        {current.result ? (
          <FinalText key={current.result.targetKey} result={current.result} />
        ) : null}
      </div>
    </div>
  )
}

async function markHumanEdited(result: TargetResult, edited: string): Promise<void> {
  const record = await storage.evals.get(`${result.jobId}:${result.targetKey}`)
  if (!record) return
  await storage.evals.put(
    markHumanEdit(record, result.finalText, edited, wordEditDistance(result.finalText, edited)),
  )
}
