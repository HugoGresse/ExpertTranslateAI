import type { ContextSource } from '@experttranslate/core'
import { type FC, useState } from 'react'
import { logger } from '../adapters/logger'
import { type ContextInputMode, createContextSource } from '../lib/contextSources'
import { TEXT_FILE_ACCEPT } from '../lib/files'
import { Button, inputClass } from './ui'

export interface ContextQuickAddProps {
  onAdd: (source: ContextSource) => Promise<void>
}

/** Compact inline form for the workspace: paste, URL or file, no page change. */
export const ContextQuickAdd: FC<ContextQuickAddProps> = ({ onAdd }) => {
  const [mode, setMode] = useState<ContextInputMode>('url')
  const [text, setText] = useState('')
  const [url, setUrl] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const ready =
    mode === 'paste'
      ? text.trim().length > 0
      : mode === 'url'
        ? url.trim().length > 0
        : file !== null

  const submit = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await onAdd(await createContextSource({ mode, text, url, file }))
      setText('')
      setUrl('')
      setFile(null)
    } catch (e) {
      logger.warn('context.quickAddFailed', { mode, error: String(e) })
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-2 rounded-md border border-dashed border-neutral-300 p-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-medium text-neutral-700">Add context:</span>
        {(['paste', 'url', 'file'] as ContextInputMode[]).map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={mode === m}
            className={`rounded-full border px-2 py-0.5 ${mode === m ? 'border-accent bg-blue-50 text-accent' : 'border-neutral-300 text-neutral-600'}`}
            onClick={() => setMode(m)}
          >
            {m === 'paste' ? 'Paste text' : m === 'url' ? 'From URL' : 'Upload file'}
          </button>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap items-start gap-2">
        {mode === 'paste' ? (
          <textarea
            className={`${inputClass} min-h-16 flex-1`}
            placeholder="Glossary notes, product description, llms.txt content…"
            aria-label="Context text"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        ) : null}
        {mode === 'url' ? (
          <input
            className={`${inputClass} flex-1`}
            placeholder="https://example.com/llms.txt"
            aria-label="Context URL"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        ) : null}
        {mode === 'file' ? (
          <input
            type="file"
            accept={TEXT_FILE_ACCEPT}
            aria-label="Context file"
            className="flex-1 text-sm"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        ) : null}
        <Button variant="primary" disabled={busy || !ready} onClick={() => void submit()}>
          {busy ? 'Adding…' : 'Add and use'}
        </Button>
      </div>
      {error ? <p className="mt-1 text-xs text-red-700">{error}</p> : null}
    </div>
  )
}
