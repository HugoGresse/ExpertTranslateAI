import { addUsage, emptyCost } from '../llm/pricing.ts'
import type { CostSummary, Escalation, Target, TargetResult, TranslationJob } from '../types.ts'
import { type Evaluation, evaluateOutcomes } from './audit.ts'
import type { StageContext } from './call.ts'
import { decideEscalation, nextDifficulty } from './escalation.ts'
import { type Plan, planFor } from './plan.ts'
import { type ChunkOutcome, processChunk } from './processChunk.ts'
import { type JobMaterials, setupTarget, type TargetSetup } from './setupTarget.ts'
import { isAbort } from './violations.ts'

export type { JobMaterials } from './setupTarget.ts'

interface EscalationOutcome {
  outcomes: ChunkOutcome[]
  plan: Plan
  escalations: Escalation[]
}

async function maybeEscalate(
  job: TranslationJob,
  plan: Plan,
  setup: TargetSetup,
  outcomes: ChunkOutcome[],
  evaluation: Evaluation,
  ctx: StageContext,
): Promise<EscalationOutcome> {
  const unchanged = { outcomes, plan, escalations: [] }
  if (!job.options.autoEscalate) return unchanged
  const decision = decideEscalation({
    difficulty: plan.difficulty,
    chunkCount: setup.chunks.length,
    disagreements: outcomes.flatMap((o) => o.disagreements),
    score: evaluation.score,
    confidenceThreshold: job.options.escalationConfidence,
    violations: [...evaluation.regexReport, ...evaluation.terminologyReport],
  })
  const to = decision ? nextDifficulty(plan.difficulty) : null
  if (!decision || !to) {
    ctx.logger.debug('target.escalation', {
      lang: setup.lang,
      decided: decision !== null,
      from: plan.difficulty,
      confidence: evaluation.score?.confidence ?? null,
      violations: evaluation.regexReport.length + evaluation.terminologyReport.length,
    })
    return unchanged
  }
  const nextPlan = planFor(to)
  ctx.logger.info('target.escalate', {
    lang: setup.lang,
    from: plan.difficulty,
    to,
    chunks: decision.chunks,
    reason: decision.reason,
  })
  const escalations: Escalation[] = decision.chunks.map((chunkIndex) => ({
    chunkIndex,
    from: plan.difficulty,
    to,
    reason: decision.reason,
  }))
  for (const e of escalations) ctx.events.emit({ type: 'escalated', lang: setup.lang, ...e })
  try {
    const rerun = await Promise.all(
      decision.chunks.map(async (chunkIndex) => {
        const chunk = setup.chunks[chunkIndex]
        if (!chunk) throw new Error(`Unknown chunk ${chunkIndex}`)
        return [
          chunkIndex,
          await processChunk(job, nextPlan, setup, setup.models, chunk, ctx),
        ] as const
      }),
    )
    const byIndex = new Map(rerun)
    return { outcomes: outcomes.map((o, i) => byIndex.get(i) ?? o), plan: nextPlan, escalations }
  } catch (error) {
    if (isAbort(error)) throw error
    ctx.logger.warn('target.escalationFailed', {
      lang: setup.lang,
      to,
      error: error instanceof Error ? error.message : String(error),
    })
    return unchanged
  }
}

export async function runTarget(
  job: TranslationJob,
  plan: Plan,
  target: Target,
  materials: JobMaterials,
  ctx: StageContext,
): Promise<TargetResult> {
  const setup = setupTarget(job, target, materials, ctx)
  const placeholders = Object.fromEntries(setup.placeholders)
  ctx.events.emit({
    type: 'target-started',
    lang: target.lang,
    chunkCount: setup.chunks.length,
    placeholders,
  })

  const models = materials.models
  const first = await Promise.all(
    setup.chunks.map((chunk) => processChunk(job, plan, setup, models, chunk, ctx)),
  )
  const firstEvaluation = await evaluateOutcomes(job, plan, setup, models, first, ctx)
  const escalated = await maybeEscalate(job, plan, setup, first, firstEvaluation, ctx)
  const evaluation =
    escalated.escalations.length > 0
      ? await evaluateOutcomes(job, escalated.plan, setup, models, escalated.outcomes, ctx)
      : firstEvaluation
  const outcomes = escalated.outcomes

  const cost = ctx.trace.reduce<CostSummary>((acc, t) => addUsage(acc, t.usage), emptyCost())
  return {
    jobId: job.id,
    lang: target.lang,
    sourceText: job.sourceText,
    sourceLang: setup.resolvedSourceLang,
    chunks: setup.chunks,
    placeholders,
    candidates: outcomes.flatMap((o) => o.candidates),
    finalText: evaluation.finalText,
    brief: materials.brief,
    plan: { difficulty: escalated.plan.difficulty, translators: escalated.plan.translators },
    reviews: outcomes.flatMap((o) => (o.review ? [o.review] : [])),
    judgments: outcomes.flatMap((o) => (o.judgment ? [o.judgment] : [])),
    score: evaluation.score,
    guidelineReport: evaluation.regexReport,
    terminologyReport: evaluation.terminologyReport,
    memoryHits: setup.memoryHits,
    disagreements: outcomes.flatMap((o) => o.disagreements),
    escalations: escalated.escalations,
    cost,
    trace: [...materials.trace, ...ctx.trace],
    status: 'done',
  }
}
