import type { GuidelineViolation, TargetResult, TraceEvent } from '@experttranslate/core'
import { type FC, useEffect, useState } from 'react'
import { languageName, RTL_LANGS } from '../data/languages'
import type { TargetProgress } from '../stores/run'
import { Button, formatUsd } from './ui'

export interface ResultPanelProps {
  targets: Record<string, TargetProgress>
}

const download = (lang: string, text: string): void => {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `translation-${lang}.txt`
  a.click()
  URL.revokeObjectURL(url)
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
  useEffect(() => setText(result.finalText), [result.finalText])
  const dir = RTL_LANGS.has(result.lang) ? 'rtl' : 'ltr'
  return (
    <div>
      <textarea
        className="min-h-64 w-full rounded-md border border-neutral-300 p-2 text-sm"
        value={text}
        dir={dir}
        lang={result.lang}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-neutral-600">
        <Button onClick={() => void navigator.clipboard.writeText(text)}>Copy</Button>
        <Button onClick={() => download(result.lang, text)}>Download</Button>
        <span>
          {result.chunks.length} chunk{result.chunks.length > 1 ? 's' : ''} · {result.cost.tokensIn}{' '}
          in / {result.cost.tokensOut} out · {formatUsd(result.cost.usd)}
        </span>
      </div>
      <GuidelineReport violations={result.guidelineReport} />
      <TraceDrawer trace={result.trace} />
    </div>
  )
}

export const ResultPanel: FC<ResultPanelProps> = ({ targets }) => {
  const langs = Object.keys(targets)
  const [active, setActive] = useState(langs[0] ?? '')
  useEffect(() => {
    if (!langs.includes(active) && langs[0]) setActive(langs[0])
  }, [langs, active])
  const current = targets[active]
  if (!current) return null

  return (
    <div>
      <div role="tablist" className="flex flex-wrap gap-1 border-b border-neutral-200">
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
              className={`px-3 py-1.5 text-sm ${lang === active ? 'border-b-2 border-accent font-medium' : 'text-neutral-600'}`}
              onClick={() => setActive(lang)}
            >
              {languageName(lang)} {badge}
            </button>
          )
        })}
      </div>
      <div className="pt-3">
        {current.status === 'failed' ? (
          <p className="text-sm text-red-700">{current.error}</p>
        ) : null}
        {current.status === 'running' ? (
          <div>
            <p className="mb-1 text-xs text-neutral-500">
              Chunk {Math.min(current.chunksDone + 1, current.chunkCount)} of {current.chunkCount}
            </p>
            <pre className="min-h-32 whitespace-pre-wrap rounded-md border border-neutral-200 bg-neutral-50 p-2 text-sm">
              {current.streamed}
            </pre>
          </div>
        ) : null}
        {current.result ? <FinalText result={current.result} /> : null}
      </div>
    </div>
  )
}
