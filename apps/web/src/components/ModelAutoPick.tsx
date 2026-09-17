import { type ModelInfo, type ModelPreset, type Role, recommendModels } from '@experttranslate/core'
import { type FC, useState } from 'react'
import { logger } from '../adapters/logger'
import { $settings } from '../stores/settings'
import { Button, inputClass } from './ui'

const PRESETS: Array<{ id: ModelPreset; label: string; hint: string }> = [
  { id: 'economy', label: 'Economy', hint: 'cheapest models that still translate well' },
  { id: 'balanced', label: 'Balanced', hint: 'strong translators, cheap helpers' },
  { id: 'best', label: 'Best quality', hint: 'top models everywhere, cost is secondary' },
]

/** Fills every pipeline role from the live catalog with one click; each pick stays editable. */
export const ModelAutoPick: FC<{ models: ModelInfo[]; compact?: boolean }> = ({
  models,
  compact = false,
}) => {
  const [preset, setPreset] = useState<ModelPreset>('balanced')
  const [summary, setSummary] = useState<Array<[Role, string]> | null>(null)
  const [error, setError] = useState<string | null>(null)

  const pick = (): void => {
    try {
      const rec = recommendModels(models, preset)
      $settings.set({
        ...$settings.get(),
        translatorModel: rec.models.translatorA,
        translatorBModel: rec.models.translatorB,
        translatorCModel: rec.models.translatorC,
        reviewerModel: rec.models.reviewer,
        judgeModel: rec.models.judge,
        finalizerModel: rec.models.finalizer,
        scorerModel: rec.models.scorer,
        backTranslatorModel: rec.models.backTranslator,
        helperModel: rec.models.helper,
      })
      setSummary(Object.entries(rec.reasons) as Array<[Role, string]>)
      setError(null)
      logger.info('models.autoPicked', { preset, ...rec.models })
    } catch (e) {
      logger.warn('models.autoPickFailed', { preset, error: String(e) })
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div
      className={
        compact ? 'text-sm' : 'mt-3 rounded-xl border border-line bg-neutral-50 p-3 text-sm'
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        {compact ? null : <span className="font-medium">Pick models for me:</span>}
        <select
          className={inputClass}
          aria-label="Model preset"
          value={preset}
          onChange={(e) => setPreset(e.target.value as ModelPreset)}
        >
          {PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label} — {p.hint}
            </option>
          ))}
        </select>
        <Button
          variant={compact ? 'primary' : 'secondary'}
          size="sm"
          disabled={models.length === 0}
          onClick={pick}
        >
          {compact ? 'Use this preset' : 'Auto-pick all roles'}
        </Button>
      </div>
      {error ? <p className="mt-1 text-xs text-red-700">{error}</p> : null}
      {summary && !compact ? (
        <ul className="mt-2 grid gap-0.5 text-xs text-neutral-600 sm:grid-cols-2">
          {summary.map(([role, reason]) => (
            <li key={role}>
              <span className="font-medium text-neutral-700">{role}</span>: {reason}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
