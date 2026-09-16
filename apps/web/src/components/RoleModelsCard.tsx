import { useStore } from '@nanostores/react'
import type { FC } from 'react'
import { useModels } from '../hooks/useModels'
import { $settings, type Settings } from '../stores/settings'
import { ModelPicker } from './ModelPicker'
import { Button, Card, Field, inputClass } from './ui'

type RoleKey = keyof Pick<
  Settings,
  | 'translatorBModel'
  | 'translatorCModel'
  | 'reviewerModel'
  | 'judgeModel'
  | 'finalizerModel'
  | 'scorerModel'
  | 'helperModel'
>

const ROLES: Array<{ key: RoleKey; label: string; hint: string }> = [
  {
    key: 'translatorBModel',
    label: 'Translator B',
    hint: 'Second independent translation (normal and above). Pick a different model family from A.',
  },
  { key: 'translatorCModel', label: 'Translator C', hint: 'Third translation (hard and above).' },
  {
    key: 'reviewerModel',
    label: 'Reviewer',
    hint: 'Finds issues in the candidates and audits guidelines.',
  },
  { key: 'judgeModel', label: 'Judge', hint: 'Picks or merges candidates (hard and above).' },
  {
    key: 'finalizerModel',
    label: 'Finalizer',
    hint: 'Produces the final text from the base candidate and the review.',
  },
  { key: 'scorerModel', label: 'Scorer', hint: 'Grades the final translation on six dimensions.' },
  {
    key: 'helperModel',
    label: 'Helper',
    hint: 'Brief, context condensing, rule extraction. Cheap and fast is fine.',
  },
]

export const RoleModelsCard: FC = () => {
  const settings = useStore($settings)
  const { models, loading, refresh } = useModels()
  return (
    <Card title="Pipeline roles">
      <p className="mb-3 text-xs text-neutral-500">
        Empty = fall back to the translator model (or the helper for review, judge and scoring).
        Difficulty decides which roles run.
      </p>
      <div className="flex flex-col gap-3">
        <Field
          label="Default difficulty"
          hint="Auto lets the brief decide. Simple = one model, no review."
        >
          <select
            className={inputClass}
            value={settings.difficulty}
            onChange={(e) =>
              $settings.setKey('difficulty', e.target.value as Settings['difficulty'])
            }
          >
            <option value="auto">Auto</option>
            <option value="simple">Simple</option>
            <option value="normal">Normal</option>
            <option value="hard">Hard</option>
          </select>
        </Field>
        <Field
          label="Budget cap per run (USD)"
          hint="Empty = no cap. No new call starts once spend, plus calls already in flight, would exceed it."
        >
          <input
            className={inputClass}
            type="number"
            min={0}
            step={0.01}
            value={settings.budgetUsd}
            onChange={(e) => $settings.setKey('budgetUsd', e.target.value)}
          />
        </Field>
        <Field
          label="Reasoning effort"
          hint="Sent as OpenRouter reasoning.effort. Reasoning models can spend thousands of hidden tokens per call; low keeps runs fast and cheap. Ignored by models without reasoning."
        >
          <select
            className={inputClass}
            value={settings.reasoningEffort}
            onChange={(e) =>
              $settings.setKey('reasoningEffort', e.target.value as Settings['reasoningEffort'])
            }
          >
            <option value="none">Off</option>
            <option value="minimal">Minimal</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </Field>
        {ROLES.map((r) => (
          <Field key={r.key} label={r.label} hint={r.hint}>
            <ModelPicker
              models={models}
              value={settings[r.key]}
              loading={loading}
              allowEmpty
              onChange={(id) => $settings.setKey(r.key, id)}
            />
          </Field>
        ))}
        <Button className="self-start" onClick={refresh}>
          Refresh catalog
        </Button>
      </div>
    </Card>
  )
}
