import { DEFAULT_ROLE_LINES, type PromptStage } from '@experttranslate/core'
import { useStore } from '@nanostores/react'
import { type FC, useMemo } from 'react'
import { $promptOverrides } from '../stores/settings'
import { Button, Card, inputClass } from './ui'

const STAGES: Array<{ stage: PromptStage; label: string; hint: string }> = [
  {
    stage: 'brief',
    label: 'Brief',
    hint: 'Detects language, domain, difficulty, key terms and risks.',
  },
  { stage: 'translate', label: 'Translator', hint: 'Role lines for every translator candidate.' },
  {
    stage: 'review',
    label: 'Reviewer',
    hint: 'Finds issues in candidates. Must keep asking for the JSON shape.',
  },
  {
    stage: 'guidelines',
    label: 'Guideline audit',
    hint: 'Checks candidates against numbered rules. JSON output.',
  },
  { stage: 'judge', label: 'Judge', hint: 'Picks or merges candidates. JSON output.' },
  {
    stage: 'finalize',
    label: 'Finalizer',
    hint: 'Produces the final text from the base and the review.',
  },
  { stage: 'score', label: 'Scorer', hint: 'Six-dimension quality score. JSON output.' },
  {
    stage: 'backtranslate',
    label: 'Back-translator',
    hint: 'Literal translation back to the source language.',
  },
  {
    stage: 'deltas',
    label: 'Delta comparison',
    hint: 'Lists meaning deltas between original and back-translation. JSON output.',
  },
]

const defaultRole = (stage: PromptStage): string => DEFAULT_ROLE_LINES[stage].join('\n')

export const PromptsManager: FC = () => {
  const overrides = useStore($promptOverrides)
  const defaults = useMemo(() => new Map(STAGES.map((s) => [s.stage, defaultRole(s.stage)])), [])
  const set = (stage: PromptStage, value: string): void => {
    const next = { ...overrides }
    if (value.trim()) next[stage] = value
    else delete next[stage]
    $promptOverrides.set(next)
  }
  return (
    <div className="flex flex-col gap-4">
      <Card title="Prompt overrides">
        <p className="text-xs text-neutral-500">
          Each box replaces the role instructions of one stage. The context, guidelines, glossary
          and memory blocks and the task input are always appended. Stages that expect JSON must
          keep asking for it. Empty = default. Every result records a hash of the active overrides
          so runs stay comparable in Insights.
        </p>
      </Card>
      {STAGES.map((s) => {
        const active = overrides[s.stage] !== undefined
        return (
          <Card key={s.stage} title={`${s.label}${active ? ' · overridden' : ''}`}>
            <p className="mb-2 text-xs text-neutral-500">{s.hint}</p>
            <textarea
              className={`${inputClass} min-h-32 w-full font-mono text-xs`}
              value={overrides[s.stage] ?? defaults.get(s.stage) ?? ''}
              onChange={(e) => set(s.stage, e.target.value)}
              aria-label={`${s.label} prompt`}
            />
            <div className="mt-2 flex gap-2">
              <Button disabled={!active} onClick={() => set(s.stage, '')}>
                Reset to default
              </Button>
            </div>
          </Card>
        )
      })}
    </div>
  )
}
