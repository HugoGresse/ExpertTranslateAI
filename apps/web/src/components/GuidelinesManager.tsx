import {
  extractRules,
  type GuidelineKind,
  type GuidelineRule,
  type GuidelineSet,
  isCheckable,
} from '@experttranslate/core'
import { useStore } from '@nanostores/react'
import { type FC, useState } from 'react'
import { storage } from '../adapters/dexieStorage'
import { createBrowserLlm } from '../adapters/engineFactory'
import { $apiKey } from '../adapters/keyVault'
import { logger } from '../adapters/logger'
import { LANGUAGES, languageName } from '../data/languages'
import { useRepo } from '../hooks/useRepo'
import { $settings } from '../stores/settings'
import { Button, Card, Field, inputClass } from './ui'

const KINDS: GuidelineKind[] = ['keep', 'must', 'must-not', 'prefer']

const newRule = (): GuidelineRule => ({ id: crypto.randomUUID(), text: '', kind: 'must' })

const RuleEditor: FC<{
  rule: GuidelineRule
  onChange: (r: GuidelineRule) => void
  onDelete: () => void
}> = ({ rule, onChange, onDelete }) => (
  <li className="grid gap-2 rounded border border-neutral-200 p-2 text-sm md:grid-cols-[110px_1fr_1fr_auto]">
    <select
      className={inputClass}
      value={rule.kind}
      onChange={(e) => onChange({ ...rule, kind: e.target.value as GuidelineKind })}
      aria-label="Rule kind"
    >
      {KINDS.map((k) => (
        <option key={k} value={k}>
          {k}
        </option>
      ))}
    </select>
    <input
      className={inputClass}
      placeholder="Rule text"
      value={rule.text}
      onChange={(e) => onChange({ ...rule, text: e.target.value })}
      aria-label="Rule text"
    />
    <input
      className={`${inputClass} font-mono`}
      placeholder="Regex to detect (optional)"
      value={rule.pattern ?? ''}
      onChange={(e) => {
        const pattern = e.target.value
        const { pattern: _old, ...rest } = rule
        onChange(pattern ? { ...rest, pattern } : rest)
      }}
      aria-label="Rule pattern"
    />
    <div className="flex items-center gap-2">
      <span className="text-xs text-neutral-500">
        {isCheckable(rule) ? 'checked' : 'prompt only'}
      </span>
      <Button variant="danger" onClick={onDelete}>
        ×
      </Button>
    </div>
  </li>
)

const SetEditor: FC<{
  initial: GuidelineSet
  onSave: (s: GuidelineSet) => Promise<void>
  onCancel: () => void
}> = ({ initial, onSave, onCancel }) => {
  const apiKey = useStore($apiKey)
  const settings = useStore($settings)
  const [set, setSet] = useState<GuidelineSet>(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const updateRule = (r: GuidelineRule): void =>
    setSet({ ...set, rules: set.rules.map((x) => (x.id === r.id ? r : x)) })

  const extract = async (): Promise<void> => {
    if (!apiKey || !set.freeText?.trim()) return
    setBusy(true)
    setError(null)
    try {
      const model = settings.helperModel || settings.translatorModel
      const { rules, usage } = await extractRules(
        createBrowserLlm(apiKey, 1),
        model,
        set.freeText,
        () => crypto.randomUUID(),
        { reasoningEffort: settings.reasoningEffort, logger },
      )
      logger.info('guidelines.extracted', { count: rules.length, model, ...usage })
      setSet((prev) => ({ ...prev, rules: [...prev.rules, ...rules] }))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card title={initial.name ? `Edit "${initial.name}"` : 'New guideline set'}>
      <div className="flex flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name">
            <input
              className={inputClass}
              value={set.name}
              onChange={(e) => setSet({ ...set, name: e.target.value })}
            />
          </Field>
          <Field label="Only for target language (optional)">
            <select
              className={inputClass}
              value={set.lang ?? ''}
              onChange={(e) => {
                const { lang: _old, ...rest } = set
                setSet(e.target.value ? { ...rest, lang: e.target.value } : rest)
              }}
            >
              <option value="">All languages</option>
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field
          label="Style guide (free text, injected as-is)"
          hint="Optional. Use 'Extract rules' to turn it into checkable rules."
        >
          <textarea
            className={`${inputClass} min-h-32`}
            value={set.freeText ?? ''}
            onChange={(e) => setSet({ ...set, freeText: e.target.value })}
          />
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setSet({ ...set, rules: [...set.rules, newRule()] })}>
            Add rule
          </Button>
          <Button
            disabled={busy || !apiKey || !set.freeText?.trim()}
            onClick={() => void extract()}
          >
            {busy ? 'Extracting…' : 'Extract rules from style guide'}
          </Button>
        </div>
        <ul className="flex flex-col gap-2">
          {set.rules.map((r) => (
            <RuleEditor
              key={r.id}
              rule={r}
              onChange={updateRule}
              onDelete={() => setSet({ ...set, rules: set.rules.filter((x) => x.id !== r.id) })}
            />
          ))}
        </ul>
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        <div className="flex gap-2">
          <Button
            variant="primary"
            disabled={!set.name.trim()}
            onClick={() => void onSave({ ...set, rules: set.rules.filter((r) => r.text.trim()) })}
          >
            Save
          </Button>
          <Button onClick={onCancel}>Cancel</Button>
        </div>
      </div>
    </Card>
  )
}

export const GuidelinesManager: FC = () => {
  const { items, save, remove } = useRepo(storage.guidelines)
  const [editing, setEditing] = useState<GuidelineSet | null>(null)

  const create = (): void =>
    setEditing({
      id: crypto.randomUUID(),
      name: '',
      rules: [newRule()],
      enabled: true,
      createdAt: Date.now(),
    })

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Card title={`Guideline sets (${items.length})`}>
        <Button variant="primary" className="mb-3" onClick={create}>
          New set
        </Button>
        {items.length === 0 ? <p className="text-sm text-neutral-500">No guidelines yet.</p> : null}
        <ul className="flex flex-col gap-2">
          {items.map((s) => (
            <li
              key={s.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-neutral-200 bg-white p-3 text-sm"
            >
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={s.enabled}
                  onChange={(e) => void save({ ...s, enabled: e.target.checked })}
                  aria-label={`Enable ${s.name}`}
                />
                <span className="font-medium">{s.name}</span>
                <span className="text-xs text-neutral-500">
                  {s.rules.length} rule{s.rules.length === 1 ? '' : 's'}
                  {s.lang ? ` · ${languageName(s.lang)}` : ''}
                </span>
              </div>
              <div className="flex gap-2">
                <Button onClick={() => setEditing(s)}>Edit</Button>
                <Button variant="danger" onClick={() => void remove(s.id)}>
                  Delete
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </Card>
      {editing ? (
        <SetEditor
          key={editing.id}
          initial={editing}
          onCancel={() => setEditing(null)}
          onSave={async (s) => {
            await save(s)
            setEditing(null)
          }}
        />
      ) : null}
    </div>
  )
}
