import type { ModelInfo } from '@experttranslate/core'
import { type FC, useMemo, useState } from 'react'
import { inputClass } from './ui'

export interface ModelPickerProps {
  models: ModelInfo[]
  value: string
  onChange: (id: string) => void
  loading?: boolean
}

const perMillion = (usdPerToken: number): string =>
  usdPerToken < 0 ? 'variable' : `$${(usdPerToken * 1_000_000).toFixed(2)}/M`

export const ModelPicker: FC<ModelPickerProps> = ({ models, value, onChange, loading = false }) => {
  const [query, setQuery] = useState('')
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = q
      ? models.filter((m) => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q))
      : models
    return list.slice(0, 200)
  }, [models, query])
  const selected = models.find((m) => m.id === value)

  return (
    <div className="flex flex-col gap-1">
      <input
        className={inputClass}
        placeholder="Filter models…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Filter models"
      />
      <select
        className={inputClass}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={loading}
      >
        {!selected ? <option value={value}>{value}</option> : null}
        {filtered.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name} — {perMillion(m.pricing.promptUsdPerToken)} in /{' '}
            {perMillion(m.pricing.completionUsdPerToken)} out
          </option>
        ))}
      </select>
      {loading ? <span className="text-xs text-neutral-500">Loading catalog…</span> : null}
    </div>
  )
}
