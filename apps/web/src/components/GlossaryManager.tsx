import {
  GLOSSARY_LEVELS,
  type GlossaryEntry,
  type GlossaryKind,
  type GlossaryLevel,
  type GlossaryScope,
} from '@experttranslate/core'
import { useStore } from '@nanostores/react'
import { type FC, useMemo, useState } from 'react'
import { storage } from '../adapters/dexieStorage'
import { logger } from '../adapters/logger'
import { LANGUAGES, languageName } from '../data/languages'
import { useRepo } from '../hooks/useRepo'
import { parseCsv, toCsv } from '../lib/csv'
import { downloadText } from '../lib/download'
import { pickOneOf } from '../lib/guards'
import { $targets } from '../stores/settings'
import { Button, Card, Field, inputClass } from './ui'

const KINDS: GlossaryKind[] = ['preferred', 'forbidden', 'doNotTranslate']
const KIND_LABEL: Record<GlossaryKind, string> = {
  preferred: 'preferred',
  forbidden: 'forbidden',
  doNotTranslate: 'do not translate',
}

const ScopeForm: FC<{ scopes: GlossaryScope[]; onSave: (s: GlossaryScope) => Promise<void> }> = ({
  scopes,
  onSave,
}) => {
  const [name, setName] = useState('')
  const [level, setLevel] = useState<GlossaryLevel>('global')
  const [lang, setLang] = useState('')
  const [parentId, setParentId] = useState('')
  const submit = async (): Promise<void> => {
    if (!name.trim()) return
    await onSave({
      id: crypto.randomUUID(),
      level,
      name: name.trim(),
      createdAt: Date.now(),
      ...(lang ? { lang } : {}),
      ...(parentId ? { parentId } : {}),
    })
    setName('')
  }
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <Field label="Scope name">
        <input
          className={inputClass}
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label="Scope name"
        />
      </Field>
      <Field label="Level">
        <select
          className={inputClass}
          value={level}
          onChange={(e) => setLevel(pickOneOf(GLOSSARY_LEVELS, e.target.value, level))}
          aria-label="Scope level"
        >
          {GLOSSARY_LEVELS.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Language (optional)">
        <select className={inputClass} value={lang} onChange={(e) => setLang(e.target.value)}>
          <option value="">Any</option>
          {LANGUAGES.map((l) => (
            <option key={l.code} value={l.code}>
              {l.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Parent scope (optional)">
        <select
          className={inputClass}
          value={parentId}
          onChange={(e) => setParentId(e.target.value)}
        >
          <option value="">None</option>
          {scopes.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} ({s.level})
            </option>
          ))}
        </select>
      </Field>
      <Button
        variant="primary"
        className="self-end justify-self-start"
        onClick={() => void submit()}
      >
        Add scope
      </Button>
    </div>
  )
}

const EntryForm: FC<{
  scopeId: string
  defaultLang: string
  onSave: (e: GlossaryEntry) => Promise<void>
}> = ({ scopeId, defaultLang, onSave }) => {
  const [source, setSource] = useState('')
  const [target, setTarget] = useState('')
  const [lang, setLang] = useState(defaultLang)
  const [kind, setKind] = useState<GlossaryKind>('preferred')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const submit = async (): Promise<void> => {
    if (!source.trim() || (kind !== 'doNotTranslate' && !target.trim())) return
    await onSave({
      id: crypto.randomUUID(),
      scopeId,
      source: source.trim(),
      target: target.trim(),
      lang,
      kind,
      caseSensitive,
      createdAt: Date.now(),
    })
    setSource('')
    setTarget('')
  }
  return (
    <div className="grid gap-2 text-sm md:grid-cols-[1fr_1fr_120px_130px_auto]">
      <input
        className={inputClass}
        placeholder="Source term"
        value={source}
        onChange={(e) => setSource(e.target.value)}
        aria-label="Source term"
      />
      <input
        className={inputClass}
        placeholder={kind === 'doNotTranslate' ? '(kept as is)' : 'Target rendering'}
        value={target}
        disabled={kind === 'doNotTranslate'}
        onChange={(e) => setTarget(e.target.value)}
        aria-label="Target rendering"
      />
      <select
        className={inputClass}
        value={lang}
        onChange={(e) => setLang(e.target.value)}
        aria-label="Entry language"
      >
        {LANGUAGES.map((l) => (
          <option key={l.code} value={l.code}>
            {l.name}
          </option>
        ))}
      </select>
      <select
        className={inputClass}
        value={kind}
        onChange={(e) => setKind(pickOneOf(KINDS, e.target.value, kind))}
        aria-label="Entry kind"
      >
        {KINDS.map((k) => (
          <option key={k} value={k}>
            {KIND_LABEL[k]}
          </option>
        ))}
      </select>
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-1 text-xs">
          <input
            type="checkbox"
            checked={caseSensitive}
            onChange={(e) => setCaseSensitive(e.target.checked)}
          />
          case
        </label>
        <Button onClick={() => void submit()}>Add</Button>
      </div>
    </div>
  )
}

export const GlossaryManager: FC = () => {
  const scopes = useRepo<GlossaryScope>(storage.glossaryScopes)
  const entries = useRepo<GlossaryEntry>(storage.glossaryEntries)
  const [activeScope, setActiveScope] = useState<string>('')
  const active = scopes.items.find((s) => s.id === activeScope) ?? scopes.items[0]
  const targets = useStore($targets)
  const defaultLang = active?.lang ?? targets[0]?.lang ?? 'fr'
  const scopeEntries = useMemo(
    () => entries.items.filter((e) => e.scopeId === active?.id),
    [entries.items, active],
  )

  const removeScope = async (id: string): Promise<void> => {
    try {
      for (const e of entries.items.filter((x) => x.scopeId === id))
        await storage.glossaryEntries.delete(e.id)
      await scopes.remove(id)
      await entries.reload()
    } catch (error) {
      logger.error('glossary.removeScopeFailed', { scope: id, error: String(error) })
    }
  }

  const exportCsv = (): void => {
    if (!active) return
    const rows = [
      ['source', 'target', 'lang', 'kind', 'caseSensitive', 'note'],
      ...scopeEntries.map((e) => [
        e.source,
        e.target,
        e.lang,
        e.kind,
        String(e.caseSensitive),
        e.note ?? '',
      ]),
    ]
    downloadText(`glossary-${active.name}.csv`, toCsv(rows), 'text/csv;charset=utf-8')
  }

  const importCsv = async (file: File): Promise<void> => {
    if (!active) return
    try {
      await importRows(file)
    } catch (error) {
      logger.error('glossary.importFailed', { scope: active.id, error: String(error) })
    }
  }

  const importRows = async (file: File): Promise<void> => {
    if (!active) return
    const rows = parseCsv(await file.text())
    const body = rows[0]?.[0]?.toLowerCase() === 'source' ? rows.slice(1) : rows
    let count = 0
    let skipped = 0
    for (const r of body) {
      const [source, target = '', lang = defaultLang, kind = 'preferred', cs = 'false', note = ''] =
        r
      if (!source?.trim()) continue
      const k = pickOneOf(KINDS, kind.trim(), 'preferred')
      if (k !== 'doNotTranslate' && !target.trim()) {
        skipped++
        continue
      }
      await storage.glossaryEntries.put({
        id: crypto.randomUUID(),
        scopeId: active.id,
        source: source.trim(),
        target: target.trim(),
        lang: lang.trim() || defaultLang,
        kind: k,
        caseSensitive: cs.trim() === 'true',
        createdAt: Date.now(),
        ...(note.trim() ? { note: note.trim() } : {}),
      })
      count++
    }
    logger.info('glossary.imported', { scope: active.id, count, skipped })
    await entries.reload()
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
      <div className="flex flex-col gap-4">
        <Card title="Scopes">
          <p className="mb-2 text-xs text-neutral-500">
            Global → language → client → project → document. Selecting a scope in the workspace also
            applies its parents; the most specific scope wins on conflicts.
          </p>
          <ul className="mb-3 flex flex-col gap-1">
            {scopes.items.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-2 text-sm">
                <button
                  type="button"
                  className={`text-left ${active?.id === s.id ? 'font-semibold text-accent' : ''}`}
                  onClick={() => setActiveScope(s.id)}
                >
                  {s.name}{' '}
                  <span className="text-xs text-neutral-500">
                    {s.level}
                    {s.lang ? ` · ${languageName(s.lang)}` : ''}
                    {s.parentId
                      ? ` · in ${scopes.items.find((p) => p.id === s.parentId)?.name ?? '?'}`
                      : ''}
                  </span>
                </button>
                <Button variant="danger" onClick={() => void removeScope(s.id)}>
                  Delete
                </Button>
              </li>
            ))}
            {scopes.items.length === 0 ? (
              <li className="text-sm text-neutral-500">No scope yet.</li>
            ) : null}
          </ul>
          <ScopeForm scopes={scopes.items} onSave={scopes.save} />
        </Card>
      </div>
      <Card title={active ? `Entries in ${active.name} (${scopeEntries.length})` : 'Entries'}>
        {active ? (
          <div className="flex flex-col gap-3">
            <EntryForm
              key={`${active.id}-${defaultLang}`}
              scopeId={active.id}
              defaultLang={defaultLang}
              onSave={entries.save}
            />
            <div className="flex flex-wrap gap-2">
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
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-neutral-500">
                <tr>
                  <th>Source</th>
                  <th>Target</th>
                  <th>Lang</th>
                  <th>Kind</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {scopeEntries.map((e) => (
                  <tr key={e.id} className="border-t border-neutral-100">
                    <td className="py-1 pr-2">{e.source}</td>
                    <td className="py-1 pr-2">
                      {e.kind === 'doNotTranslate' ? (
                        <em className="text-neutral-500">unchanged</em>
                      ) : (
                        e.target
                      )}
                    </td>
                    <td className="py-1 pr-2">{e.lang}</td>
                    <td className="py-1 pr-2">{KIND_LABEL[e.kind]}</td>
                    <td className="py-1 text-right">
                      <Button variant="ghost" onClick={() => void entries.remove(e.id)}>
                        ×
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-neutral-500">Create a scope first.</p>
        )}
      </Card>
    </div>
  )
}
