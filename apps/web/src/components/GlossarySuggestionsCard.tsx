import type { GlossaryScope, GlossarySuggestion, TargetResult } from '@experttranslate/core'
import { type FC, useMemo, useState } from 'react'
import { storage } from '../adapters/dexieStorage'
import { logger } from '../adapters/logger'
import { useRepo } from '../hooks/useRepo'
import { $selectedGlossaryIds } from '../stores/settings'
import { Button, inputClass } from './ui'

const NEW_SCOPE = '__new__'

/** Terms the helper proposed after the run; one click stores them in a scope and selects it. */
export const GlossarySuggestionsCard: FC<{ result: TargetResult }> = ({ result }) => {
  const scopes = useRepo<GlossaryScope>(storage.glossaryScopes)
  const suggestions = result.glossarySuggestions
  const [picked, setPicked] = useState<Set<string>>(() => new Set(suggestions.map((s) => s.source)))
  const [scopeId, setScopeId] = useState<string>('')
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const effectiveScope =
    scopeId ||
    scopes.items.find((s) => s.level === 'project')?.id ||
    scopes.items[0]?.id ||
    NEW_SCOPE
  const chosen = useMemo(
    () => suggestions.filter((s) => picked.has(s.source)),
    [suggestions, picked],
  )

  if (suggestions.length === 0) return null

  const toggle = (source: string): void =>
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(source)) next.delete(source)
      else next.add(source)
      return next
    })

  const add = async (): Promise<void> => {
    setBusy(true)
    try {
      let target = effectiveScope
      if (target === NEW_SCOPE) {
        const scope: GlossaryScope = {
          id: crypto.randomUUID(),
          level: 'project',
          name: 'Suggested terms',
          createdAt: Date.now(),
        }
        await scopes.save(scope)
        target = scope.id
      }
      const existing = await storage.glossaryEntries.list()
      let added = 0
      for (const s of chosen) {
        const dup = existing.some(
          (e) =>
            e.scopeId === target &&
            e.lang === result.lang &&
            e.source.toLowerCase() === s.source.toLowerCase(),
        )
        if (dup) continue
        await storage.glossaryEntries.put({
          id: crypto.randomUUID(),
          scopeId: target,
          source: s.source,
          target: s.kind === 'doNotTranslate' ? s.source : s.target,
          lang: result.lang,
          kind: s.kind,
          caseSensitive: s.kind === 'doNotTranslate',
          ...(s.note ? { note: s.note } : {}),
          createdAt: Date.now(),
        })
        added++
      }
      const selected = $selectedGlossaryIds.get()
      if (!selected.includes(target)) $selectedGlossaryIds.set([...selected, target])
      logger.info('glossary.suggestionsAdded', { scope: target, added, lang: result.lang })
      setStatus(
        `Added ${added} term${added === 1 ? '' : 's'}; the scope is now selected for future runs.`,
      )
    } catch (error) {
      logger.error('glossary.suggestionsFailed', { error: String(error) })
      setStatus('Could not save the terms.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm">
      <p className="font-medium">
        Suggested glossary terms ({suggestions.length}) — lock them so future translations stay
        consistent
      </p>
      <ul className="mt-2 grid gap-1 sm:grid-cols-2">
        {suggestions.map((s: GlossarySuggestion) => (
          <li key={s.source}>
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                className="mt-1"
                checked={picked.has(s.source)}
                onChange={() => toggle(s.source)}
              />
              <span>
                <span className="font-medium">{s.source}</span>
                {' → '}
                {s.kind === 'doNotTranslate' ? <em>keep unchanged</em> : s.target}
                {s.note ? <span className="text-xs text-neutral-500"> · {s.note}</span> : null}
              </span>
            </label>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <select
          className={inputClass}
          aria-label="Glossary scope for suggestions"
          value={effectiveScope}
          onChange={(e) => setScopeId(e.target.value)}
        >
          {scopes.items.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} ({s.level})
            </option>
          ))}
          <option value={NEW_SCOPE}>New project scope “Suggested terms”</option>
        </select>
        <Button variant="primary" disabled={busy || chosen.length === 0} onClick={() => void add()}>
          Add {chosen.length} to glossary
        </Button>
        {status ? <span className="text-xs">{status}</span> : null}
      </div>
    </div>
  )
}
