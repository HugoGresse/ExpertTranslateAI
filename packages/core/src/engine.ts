import { ensureDigests } from './context/prepare.ts'
import { addUsage, emptyCost, findPricing, usageCost } from './llm/pricing.ts'
import { createBudgetTracker } from './pipeline/budget.ts'
import type { StageContext } from './pipeline/call.ts'
import { createEventQueue } from './pipeline/eventQueue.ts'
import { type Plan, planFor, stageCallsPerChunk } from './pipeline/plan.ts'
import { type JobMaterials, runTarget } from './pipeline/runTarget.ts'
import { runBrief } from './pipeline/stages/brief.ts'
import type { EnginePorts, Repo } from './ports.ts'
import { chunkText } from './text/chunk.ts'
import { countTokens } from './text/tokens.ts'
import type {
  Brief,
  ContextSource,
  CostSummary,
  Difficulty,
  JobEstimate,
  ModelInfo,
  ProgressEvent,
  TargetResult,
  TraceEvent,
  TranslationJob,
} from './types.ts'
import { AUTO_LANG } from './types.ts'

export interface Engine {
  run(job: TranslationJob, opts?: { signal?: AbortSignal }): AsyncIterable<ProgressEvent>
  estimate(job: TranslationJob, models: ModelInfo[], sources?: ContextSource[]): JobEstimate
}

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)
const isAbort = (error: unknown): boolean =>
  error instanceof DOMException && error.name === 'AbortError'

async function loadByIds<T extends { id: string }>(repo: Repo<T>, ids: string[]): Promise<T[]> {
  const out: T[] = []
  for (const item of await Promise.all(ids.map((id) => repo.get(id)))) if (item) out.push(item)
  return out
}

const BRIEF_MAX_TOKENS = 6000

function briefSource(text: string): string {
  if (countTokens(text) <= BRIEF_MAX_TOKENS) return text
  const head = text.slice(0, Math.floor(text.length * 0.6))
  const tail = text.slice(-Math.floor(text.length * 0.15))
  return `${head}\n[...]\n${tail}`
}

const needsBrief = (job: TranslationJob): boolean => job.difficulty !== 'simple'

const isRelevantSource = (source: ContextSource, job: TranslationJob): boolean =>
  source.enabled && (!source.lang || job.targets.some((t) => t.lang === source.lang))

function resolvePlan(job: TranslationJob, brief: Brief | null): Plan {
  const difficulty: Difficulty =
    job.difficulty === 'auto' ? (brief?.difficulty ?? 'normal') : job.difficulty
  return planFor(difficulty)
}

export function createEngine(ports: EnginePorts): Engine {
  return {
    run(job, opts) {
      const events = createEventQueue()
      const trace: TraceEvent[] = []
      const ctx: StageContext = {
        llm: ports.llm,
        clock: ports.clock,
        logger: ports.logger,
        events,
        budget: createBudgetTracker(job.options.budgetUsd),
        trace,
        reasoningEffort: job.options.reasoningEffort,
        ...(opts?.signal ? { signal: opts.signal } : {}),
      }

      const prepare = async (): Promise<{ materials: JobMaterials; plan: Plan }> => {
        const [rawSources, guidelineSets] = await Promise.all([
          loadByIds(ports.storage.contexts, job.options.contextSourceIds),
          loadByIds(ports.storage.guidelines, job.options.guidelineSetIds),
        ])
        const { sources } = await ensureDigests(
          rawSources.filter((s) => isRelevantSource(s, job)),
          {
            budgetPerSource: job.options.contextTokenBudget,
            model: job.models.helper,
            storage: ports.storage,
            ctx,
          },
        )

        let brief: Brief | null = null
        if (needsBrief(job)) {
          brief = await runBrief(
            {
              model: job.models.helper,
              sourceText: briefSource(job.sourceText),
              sourceLangHint: job.sourceLang === AUTO_LANG ? 'unknown, detect it' : job.sourceLang,
              targetLangs: job.targets.map((t) => t.lang),
              materials: { brief: null },
            },
            ctx,
          )
          events.emit({ type: 'brief-done', brief })
        }
        const plan = resolvePlan(job, brief)
        ports.logger.info('job.plan', {
          difficulty: plan.difficulty,
          translators: plan.translators.length,
          review: plan.review,
          judge: plan.judge,
        })
        return { materials: { sources, guidelineSets, brief, trace }, plan }
      }

      const targetTraces: TraceEvent[][] = []
      const totalCost = (): CostSummary =>
        [trace, ...targetTraces]
          .flat()
          .reduce<CostSummary>((acc, t) => addUsage(acc, t.usage), emptyCost())

      const execute = async (): Promise<void> => {
        events.emit({ type: 'job-started', jobId: job.id, targets: job.targets })
        await ports.storage.jobs.put({ ...job, status: 'running' })
        let prepared: Awaited<ReturnType<typeof prepare>>
        try {
          prepared = await prepare()
        } catch (error) {
          ports.logger.error('job.prepareFailed', { error: errorMessage(error) })
          await ports.storage.jobs.put({ ...job, status: isAbort(error) ? 'cancelled' : 'failed' })
          for (const t of job.targets)
            events.emit({ type: 'target-failed', lang: t.lang, error: errorMessage(error) })
          events.emit({ type: 'job-done', jobId: job.id, cost: totalCost() })
          return
        }
        const results = await Promise.all(
          job.targets.map(async (target): Promise<TargetResult | null> => {
            const targetCtx: StageContext = { ...ctx, trace: [] }
            targetTraces.push(targetCtx.trace)
            try {
              const result = await runTarget(
                job,
                prepared.plan,
                target,
                prepared.materials,
                targetCtx,
              )
              await ports.storage.results.put(result)
              events.emit({ type: 'target-done', lang: target.lang, result })
              return result
            } catch (error) {
              const status = isAbort(error) ? 'cancelled' : 'failed'
              ports.logger.error('target.failed', {
                lang: target.lang,
                status,
                error: errorMessage(error),
              })
              events.emit({ type: 'target-failed', lang: target.lang, error: errorMessage(error) })
              return null
            }
          }),
        )
        const done = results.filter((r): r is TargetResult => r !== null)
        const status = opts?.signal?.aborted
          ? 'cancelled'
          : done.length === job.targets.length
            ? 'done'
            : 'failed'
        await ports.storage.jobs.put({ ...job, status })
        events.emit({ type: 'job-done', jobId: job.id, cost: totalCost() })
      }

      execute().then(
        () => events.close(),
        (error: unknown) => events.fail(error),
      )
      return events
    },

    estimate(job, models, sources = []) {
      const sourceTokens = countTokens(job.sourceText)
      const chunkCount = chunkText(job.sourceText, job.options.maxTokensPerChunk).length
      const difficulty: Difficulty = job.difficulty === 'auto' ? 'normal' : job.difficulty
      const plan = planFor(difficulty)
      const perChunk = stageCallsPerChunk(plan)
      const callCount =
        chunkCount * perChunk * job.targets.length +
        (needsBrief(job) ? 1 : 0) +
        (plan.score ? job.targets.length : 0)
      const contextTokens = sources
        .filter((s) => isRelevantSource(s, job) && job.options.contextSourceIds.includes(s.id))
        .reduce(
          (acc, s) => acc + Math.min(countTokens(s.rawText), job.options.contextTokenBudget),
          0,
        )
      const pricing = findPricing(models, job.models.translatorA)
      const promptPerCall = sourceTokens + contextTokens + 400
      const outputPerCall = sourceTokens * 1.2
      const estimatedUsd = pricing
        ? usageCost(
            {
              promptTokens: promptPerCall * callCount,
              completionTokens: outputPerCall * callCount,
            },
            pricing,
          )
        : null
      return { sourceTokens, contextTokens, chunkCount, callCount, estimatedUsd, difficulty }
    },
  }
}
