import {
  addUsage,
  type CostSummary,
  emptyCost,
  type StageName,
  type TargetResult,
  type TraceEvent,
  type TranslationJob,
  targetKey,
} from '@experttranslate/core'
import { emptyProgress, type RunState, type StageProgress } from './run'

/**
 * A result's trace is the job-level calls (brief, context, guideline extraction) followed by the
 * target's own; `cost` covers only the latter, so its call count marks the split.
 */
const splitTrace = (r: TargetResult): { job: TraceEvent[]; own: TraceEvent[] } => {
  const at = Math.max(0, r.trace.length - r.cost.calls)
  return { job: r.trace.slice(0, at), own: r.trace.slice(at) }
}

/** What the job cost: its job-level calls once, plus every target's own calls. */
export const jobCost = (results: TargetResult[]): CostSummary =>
  [
    ...(results[0] ? splitTrace(results[0]).job : []),
    ...results.flatMap((r) => splitTrace(r).own),
  ].reduce((acc, t) => addUsage(acc, t.usage), emptyCost())

const addCall = (
  stages: Partial<Record<StageName, StageProgress>>,
  t: TraceEvent,
): Partial<Record<StageName, StageProgress>> => {
  const st = stages[t.stage] ?? { status: 'done', calls: 0, running: 0, usd: 0, roles: [] }
  return {
    ...stages,
    [t.stage]: {
      ...st,
      calls: st.calls + 1,
      usd: st.usd + (t.usage.costUsd ?? 0),
      roles: st.roles.includes(t.role) ? st.roles : [...st.roles, t.role],
    },
  }
}

const STATUS: Record<TranslationJob['status'], RunState['status']> = {
  done: 'done',
  cancelled: 'cancelled',
  failed: 'failed',
  // A job still marked queued or running in storage was interrupted (tab closed, reload).
  queued: 'failed',
  running: 'failed',
}

/** Rebuilds the run view from what storage kept, so a stored job reads as it did when it finished. */
export function restoreRun(job: TranslationJob, results: TargetResult[]): RunState {
  const byKey = new Map(results.map((r) => [r.targetKey, r]))
  const stages: RunState['stages'] = {}
  const record = (key: string, trace: TraceEvent[]): void => {
    for (const t of trace) stages[key] = addCall(stages[key] ?? {}, t)
  }
  if (results[0]) record('*', splitTrace(results[0]).job)
  for (const r of results) record(r.targetKey, splitTrace(r).own)
  const cost = jobCost(results)
  const status = STATUS[job.status]
  const missing =
    status === 'cancelled' ? 'Cancelled before this target finished.' : 'No result was stored.'
  const targets: RunState['targets'] = Object.fromEntries(
    job.targets.map((t) => {
      const key = targetKey(t)
      const r = byKey.get(key)
      const base = emptyProgress(t.lang, t.region)
      return [
        key,
        r
          ? {
              ...base,
              status: 'done' as const,
              chunkCount: r.chunks.length,
              callsDone: splitTrace(r).own.length,
              placeholders: r.placeholders,
              activity: 'done',
              result: r,
            }
          : { ...base, status: 'failed' as const, activity: 'failed', error: missing },
      ]
    }),
  )
  const brief = results.find((r) => r.brief)?.brief ?? null
  return {
    status,
    jobId: job.id,
    job,
    difficulty: job.difficulty === 'auto' ? (brief?.difficulty ?? 'auto') : job.difficulty,
    brief,
    stages,
    targets,
    live: cost,
    cost,
    error: job.status === 'queued' || job.status === 'running' ? 'This run did not finish.' : null,
  }
}
