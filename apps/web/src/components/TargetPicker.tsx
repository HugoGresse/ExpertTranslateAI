import type { Target } from '@experttranslate/core'
import { type FC, useState } from 'react'
import { LANGUAGES, languageLabel } from '../data/languages'
import { Button, inputClass } from './ui'

export interface TargetPickerProps {
  targets: Target[]
  onChange: (targets: Target[]) => void
}

export const TargetPicker: FC<TargetPickerProps> = ({ targets, onChange }) => {
  const [lang, setLang] = useState('es')
  const [region, setRegion] = useState('')

  const add = (): void => {
    const trimmedRegion = region.trim()
    const exists = targets.some((t) => t.lang === lang && (t.region ?? '') === trimmedRegion)
    if (exists) return
    onChange([...targets, trimmedRegion ? { lang, region: trimmedRegion } : { lang }])
    setRegion('')
  }

  const remove = (index: number): void => onChange(targets.filter((_, i) => i !== index))

  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-wrap gap-2">
        {targets.map((t, i) => (
          <li
            key={`${t.lang}-${t.region ?? ''}`}
            className="flex items-center gap-1 rounded-full bg-neutral-100 px-3 py-1 text-sm"
          >
            {languageLabel(t.lang, t.region)}
            <button
              type="button"
              className="ml-1 text-neutral-500 hover:text-red-600"
              onClick={() => remove(i)}
              aria-label={`Remove ${languageLabel(t.lang, t.region)}`}
            >
              ×
            </button>
          </li>
        ))}
        {targets.length === 0 ? (
          <li className="text-sm text-neutral-500">No target language yet.</li>
        ) : null}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <select
          className={inputClass}
          value={lang}
          onChange={(e) => setLang(e.target.value)}
          aria-label="Language"
        >
          {LANGUAGES.map((l) => (
            <option key={l.code} value={l.code}>
              {l.name}
            </option>
          ))}
        </select>
        <input
          className={`${inputClass} w-40`}
          placeholder="Region (optional)"
          value={region}
          onChange={(e) => setRegion(e.target.value)}
          aria-label="Region"
        />
        <Button onClick={add}>Add target</Button>
      </div>
    </div>
  )
}
