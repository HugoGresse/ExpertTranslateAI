import type { CostSummary, ProgressEvent, TargetResult } from '@experttranslate/core'
import { map } from 'nanostores'

export interface TargetProgress {
  status: 'pending' | 'running' | 'done' | 'failed'
  chunkCount: number
  chunksDone: number
  streamed: string
  result?: TargetResult
  error?: string
}

export interface RunState {
  status: 'idle' | 'running' | 'done' | 'cancelled' | 'failed'
  jobId: string | null
  targets: Record<string, TargetProgress>
  cost: CostSummary | null
  error: string | null
}

export const idleRun: RunState = {
  status: 'idle',
  jobId: null,
  targets: {},
  cost: null,
  error: null,
}

export const $run = map<RunState>(idleRun)

const patchTarget = (lang: string, patch: Partial<TargetProgress>): void => {
  const targets = $run.get().targets
  const current = targets[lang] ?? { status: 'pending', chunkCount: 0, chunksDone: 0, streamed: '' }
  $run.setKey('targets', { ...targets, [lang]: { ...current, ...patch } })
}

export function applyProgress(event: ProgressEvent): void {
  switch (event.type) {
    case 'job-started':
      $run.set({
        status: 'running',
        jobId: event.jobId,
        cost: null,
        error: null,
        targets: Object.fromEntries(
          event.targets.map((t) => [
            t.lang,
            { status: 'pending', chunkCount: 0, chunksDone: 0, streamed: '' },
          ]),
        ),
      })
      return
    case 'target-started':
      patchTarget(event.lang, { status: 'running', chunkCount: event.chunkCount })
      return
    case 'token': {
      const current = $run.get().targets[event.lang]
      patchTarget(event.lang, { streamed: (current?.streamed ?? '') + event.delta })
      return
    }
    case 'stage-done': {
      const current = $run.get().targets[event.lang]
      patchTarget(event.lang, { chunksDone: (current?.chunksDone ?? 0) + 1 })
      return
    }
    case 'target-done':
      patchTarget(event.lang, { status: 'done', result: event.result })
      return
    case 'target-failed':
      patchTarget(event.lang, { status: 'failed', error: event.error })
      return
    case 'job-done':
      $run.setKey('cost', event.cost)
      $run.setKey('status', 'done')
      return
    case 'stage-started':
      return
  }
}
