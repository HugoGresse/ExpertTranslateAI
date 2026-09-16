import type { TmEntry } from '@experttranslate/core'
import { type FC, useMemo, useState } from 'react'
import { storage } from '../adapters/dexieStorage'
import { logger } from '../adapters/logger'
import { useRepo } from '../hooks/useRepo'
import { downloadText, parseCsv, toCsv } from '../lib/csv'
import { Button, Card, inputClass } from './ui'

export const MemoryManager: FC = () => {
  const tm = useRepo<TmEntry>(storage.tm)
  const [query, setQuery] = useState('')
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q
      ? tm.items.filter(
          (e) => e.source.toLowerCase().includes(q) || e.target.toLowerCase().includes(q),
        )
      : tm.items
  }, [tm.items, query])

  const exportCsv = (): void =>
    downloadText(
      'translation-memory.csv',
      toCsv([
        ['sourceLang', 'targetLang', 'source', 'target'],
        ...tm.items.map((e) => [e.sourceLang, e.targetLang, e.source, e.target]),
      ]),
    )

  const importCsv = async (file: File): Promise<void> => {
    const rows = parseCsv(await file.text())
    const body = rows[0]?.[0]?.toLowerCase() === 'sourcelang' ? rows.slice(1) : rows
    let count = 0
    for (const [sourceLang, targetLang, source, target] of body) {
      if (!sourceLang || !targetLang || !source?.trim() || !target?.trim()) continue
      await storage.tm.put({
        id: crypto.randomUUID(),
        sourceLang: sourceLang.trim(),
        targetLang: targetLang.trim(),
        source: source.trim(),
        target: target.trim(),
        origin: 'human-correction',
        createdAt: Date.now(),
      })
      count++
    }
    logger.info('memory.imported', { count })
    await tm.reload()
  }

  return (
    <Card title={`Translation memory (${tm.items.length})`}>
      <p className="mb-3 text-xs text-neutral-500">
        Sentence pairs saved from your corrections. Exact matches are reused verbatim; close matches
        are offered as references.
      </p>
      <div className="mb-3 flex flex-wrap gap-2">
        <input
          className={`${inputClass} flex-1`}
          placeholder="Search…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search memory"
        />
        <Button onClick={exportCsv}>Export CSV</Button>
        <label className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-neutral-50">
          Import CSV
          <input
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && void importCsv(e.target.files[0])}
          />
        </label>
      </div>
      {filtered.length === 0 ? (
        <p className="text-sm text-neutral-500">Nothing stored yet.</p>
      ) : null}
      <ul className="flex flex-col gap-2">
        {filtered.map((e) => (
          <li key={e.id} className="rounded-md border border-neutral-200 p-2 text-sm">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs text-neutral-500">
                  {e.sourceLang} → {e.targetLang} · {new Date(e.createdAt).toLocaleDateString()}
                </p>
                <p>{e.source}</p>
                <p className="text-neutral-700">{e.target}</p>
              </div>
              <Button variant="ghost" onClick={() => void tm.remove(e.id)}>
                ×
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  )
}
