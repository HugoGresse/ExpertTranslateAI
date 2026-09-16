import type { ProgressEvent, TargetResult, Usage } from '@experttranslate/core'
import { beforeEach, describe, expect, it } from 'vitest'
import { $previews, $run, applyProgress, idleRun, previewChunks } from '../../src/stores/run'

const usage: Usage = { promptTokens: 1, completionTokens: 1, costUsd: null }
const token = (
  targetKey: string,
  stage: 'translate' | 'finalize',
  chunkIndex: number,
  delta: string,
): ProgressEvent => ({
  type: 'token',
  lang: 'fr',
  targetKey,
  stage,
  role: stage === 'translate' ? 'translatorA' : 'finalizer',
  chunkIndex,
  delta,
})
const started = (
  targetKey: string,
  stage: 'translate' | 'finalize',
  chunkIndex: number,
): ProgressEvent => ({
  type: 'stage-started',
  lang: 'fr',
  targetKey,
  stage,
  role: stage === 'translate' ? 'translatorA' : 'finalizer',
  chunkIndex,
})

describe('run store', () => {
  beforeEach(() => {
    $run.set(idleRun)
    $previews.set({})
  })

  it('keys targets like the engine and keeps chunk previews when one chunk finalizes early', () => {
    applyProgress({
      type: 'job-started',
      jobId: 'j',
      targets: [{ lang: 'fr' }, { lang: 'fr', region: ' Canada ' }],
    })
    expect(Object.keys($run.get().targets)).toEqual(['fr', 'fr#canada'])
    applyProgress({
      type: 'target-started',
      lang: 'fr',
      targetKey: 'fr',
      chunkCount: 2,
      placeholders: {},
    })
    applyProgress(started('fr', 'translate', 0))
    applyProgress(started('fr', 'translate', 1))
    applyProgress(token('fr', 'translate', 0, 'Bonjour'))
    applyProgress(token('fr', 'translate', 1, 'le monde'))
    applyProgress(started('fr', 'finalize', 0))
    applyProgress(token('fr', 'finalize', 0, 'Salut'))
    applyProgress(token('fr', 'translate', 1, ' entier'))
    expect(previewChunks($previews.get().fr, 2)).toEqual(['Salut', 'le monde entier'])
    applyProgress({
      type: 'stage-done',
      lang: 'fr',
      targetKey: 'fr',
      stage: 'finalize',
      role: 'finalizer',
      chunkIndex: 0,
      usage,
    })
    expect($run.get().targets.fr?.status).toBe('running')
  })

  it('ignores events for unknown targets instead of throwing', () => {
    applyProgress({ type: 'job-started', jobId: 'j', targets: [{ lang: 'fr' }] })
    applyProgress({ type: 'target-done', lang: 'es', targetKey: 'es', result: {} as TargetResult })
    expect($run.get().targets.es).toBeUndefined()
    expect($run.get().targets.fr?.status).toBe('pending')
  })
})
