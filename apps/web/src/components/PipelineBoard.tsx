import {
  type Difficulty,
  planFor,
  type RoleModels,
  STAGE_LABELS,
  type StageName,
  type TargetResult,
} from '@experttranslate/core'
import type { FC } from 'react'
import type { StageProgress, TargetProgress } from '../stores/run'
import { formatUsd, Spinner } from './ui'

export interface PipelineBoardProps {
  targetKey: string
  progress: TargetProgress
  stages: Record<string, Partial<Record<StageName, StageProgress>>>
  difficulty: Difficulty | 'auto'
  models: RoleModels
  suggestGlossary: boolean
  backTranslate: boolean
}

interface StageCard {
  stage: StageName
  title: string
  key: string
  roles: Array<keyof RoleModels>
}

const shortModel = (id: string): string => {
  const name = id.split('/')[1] ?? id
  return name.replace(/-\d{4,}$/, '').replace(/-preview.*$/, '')
}

function plannedStages(props: PipelineBoardProps): StageCard[] {
  const difficulty = props.difficulty === 'auto' ? 'normal' : props.difficulty
  const plan = planFor(difficulty)
  const cards: StageCard[] = []
  if (difficulty !== 'simple')
    cards.push({ stage: 'brief', title: 'Brief', key: '*', roles: ['helper'] })
  cards.push({
    stage: 'translate',
    title: plan.translators.length > 1 ? `Translate ×${plan.translators.length}` : 'Translate',
    key: props.targetKey,
    roles: plan.translators,
  })
  if (plan.reviewers > 0)
    cards.push({ stage: 'review', title: 'Review', key: props.targetKey, roles: ['reviewer'] })
  if (plan.guidelineCheck)
    cards.push({
      stage: 'guidelines',
      title: 'Guidelines',
      key: props.targetKey,
      roles: ['reviewer'],
    })
  if (plan.judge)
    cards.push({ stage: 'judge', title: 'Judge', key: props.targetKey, roles: ['judge'] })
  if (plan.finalize)
    cards.push({ stage: 'finalize', title: 'Finalize', key: props.targetKey, roles: ['finalizer'] })
  if (plan.score)
    cards.push({ stage: 'score', title: 'Score', key: props.targetKey, roles: ['scorer'] })
  if (plan.backTranslate || props.backTranslate)
    cards.push({
      stage: 'backtranslate',
      title: 'Back-translate',
      key: props.targetKey,
      roles: ['backTranslator'],
    })
  if (props.suggestGlossary && plan.finalize)
    cards.push({
      stage: 'glossary',
      title: 'Glossary terms',
      key: props.targetKey,
      roles: ['helper'],
    })
  return cards
}

const noteFor = (stage: StageName, result: TargetResult | undefined): string | null => {
  if (!result) return null
  switch (stage) {
    case 'translate': {
      const high = result.disagreements.filter((d) => d.severity === 'high').length
      return result.disagreements.length === 0
        ? result.candidates.length > 1
          ? 'candidates agree'
          : null
        : `${result.disagreements.length} disagreement${result.disagreements.length > 1 ? 's' : ''}${high ? ` (${high} high)` : ''}`
    }
    case 'review': {
      const issues = result.reviews.reduce((n, r) => n + r.issues.length, 0)
      return issues === 0 ? 'no issues' : `${issues} issue${issues > 1 ? 's' : ''}`
    }
    case 'guidelines':
      return result.guidelineReport.length === 0
        ? 'all rules respected'
        : `${result.guidelineReport.length} violation${result.guidelineReport.length > 1 ? 's' : ''}`
    case 'judge':
      return result.judgments[0] ? `picked ${result.judgments[0].winner}` : null
    case 'score':
      return result.score ? `${result.score.overall} · confidence ${result.score.confidence}` : null
    case 'backtranslate':
      return result.backTranslation
        ? `${result.backTranslation.deltas.length} delta${result.backTranslation.deltas.length === 1 ? '' : 's'}`
        : null
    case 'glossary':
      return `${result.glossarySuggestions.length} suggested`
    case 'brief':
      return result.brief ? `${result.brief.domain} · ${result.brief.difficulty}` : null
    default:
      return null
  }
}

/** The assembly line for one target: one card per planned stage, filled from live events. */
export const PipelineBoard: FC<PipelineBoardProps> = (props) => {
  const cards = plannedStages(props)
  const done = props.progress.status === 'done'
  return (
    <ol
      className="grid gap-2"
      style={{ gridTemplateColumns: `repeat(${cards.length}, minmax(140px, 1fr))` }}
    >
      {cards.map((card) => {
        const st = props.stages[card.key]?.[card.stage]
        const status: 'waiting' | 'running' | 'done' | 'skipped' = st
          ? st.status === 'running'
            ? 'running'
            : 'done'
          : done
            ? 'skipped'
            : 'waiting'
        const modelIds = [...new Set(card.roles.map((r) => props.models[r]))]
        const border =
          status === 'done'
            ? 'border-success/50'
            : status === 'running'
              ? 'border-primary'
              : 'border-line border-dashed'
        return (
          <li
            key={`${card.key}:${card.stage}`}
            className={`rounded-xl border bg-canvas p-3 text-[13px] ${border} ${status === 'waiting' || status === 'skipped' ? 'bg-neutral-50' : ''}`}
            aria-label={`${card.title}: ${status}`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-fg">{card.title}</span>
              {status === 'running' ? (
                <Spinner className="h-3.5 w-3.5" />
              ) : status === 'done' ? (
                <span className="text-success" aria-hidden="true">
                  ✓
                </span>
              ) : (
                <span className="text-muted" aria-hidden="true">
                  {status === 'skipped' ? '–' : '·'}
                </span>
              )}
            </div>
            <p className="mt-1 truncate text-xs text-muted" title={modelIds.join(', ')}>
              {modelIds.map(shortModel).join(' + ')}
            </p>
            <p className="mt-1 text-xs text-body">
              {status === 'waiting'
                ? 'waiting'
                : status === 'skipped'
                  ? 'not needed'
                  : (noteFor(card.stage, props.progress.result) ?? STAGE_LABELS[card.stage])}
            </p>
            {st && st.calls > 0 ? (
              <p className="mt-1 font-mono text-[11px] text-muted">
                {st.calls} call{st.calls > 1 ? 's' : ''} · {formatUsd(st.usd)}
              </p>
            ) : null}
          </li>
        )
      })}
    </ol>
  )
}
