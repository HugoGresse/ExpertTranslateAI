import {
  type Brief,
  type CostSummary,
  type ProgressEvent,
  STAGE_LABELS,
  type StageName,
  type TargetResult,
  targetKey,
} from '@experttranslate/core'
import { map } from 'nanostores'
import { logger } from '../adapters/logger'

export interface TargetProgress {
  lang: string
  region?: string
  status: 'pending' | 'running' | 'done' | 'failed'
  chunkCount: number
  placeholders: Record<string, string>
  activity: string
  result?: TargetResult
  error?: string
}

export interface RunState {
  status: 'idle' | 'running' | 'done' | 'cancelled' | 'failed'
  jobId: string | null
  brief: Brief | null
  targets: Record<string, TargetProgress>
  cost: CostSummary | null
  error: string | null
}

export const idleRun: RunState = {
  status: 'idle',
  jobId: null,
  brief: null,
  targets: {},
  cost: null,
  error: null,
}

export const $run = map<RunState>(idleRun)

/** Live text per chunk, bucketed by the stage that produced it; the finalizer overrides the translator per chunk. */
export interface TargetPreview {
  translate: Record<number, string>
  finalize: Record<number, string>
}

/** Kept apart from `$run` so token bursts only re-render the preview pane, not the whole workspace. */
export const $previews = map<Record<string, TargetPreview>>({})

export const previewChunks = (preview: TargetPreview | undefined, chunkCount: number): string[] =>
  // `||` on purpose: a finalizer that has started but not streamed yet keeps showing the translator's text.
  Array.from({ length: chunkCount }, (_, i) => preview?.finalize[i] || preview?.translate[i] || '')

const emptyProgress = (lang: string, region?: string): TargetProgress => ({
  lang,
  ...(region ? { region } : {}),
  status: 'pending',
  chunkCount: 0,
  placeholders: {},
  activity: 'waiting',
})

const patchTarget = (key: string, patch: Partial<TargetProgress>): void => {
  const targets = $run.get().targets
  const current = targets[key]
  if (!current) {
    logger.warn('run.unknownTarget', { key, known: Object.keys(targets) })
    return
  }
  $run.setKey('targets', { ...targets, [key]: { ...current, ...patch } })
}

type PreviewStage = keyof TargetPreview

const previewStageOf = (stage: StageName, role: string): PreviewStage | null =>
  stage === 'finalize'
    ? 'finalize'
    : stage === 'translate' && role === 'translatorA'
      ? 'translate'
      : null

const writePreview = (key: string, stage: PreviewStage, chunkIndex: number, text: string): void => {
  const all = $previews.get()
  const current = all[key] ?? { translate: {}, finalize: {} }
  $previews.setKey(key, { ...current, [stage]: { ...current[stage], [chunkIndex]: text } })
}

export function applyProgress(event: ProgressEvent): void {
  switch (event.type) {
    case 'job-started':
      $previews.set({})
      $run.set({
        status: 'running',
        jobId: event.jobId,
        brief: null,
        cost: null,
        error: null,
        targets: Object.fromEntries(
          event.targets.map((t) => [targetKey(t), emptyProgress(t.lang, t.region)]),
        ),
      })
      return
    case 'brief-done':
      $run.setKey('brief', event.brief)
      return
    case 'target-started':
      patchTarget(event.targetKey, {
        status: 'running',
        chunkCount: event.chunkCount,
        placeholders: event.placeholders,
      })
      return
    case 'stage-started': {
      if (event.targetKey === '*') {
        for (const key of Object.keys($run.get().targets))
          patchTarget(key, { activity: STAGE_LABELS[event.stage] })
        return
      }
      const chunkCount = $run.get().targets[event.targetKey]?.chunkCount ?? 0
      const chunkLabel =
        event.chunkIndex !== null ? `, chunk ${event.chunkIndex + 1}/${chunkCount}` : ''
      patchTarget(event.targetKey, {
        activity: `${STAGE_LABELS[event.stage]} (${event.role}${chunkLabel})`,
      })
      const stage = previewStageOf(event.stage, event.role)
      if (stage && event.chunkIndex !== null)
        writePreview(event.targetKey, stage, event.chunkIndex, '')
      return
    }
    case 'token': {
      const stage = previewStageOf(event.stage, event.role)
      if (!stage) return
      const existing = $previews.get()[event.targetKey]?.[stage][event.chunkIndex] ?? ''
      writePreview(event.targetKey, stage, event.chunkIndex, existing + event.delta)
      return
    }
    case 'stage-done':
      return
    case 'escalated':
      patchTarget(event.targetKey, {
        activity: `escalating ${event.from} → ${event.to}${event.chunkIndex !== null ? ` (chunk ${event.chunkIndex + 1})` : ''}: ${event.reason}`,
      })
      return
    case 'target-done':
      patchTarget(event.targetKey, { status: 'done', result: event.result, activity: 'done' })
      return
    case 'target-failed':
      patchTarget(event.targetKey, { status: 'failed', error: event.error, activity: 'failed' })
      return
    case 'job-done':
      $run.setKey('cost', event.cost)
      $run.setKey('status', 'done')
      return
  }
}
