import { type JobStatus, type TranslationJob, targetKey } from '@experttranslate/core'
import type { RunCarry, RunState } from './run'

export interface RetryPlan {
  /** Same id as the run it continues, so history keeps one job; only unfinished targets. */
  job: TranslationJob
  carry: RunCarry
}

/** A run can be retried once it stopped with at least one target that did not finish. */
export const canRetry = (run: RunState): boolean =>
  run.job !== null &&
  run.status !== 'running' &&
  run.status !== 'idle' &&
  Object.values(run.targets).some((t) => t.status !== 'done')

/** Re-runs the targets a stopped run left unfinished (network error, credit ran out, cancel). */
export function planRetry(run: RunState): RetryPlan | null {
  if (!canRetry(run) || !run.job) return null
  const full = run.job
  const isDone = (key: string): boolean => run.targets[key]?.status === 'done'
  const pending = full.targets.filter((t) => !isDone(targetKey(t)))
  const doneKeys = new Set(full.targets.map(targetKey).filter(isDone))
  const pick = <T>(rec: Record<string, T>): Record<string, T> =>
    Object.fromEntries(Object.entries(rec).filter(([k]) => doneKeys.has(k)))
  return {
    job: { ...full, targets: pending, status: 'queued' },
    carry: {
      job: full,
      targets: pick(run.targets),
      // Job-level stages ran for everyone; the retry runs them again and adds to the same card.
      stages: { ...pick(run.stages), ...(run.stages['*'] ? { '*': run.stages['*'] } : {}) },
      brief: run.brief,
      live: run.live,
    },
  }
}

/** Status of the whole job once a retry ends, judged on every target, not just the retried ones. */
export function mergedJobStatus(run: RunState): JobStatus {
  if (run.status === 'cancelled') return 'cancelled'
  return Object.values(run.targets).every((t) => t.status === 'done') ? 'done' : 'failed'
}
