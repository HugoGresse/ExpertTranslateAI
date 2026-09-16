import type {
  Brief,
  CostSummary,
  ProgressEvent,
  StageName,
  TargetResult,
} from '@experttranslate/core'
import { map } from 'nanostores'

export interface TargetProgress {
  lang: string
  region?: string
  status: 'pending' | 'running' | 'done' | 'failed'
  chunkCount: number
  placeholders: Record<string, string>
  activity: string
  streamingStage: StageName | null
  streams: Record<number, string>
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

const emptyProgress = (lang: string, region?: string): TargetProgress => ({
  lang,
  ...(region ? { region } : {}),
  status: 'pending',
  chunkCount: 0,
  placeholders: {},
  activity: 'waiting',
  streamingStage: null,
  streams: {},
  stageCalls: {},
})

export const streamedText = (p: TargetProgress): string =>
  Object.keys(p.streams)
    .map(Number)
    .sort((a, b) => a - b)
    .map((i) => p.streams[i] ?? '')
    .join('\n\n')

const keyOf = (t: { lang: string; region?: string | undefined }): string =>
  t.region ? `${t.lang}#${t.region.trim().toLowerCase()}` : t.lang

const patchTarget = (
  key: string,
  patch: Partial<TargetProgress> | ((p: TargetProgress) => Partial<TargetProgress>),
): void => {
  const targets = $run.get().targets
  const current = targets[key]
  if (!current) return
  const delta = typeof patch === 'function' ? patch(current) : patch
  $run.setKey('targets', { ...targets, [key]: { ...current, ...delta } })
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

const isPreviewStream = (stage: StageName, role: string): boolean =>
  stage === 'finalize' || (stage === 'translate' && role === 'translatorA')

export function applyProgress(event: ProgressEvent): void {
  switch (event.type) {
    case 'job-started':
      $run.set({
        status: 'running',
        jobId: event.jobId,
        brief: null,
        cost: null,
        error: null,
        targets: Object.fromEntries(
          event.targets.map((t) => [keyOf(t), emptyProgress(t.lang, t.region)]),
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
    case 'stage-started':
      if (event.targetKey === '*') {
        for (const key of Object.keys($run.get().targets))
          patchTarget(key, { activity: STAGE_LABEL[event.stage] })
        return
      }
      patchTarget(event.targetKey, (p) => {
        const chunkLabel =
          event.chunkIndex !== null ? `, chunk ${event.chunkIndex + 1}/${p.chunkCount}` : ''
        const activity = `${STAGE_LABEL[event.stage]} (${event.role}${chunkLabel})`
        if (!isPreviewStream(event.stage, event.role) || event.chunkIndex === null)
          return { activity }
        const switching = event.stage === 'finalize' && p.streamingStage !== 'finalize'
        const streams = switching ? {} : { ...p.streams }
        if (event.stage === 'translate' && p.streamingStage === 'finalize') return { activity }
        streams[event.chunkIndex] = ''
        return { activity, streamingStage: event.stage, streams }
      })
      return
    case 'token':
      patchTarget(event.targetKey, (p) => {
        if (event.stage !== p.streamingStage || !isPreviewStream(event.stage, event.role)) return {}
        return {
          streams: {
            ...p.streams,
            [event.chunkIndex]: (p.streams[event.chunkIndex] ?? '') + event.delta,
          },
        }
      })
      return
    case 'stage-done':
      if (event.targetKey === '*') return
      patchTarget(event.targetKey, (p) => ({
        stageCalls: { ...p.stageCalls, [event.stage]: (p.stageCalls[event.stage] ?? 0) + 1 },
      }))
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
