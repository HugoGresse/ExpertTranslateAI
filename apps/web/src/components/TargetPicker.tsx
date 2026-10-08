import { type Target, targetKey } from '@experttranslate/core'
import { type FC, useState } from 'react'
import { languageLabel } from '../data/languages'
import { LanguageCombobox } from './LanguageCombobox'
import { Button, inputClass } from './ui'

export interface TargetPickerProps {
  targets: Target[]
  onChange: (targets: Target[]) => void
}

export const TargetPicker: FC<TargetPickerProps> = ({ targets, onChange }) => {
  const [lang, setLang] = useState('es')
  const [region, setRegion] = useState('')

  const add = (code = lang): void => {
    const trimmedRegion = region.trim()
    const candidate: Target = trimmedRegion ? { lang: code, region: trimmedRegion } : { lang: code }
    if (targets.some((t) => targetKey(t) === targetKey(candidate))) return
    onChange([...targets, candidate])
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
        <LanguageCombobox
          value={lang}
          onChange={(code) => {
            // Picking a language (Enter or click) adds it right away, with the region if one is typed.
            setLang(code)
            add(code)
          }}
          onSubmit={add}
          ariaLabel="Language"
          className="w-64"
        />
        <input
          className={`${inputClass} w-40`}
          placeholder="Region (optional)"
          value={region}
          onChange={(e) => setRegion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) add()
          }}
          aria-label="Region"
        />
        <Button onClick={() => add()}>Add target</Button>
      </div>
    </div>
  )
}
