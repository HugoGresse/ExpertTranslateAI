import type {
  Brief,
  CostSummary,
  ProgressEvent,
  StageName,
  TargetResult,
} from '@experttranslate/core'
import { map } from 'nanostores'

export interface TargetProgress {
  status: 'pending' | 'running' | 'done' | 'failed'
  chunkCount: number
  placeholders: Record<string, string>
  activity: string
  streamed: string
  streamingStage: StageName | null
  stageCalls: Partial<Record<StageName, number>>
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

const emptyProgress = (): TargetProgress => ({
  status: 'pending',
  chunkCount: 0,
  placeholders: {},
  activity: 'waiting',
  streamed: '',
  streamingStage: null,
  stageCalls: {},
})

const patchTarget = (
  lang: string,
  patch: Partial<TargetProgress> | ((p: TargetProgress) => Partial<TargetProgress>),
): void => {
  const targets = $run.get().targets
  const current = targets[lang] ?? emptyProgress()
  const delta = typeof patch === 'function' ? patch(current) : patch
  $run.setKey('targets', { ...targets, [lang]: { ...current, ...delta } })
}

const STAGE_LABEL: Record<StageName, string> = {
  context: 'condensing context',
  brief: 'writing brief',
  translate: 'translating',
  review: 'reviewing',
  guidelines: 'auditing guidelines',
  judge: 'judging',
  finalize: 'finalizing',
  score: 'scoring',
  backtranslate: 'back-translating',
}

export function applyProgress(event: ProgressEvent): void {
  switch (event.type) {
    case 'job-started':
      $run.set({
        status: 'running',
        jobId: event.jobId,
        brief: null,
        cost: null,
        error: null,
        targets: Object.fromEntries(event.targets.map((t) => [t.lang, emptyProgress()])),
      })
      return
    case 'brief-done':
      $run.setKey('brief', event.brief)
      return
    case 'target-started':
      patchTarget(event.lang, {
        status: 'running',
        chunkCount: event.chunkCount,
        placeholders: event.placeholders,
      })
      return
    case 'stage-started':
      if (event.lang === '*') {
        for (const lang of Object.keys($run.get().targets))
          patchTarget(lang, { activity: STAGE_LABEL[event.stage] })
        return
      }
      patchTarget(event.lang, (p) => ({
        activity: `${STAGE_LABEL[event.stage]} (${event.role}${event.chunkIndex !== null ? `, chunk ${event.chunkIndex + 1}/${p.chunkCount}` : ''})`,
        ...(event.stage === 'translate' &&
        event.role === 'translatorA' &&
        p.streamingStage !== 'finalize'
          ? { streamed: '', streamingStage: 'translate' }
          : {}),
        ...(event.stage === 'finalize' ? { streamed: '', streamingStage: 'finalize' } : {}),
      }))
      return
    case 'token':
      patchTarget(event.lang, (p) => {
        const relevant =
          event.stage === p.streamingStage &&
          (event.stage !== 'translate' || event.role === 'translatorA')
        return relevant ? { streamed: p.streamed + event.delta } : {}
      })
      return
    case 'stage-done':
      if (event.lang === '*') return
      patchTarget(event.lang, (p) => ({
        stageCalls: { ...p.stageCalls, [event.stage]: (p.stageCalls[event.stage] ?? 0) + 1 },
      }))
      return
    case 'target-done':
      patchTarget(event.lang, { status: 'done', result: event.result, activity: 'done' })
      return
    case 'escalated':
      patchTarget(event.lang, {
        activity: `escalating ${event.from} → ${event.to}${event.chunkIndex !== null ? ` (chunk ${event.chunkIndex + 1})` : ''}: ${event.reason}`,
      })
      return
    case 'target-failed':
      patchTarget(event.lang, { status: 'failed', error: event.error, activity: 'failed' })
      return
    case 'job-done':
      $run.setKey('cost', event.cost)
      $run.setKey('status', 'done')
      return
  }
}
