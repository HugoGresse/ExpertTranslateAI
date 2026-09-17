import {
  type Brief,
  type CostSummary,
  type Difficulty,
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
  /** Model calls finished so far for this target. */
  callsDone: number
  placeholders: Record<string, string>
  activity: string
  result?: TargetResult
  error?: string
}

export interface StageProgress {
  status: 'running' | 'done'
  /** Calls finished for this stage. */
  calls: number
  running: number
  usd: number
  roles: string[]
}

export interface RunState {
  status: 'idle' | 'running' | 'done' | 'cancelled' | 'failed'
  jobId: string | null
  /** Difficulty the job was started with; `auto` resolves when the brief arrives. */
  difficulty: Difficulty | 'auto'
  brief: Brief | null
  /** Per target key (or `*` for job-level stages), per stage. */
  stages: Record<string, Partial<Record<StageName, StageProgress>>>
  targets: Record<string, TargetProgress>
  /** Running totals from every finished call, updated while the job is live. */
  live: CostSummary
  cost: CostSummary | null
  error: string | null
}

export const idleRun: RunState = {
  status: 'idle',
  jobId: null,
  difficulty: 'auto',
  brief: null,
  stages: {},
  targets: {},
  live: { usd: 0, calls: 0, tokensIn: 0, tokensOut: 0 },
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
  callsDone: 0,
  placeholders: {},
  activity: 'waiting',
})

const emptyStage = (): StageProgress => ({
  status: 'running',
  calls: 0,
  running: 0,
  usd: 0,
  roles: [],
})

const touchStage = (
  key: string,
  stage: StageName,
  update: (st: StageProgress) => StageProgress,
): void => {
  const stages = $run.get().stages
  const forKey = stages[key] ?? {}
  $run.setKey('stages', {
    ...stages,
    [key]: { ...forKey, [stage]: update(forKey[stage] ?? emptyStage()) },
  })
}

/** Called by the workspace before the engine starts so the board can draw the planned stages. */
export const beginRun = (difficulty: Difficulty | 'auto'): void => {
  $run.set({ ...idleRun, difficulty })
  $previews.set({})
}

const patchTarget = (
  key: string,
  patch: Partial<TargetProgress> | ((p: TargetProgress) => Partial<TargetProgress>),
): void => {
  const targets = $run.get().targets
  const current = targets[key]
  if (!current) {
    logger.warn('run.unknownTarget', { key, known: Object.keys(targets) })
    return
  }
  const delta = typeof patch === 'function' ? patch(current) : patch
  $run.setKey('targets', { ...targets, [key]: { ...current, ...delta } })
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
        difficulty: $run.get().difficulty,
        brief: null,
        stages: {},
        live: { usd: 0, calls: 0, tokensIn: 0, tokensOut: 0 },
        cost: null,
        error: null,
        targets: Object.fromEntries(
          event.targets.map((t) => [targetKey(t), emptyProgress(t.lang, t.region)]),
        ),
      })
      return
    case 'brief-done':
      $run.setKey('brief', event.brief)
      if ($run.get().difficulty === 'auto') $run.setKey('difficulty', event.brief.difficulty)
      return
    case 'target-started':
      patchTarget(event.targetKey, {
        status: 'running',
        chunkCount: event.chunkCount,
        placeholders: event.placeholders,
      })
      return
    case 'stage-started': {
      touchStage(event.targetKey, event.stage, (st) => ({
        ...st,
        status: 'running',
        running: st.running + 1,
        roles: st.roles.includes(event.role) ? st.roles : [...st.roles, event.role],
      }))
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
    case 'stage-done': {
      touchStage(event.targetKey, event.stage, (st) => ({
        ...st,
        running: Math.max(0, st.running - 1),
        status: st.running - 1 <= 0 ? 'done' : 'running',
        calls: st.calls + 1,
        usd: st.usd + (event.usage.costUsd ?? 0),
      }))
      const live = $run.get().live
      $run.setKey('live', {
        usd: live.usd + (event.usage.costUsd ?? 0),
        calls: live.calls + 1,
        tokensIn: live.tokensIn + event.usage.promptTokens,
        tokensOut: live.tokensOut + event.usage.completionTokens,
      })
      if (event.targetKey !== '*')
        patchTarget(event.targetKey, (p) => ({ callsDone: p.callsDone + 1 }))
      return
    }
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
