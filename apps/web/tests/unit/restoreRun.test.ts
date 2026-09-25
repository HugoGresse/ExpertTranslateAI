import type { StageName, TargetResult, TraceEvent } from '@experttranslate/core'
import { sampleJob } from '@experttranslate/core/testing'
import { describe, expect, it } from 'vitest'
import { restoreRun } from '../../src/stores/restoreRun'

const call = (stage: StageName, role: string, at: number, costUsd: number): TraceEvent => ({
  at,
  lang: 'fr',
  stage,
  role,
  model: 'test/model',
  chunkIndex: stage === 'brief' ? null : 0,
  prompt: { system: '', user: '' },
  output: '',
  usage: { promptTokens: 10, completionTokens: 5, costUsd },
  latencyMs: 1,
})

const brief = call('brief', 'helper', 1, 0.01)

const result = (key: string, trace: TraceEvent[]): TargetResult =>
  ({
    cost: { usd: 0, tokensIn: 0, tokensOut: 0, calls: trace.length },
    jobId: 'j',
    lang: key,
    targetKey: key,
    chunks: [{ index: 0 }],
    placeholders: { '⟦0⟧': '{{name}}' },
    brief: null,
    trace: [brief, ...trace],
  }) as unknown as TargetResult

describe('restoreRun', () => {
  it('counts job-level calls once and rebuilds per-target stages from the trace', () => {
    const job = sampleJob({
      id: 'j',
      status: 'done',
      targets: [{ lang: 'fr' }, { lang: 'es' }],
      difficulty: 'normal',
    })
    const run = restoreRun(job, [
      result('fr', [call('translate', 'translatorA', 2, 0.02)]),
      result('es', [
        call('translate', 'translatorA', 3, 0.02),
        call('review', 'reviewer', 4, 0.03),
      ]),
    ])
    expect(run.status).toBe('done')
    expect(run.job).toBe(job)
    expect(run.stages['*']?.brief?.calls).toBe(1)
    expect(run.stages.es?.review).toMatchObject({ status: 'done', calls: 1, usd: 0.03 })
    expect(run.cost).toMatchObject({ calls: 4, tokensIn: 40 })
    expect(run.cost?.usd).toBeCloseTo(0.08)
    expect(run.targets.fr).toMatchObject({ status: 'done', chunkCount: 1, callsDone: 1 })
  })

  it('marks targets without a stored result as failed and flags interrupted jobs', () => {
    const run = restoreRun(sampleJob({ status: 'running', targets: [{ lang: 'fr' }] }), [])
    expect(run.status).toBe('failed')
    expect(run.error).toBe('This run did not finish.')
    expect(run.targets.fr).toMatchObject({ status: 'failed', error: 'No result was stored.' })
  })
})
