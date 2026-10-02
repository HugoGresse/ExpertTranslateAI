import type { TargetResult } from '@experttranslate/core'
import { sampleJob } from '@experttranslate/core/testing'
import { beforeEach, describe, expect, it } from 'vitest'
import { canRetry, mergedJobStatus, planRetry } from '../../src/stores/retry'
import { $run, applyProgress, beginRun, idleRun, type RunState } from '../../src/stores/run'

const job = sampleJob({ id: 'j', targets: [{ lang: 'fr' }, { lang: 'es', region: 'Mexico' }] })
const cost = { usd: 0.01, calls: 2, tokensIn: 20, tokensOut: 10 }

const stopped = (status: RunState['status']): RunState => ({
  ...idleRun,
  status,
  jobId: 'j',
  job,
  stages: {
    '*': { brief: { status: 'done', calls: 1, running: 0, usd: 0.001, roles: ['helper'] } },
    fr: { translate: { status: 'done', calls: 1, running: 0, usd: 0.005, roles: ['translatorA'] } },
    'es#mexico': {},
  },
  targets: {
    fr: {
      lang: 'fr',
      status: 'done',
      chunkCount: 1,
      callsDone: 1,
      placeholders: {},
      activity: 'done',
      result: { targetKey: 'fr' } as TargetResult,
    },
    'es#mexico': {
      lang: 'es',
      region: 'Mexico',
      status: 'failed',
      chunkCount: 1,
      callsDone: 0,
      placeholders: {},
      activity: 'failed',
      error: 'HTTP 402: insufficient credits',
    },
  },
  live: cost,
  cost,
})

describe('retry', () => {
  beforeEach(() => $run.set(idleRun))

  it('offers a retry only for a stopped run with unfinished targets', () => {
    expect(canRetry(stopped('failed'))).toBe(true)
    expect(canRetry(stopped('cancelled'))).toBe(true)
    expect(canRetry({ ...stopped('failed'), status: 'running' })).toBe(false)
    const allDone = stopped('done')
    const es = allDone.targets['es#mexico']
    if (es) allDone.targets['es#mexico'] = { ...es, status: 'done' }
    expect(canRetry(allDone)).toBe(false)
  })

  it('re-runs only unfinished targets under the same job id and keeps finished ones', () => {
    const plan = planRetry(stopped('failed'))
    expect(plan?.job.id).toBe('j')
    expect(plan?.job.targets).toEqual([{ lang: 'es', region: 'Mexico' }])
    expect(Object.keys(plan?.carry.targets ?? {})).toEqual(['fr'])
    expect(Object.keys(plan?.carry.stages ?? {}).sort()).toEqual(['*', 'fr'])
    expect(plan?.carry.job.targets).toHaveLength(2)
  })

  it('merges the carried targets and cost into the retried run', () => {
    const plan = planRetry(stopped('failed'))
    if (!plan) throw new Error('expected a plan')
    beginRun(plan.job, plan.carry)
    applyProgress({ type: 'job-started', jobId: 'j', targets: plan.job.targets })
    expect(Object.keys($run.get().targets).sort()).toEqual(['es#mexico', 'fr'])
    expect($run.get().targets.fr?.status).toBe('done')
    expect($run.get().job?.targets).toHaveLength(2)
    applyProgress({
      type: 'target-done',
      lang: 'es',
      targetKey: 'es#mexico',
      result: { targetKey: 'es#mexico' } as TargetResult,
    })
    applyProgress({ type: 'job-done', jobId: 'j', cost })
    expect($run.get().cost).toEqual({ usd: 0.02, calls: 4, tokensIn: 40, tokensOut: 20 })
    expect(mergedJobStatus($run.get())).toBe('done')
  })

  it('starts a fresh run with nothing carried over', () => {
    beginRun(job)
    applyProgress({ type: 'job-started', jobId: 'j', targets: job.targets })
    expect($run.get().live.calls).toBe(0)
    expect($run.get().targets.fr?.status).toBe('pending')
  })
})
