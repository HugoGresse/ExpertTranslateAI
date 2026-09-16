import {
  type ContextKind,
  type ContextSource,
  contentHash,
  countTokens,
  isLlmsTxt,
  needsCondense,
} from '@experttranslate/core'
import { useStore } from '@nanostores/react'
import { type FC, useState } from 'react'
import { browserFetch } from '../adapters/browserFetch'
import { storage } from '../adapters/dexieStorage'
import { logger } from '../adapters/logger'
import { LANGUAGES, languageName } from '../data/languages'
import { useRepo } from '../hooks/useRepo'
import { $settings, numberSetting } from '../stores/settings'
import { Button, Card, Field, inputClass } from './ui'

type Mode = 'url' | 'file' | 'paste'

const readFile = (file: File): Promise<string> => file.text()

async function buildSource(input: {
  name: string
  kind: ContextKind
  url?: string
  rawText: string
  lang?: string
}): Promise<ContextSource> {
  const source: ContextSource = {
    id: crypto.randomUUID(),
    name: input.name,
    kind: input.kind,
    rawText: input.rawText,
    contentHash: await contentHash(input.rawText),
    enabled: true,
    createdAt: Date.now(),
    ...(input.url ? { url: input.url, fetchedAt: Date.now() } : {}),
    ...(input.lang ? { lang: input.lang } : {}),
  }
  return source
}

const AddSourceForm: FC<{ onAdd: (s: ContextSource) => Promise<void> }> = ({ onAdd }) => {
  const [mode, setMode] = useState<Mode>('url')
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [text, setText] = useState('')
  const [lang, setLang] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const reset = (): void => {
    setName('')
    setUrl('')
    setText('')
    setFile(null)
    setError(null)
  }

  const submit = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      let rawText = text
      let kind: ContextKind = 'pasted'
      let sourceUrl: string | undefined
      if (mode === 'url') {
        const { body } = await browserFetch.text(url.trim())
        rawText = body
        sourceUrl = url.trim()
        kind = isLlmsTxt(body, sourceUrl) ? 'llms-txt' : 'markdown-url'
      } else if (mode === 'file') {
        if (!file) throw new Error('Choose a file first')
        rawText = await readFile(file)
        kind = isLlmsTxt(rawText, file.name) ? 'llms-txt' : 'markdown-file'
      } else if (isLlmsTxt(rawText)) {
        kind = 'llms-txt'
      }
      if (rawText.trim().length === 0) throw new Error('The source is empty')
      const finalName =
        name.trim() || (sourceUrl ? new URL(sourceUrl).hostname : file?.name) || 'Pasted context'
      await onAdd(
        await buildSource({
          name: finalName,
          kind,
          rawText,
          ...(sourceUrl ? { url: sourceUrl } : {}),
          ...(lang ? { lang } : {}),
        }),
      )
      logger.info('context.added', { kind, chars: rawText.length })
      reset()
    } catch (e) {
      logger.warn('context.addFailed', { error: String(e) })
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card title="Add context">
      <div className="flex flex-col gap-3">
        <div className="flex gap-2 text-sm">
          {(['url', 'file', 'paste'] as Mode[]).map((m) => (
            <Button
              key={m}
              variant={mode === m ? 'primary' : 'secondary'}
              onClick={() => setMode(m)}
            >
              {m === 'url' ? 'From URL' : m === 'file' ? 'Upload file' : 'Paste text'}
            </Button>
          ))}
        </div>
        <Field label="Name (optional)">
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        {mode === 'url' ? (
          <Field
            label="URL"
            hint="llms.txt, a Markdown page or a plain text file. Some sites block browser requests; upload or paste then."
          >
            <input
              className={inputClass}
              placeholder="https://example.com/llms.txt"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </Field>
        ) : null}
        {mode === 'file' ? (
          <Field label="File (.md, .txt)">
            <input
              type="file"
              accept=".md,.txt,.markdown,text/plain,text/markdown"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </Field>
        ) : null}
        {mode === 'paste' ? (
          <Field label="Text">
            <textarea
              className={`${inputClass} min-h-40`}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </Field>
        ) : null}
        <Field label="Only for target language (optional)">
          <select className={inputClass} value={lang} onChange={(e) => setLang(e.target.value)}>
            <option value="">All languages</option>
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.name}
              </option>
            ))}
          </select>
        </Field>
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        <Button
          variant="primary"
          className="self-start"
          disabled={busy}
          onClick={() => void submit()}
        >
          {busy ? 'Adding…' : 'Add source'}
        </Button>
      </div>
    </Card>
  )
}

const SourceRow: FC<{
  source: ContextSource
  budget: number
  onSave: (s: ContextSource) => Promise<void>
  onDelete: (id: string) => Promise<void>
}> = ({ source, budget, onSave, onDelete }) => {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const tokens = countTokens(source.rawText)
  const condense = needsCondense(source, budget)
  const digestFresh = source.condensed?.forHash === source.contentHash

  const refetch = async (): Promise<void> => {
    if (!source.url) return
    setBusy(true)
    try {
      const { body } = await browserFetch.text(source.url)
      const hash = await contentHash(body)
      await onSave({ ...source, rawText: body, contentHash: hash, fetchedAt: Date.now() })
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="rounded-lg border border-neutral-200 bg-white p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={source.enabled}
            onChange={(e) => void onSave({ ...source, enabled: e.target.checked })}
            aria-label={`Enable ${source.name}`}
          />
          <span className="font-medium">{source.name}</span>
          <span className="rounded bg-neutral-100 px-1.5 text-xs">{source.kind}</span>
          {source.lang ? (
            <span className="rounded bg-neutral-100 px-1.5 text-xs">
              {languageName(source.lang)}
            </span>
          ) : null}
        </div>
        <div className="flex gap-2">
          {source.url ? (
            <Button disabled={busy} onClick={() => void refetch()}>
              Re-fetch
            </Button>
          ) : null}
          <Button onClick={() => setOpen((o) => !o)}>{open ? 'Hide' : 'Preview'}</Button>
          <Button variant="danger" onClick={() => void onDelete(source.id)}>
            Delete
          </Button>
        </div>
      </div>
      <p className="mt-1 text-xs text-neutral-500">
        {tokens} tokens ·{' '}
        {condense
          ? digestFresh
            ? `condensed to ${source.condensed?.tokenEstimate} tokens`
            : 'will be condensed on first run'
          : 'used as-is'}
        {source.fetchedAt ? ` · fetched ${new Date(source.fetchedAt).toLocaleString()}` : ''}
      </p>
      {open ? (
        <div className="mt-2 grid gap-2 md:grid-cols-2">
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded bg-neutral-50 p-2 text-xs">
            {source.rawText}
          </pre>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded bg-neutral-50 p-2 text-xs">
            {digestFresh ? source.condensed?.text : 'No digest yet.'}
          </pre>
        </div>
      ) : null}
    </li>
  )
}

export const ContextManager: FC = () => {
  const { items, save, remove } = useRepo(storage.contexts)
  const settings = useStore($settings)
  const budget = numberSetting(settings.contextTokenBudget, 4000)
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
      <AddSourceForm onAdd={save} />
      <Card title={`Sources (${items.length})`}>
        {items.length === 0 ? (
          <p className="text-sm text-neutral-500">
            No context yet. Add an llms.txt or a Markdown file.
          </p>
        ) : null}
        <ul className="flex flex-col gap-2">
          {items.map((s) => (
            <SourceRow key={s.id} source={s} budget={budget} onSave={save} onDelete={remove} />
          ))}
        </ul>
      </Card>
    </div>
  )
}
