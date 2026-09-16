import type { Domain, Role, RouterRule } from '@experttranslate/core'
import { useStore as useAtom, useStore } from '@nanostores/react'
import type { FC } from 'react'
import { useModels } from '../hooks/useModels'
import { $routing, $settings, type Settings } from '../stores/settings'
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
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={settings.autoEscalate === 'true'}
            onChange={(e) => $settings.setKey('autoEscalate', e.target.checked ? 'true' : 'false')}
          />
          Auto-escalate one difficulty level on high disagreement, low confidence or rule violations
        </label>
        <Field
          label="Escalate below confidence"
          hint="0–100. Applies when candidates agree but the scorer is unsure."
        >
          <input
            className={inputClass}
            type="number"
            min={0}
            max={100}
            value={settings.escalationConfidence}
            onChange={(e) => $settings.setKey('escalationConfidence', e.target.value)}
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
        <RoutingTable models={models} loading={loading} />
      </div>
    </Card>
  )
}

const DOMAINS: Domain[] = [
  'general',
  'legal',
  'technical',
  'marketing',
  'medical',
  'literary',
  'ui',
]
const ROLE_KEYS: Role[] = [
  'translatorA',
  'translatorB',
  'translatorC',
  'reviewer',
  'judge',
  'finalizer',
  'scorer',
  'helper',
]

const RoutingTable: FC<{
  models: Parameters<typeof ModelPicker>[0]['models']
  loading: boolean
}> = ({ models, loading }) => {
  const rules = useAtom($routing)
  const update = (index: number, patch: Partial<RouterRule>): void =>
    $routing.set(rules.map((r, i) => (i === index ? { ...r, ...patch } : r)))
  return (
    <div className="mt-2">
      <p className="text-sm font-medium text-neutral-700">Routing by domain</p>
      <p className="mb-2 text-xs text-neutral-500">
        After the brief detects the domain, these rules override the role models above.
      </p>
      <ul className="flex flex-col gap-2">
        {rules.map((rule, i) => (
          <li
            key={`${rule.domain}-${rule.role}-${i}`}
            className="grid gap-2 text-sm md:grid-cols-[120px_130px_1fr_auto]"
          >
            <select
              className={inputClass}
              value={rule.domain}
              onChange={(e) => update(i, { domain: e.target.value as Domain })}
              aria-label="Routing domain"
            >
              {DOMAINS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
            <select
              className={inputClass}
              value={rule.role}
              onChange={(e) => update(i, { role: e.target.value as Role })}
              aria-label="Routing role"
            >
              {ROLE_KEYS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <ModelPicker
              models={models}
              value={rule.model}
              loading={loading}
              allowEmpty
              onChange={(model) => update(i, { model })}
            />
            <Button variant="danger" onClick={() => $routing.set(rules.filter((_, j) => j !== i))}>
              ×
            </Button>
          </li>
        ))}
      </ul>
      <Button
        className="mt-2"
        onClick={() =>
          $routing.set([...rules, { domain: 'legal', role: 'translatorA', model: '' }])
        }
      >
        Add routing rule
      </Button>
    </div>
  )
}
