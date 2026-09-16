import {
  activeContextSources,
  buildContextBlock,
  ensureDigests,
  truncateToTokens,
} from './context/prepare.ts'
import { checkGuidelines } from './guidelines/check.ts'
import { activeGuidelineSets, formatGuidelinesBlock } from './guidelines/format.ts'
import { addUsage, emptyCost, findPricing, sumCosts, usageCost } from './llm/pricing.ts'
import { createEventQueue } from './pipeline/eventQueue.ts'
import { type StageContext, translateChunk } from './pipeline/stages/translate.ts'
import type { EnginePorts, Repo } from './ports.ts'
import { chunkText } from './text/chunk.ts'
import { placeholderParity, protectPlaceholders, restorePlaceholders } from './text/placeholders.ts'
import { countTokens } from './text/tokens.ts'
import type {
  Candidate,
  ContextSource,
  CostSummary,
  GuidelineSet,
  JobEstimate,
  ModelInfo,
  ProgressEvent,
  Target,
  TargetResult,
  TraceEvent,
  TranslationJob,
} from './types.ts'
import { AUTO_LANG } from './types.ts'

export interface Engine {
  run(job: TranslationJob, opts?: { signal?: AbortSignal }): AsyncIterable<ProgressEvent>
  estimate(job: TranslationJob, models: ModelInfo[], sources?: ContextSource[]): JobEstimate
}

interface JobMaterials {
  sources: ContextSource[]
  guidelineSets: GuidelineSet[]
}

const sourceLabel = (job: TranslationJob): string =>
  job.sourceLang === AUTO_LANG ? 'the source language (detect it yourself)' : job.sourceLang

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const isAbort = (error: unknown): boolean =>
  error instanceof DOMException && error.name === 'AbortError'

async function loadByIds<T extends { id: string }>(repo: Repo<T>, ids: string[]): Promise<T[]> {
  const out: T[] = []
  for (const item of await Promise.all(ids.map((id) => repo.get(id)))) if (item) out.push(item)
  return out
}

function guidelinesBlockFor(
  sets: GuidelineSet[],
  budget: number,
  ctx: StageContext,
  lang: string,
): string {
  const block = formatGuidelinesBlock(sets)
  const fitted = truncateToTokens(block, budget)
  if (fitted.truncated) ctx.logger.warn('guidelines.truncated', { lang, budget })
  return fitted.text
}

async function runTarget(
  job: TranslationJob,
  target: Target,
  materials: JobMaterials,
  ctx: StageContext,
): Promise<TargetResult> {
  const protectedSource = protectPlaceholders(job.sourceText)
  const chunks = chunkText(protectedSource.text, job.options.maxTokensPerChunk)
  ctx.events.emit({ type: 'target-started', lang: target.lang, chunkCount: chunks.length })

  const sources = activeContextSources(materials.sources, target.lang)
  const context = buildContextBlock(sources, job.options.contextTokenBudget, ctx.logger)
  const sets = activeGuidelineSets(materials.guidelineSets, target.lang)
  const guidelinesBlock = guidelinesBlockFor(
    sets,
    job.options.guidelinesTokenBudget,
    ctx,
    target.lang,
  )
  ctx.logger.info('target.start', {
    lang: target.lang,
    chunks: chunks.length,
    model: job.models.translatorA,
    contextSources: sources.length,
    contextTokens: context.tokens,
    guidelineSets: sets.length,
  })

  const outputs = await Promise.all(
    chunks.map((chunk) =>
      translateChunk(
        {
          lang: target.lang,
          role: 'translatorA',
          model: job.models.translatorA,
          chunk,
          prompt: {
            sourceLang: sourceLabel(job),
            target,
            options: job.options,
            fullText: protectedSource.text,
            isMultiChunk: chunks.length > 1,
            ...(context.block ? { contextBlock: context.block } : {}),
            ...(guidelinesBlock ? { guidelinesBlock } : {}),
          },
        },
        ctx,
      ),
    ),
  )

  const candidates: Candidate[] = outputs.map((o) => o.candidate)
  const trace: TraceEvent[] = outputs.map((o) => o.trace)
  const joined = candidates.map((c) => c.text).join(chunks.length > 1 ? '\n\n' : '')
  const parity = placeholderParity(protectedSource.text, joined)
  if (parity.missing.length > 0 || parity.extra.length > 0) {
    ctx.logger.warn('target.placeholderMismatch', { lang: target.lang, ...parity })
  }
  const finalText = restorePlaceholders(joined, protectedSource.placeholders)
  const guidelineReport = checkGuidelines(finalText, sets, job.sourceText)
  if (guidelineReport.length > 0) {
    ctx.logger.warn('target.guidelineViolations', {
      lang: target.lang,
      count: guidelineReport.length,
    })
  }
  const cost = candidates.reduce<CostSummary>((acc, c) => addUsage(acc, c.usage), emptyCost())
  return {
    jobId: job.id,
    lang: target.lang,
    chunks,
    candidates,
    finalText,
    guidelineReport,
    cost,
    trace,
    status: 'done',
  }
}

export function createEngine(ports: EnginePorts): Engine {
  return {
    run(job, opts) {
      const events = createEventQueue()
      const ctx: StageContext = {
        llm: ports.llm,
        clock: ports.clock,
        logger: ports.logger,
        events,
        ...(opts?.signal ? { signal: opts.signal } : {}),
      }

      const prepare = async (): Promise<{ materials: JobMaterials; cost: CostSummary }> => {
        const [rawSources, guidelineSets] = await Promise.all([
          loadByIds(ports.storage.contexts, job.options.contextSourceIds),
          loadByIds(ports.storage.guidelines, job.options.guidelineSetIds),
        ])
        events.emit({ type: 'stage-started', lang: '*', stage: 'context', chunkIndex: null })
        const { sources, usages } = await ensureDigests(
          rawSources.filter((s) => s.enabled),
          {
            budgetPerSource: job.options.contextTokenBudget,
            llm: ports.llm,
            model: job.models.helper,
            storage: ports.storage,
            logger: ports.logger,
            ...(opts?.signal ? { signal: opts.signal } : {}),
          },
        )
        const cost = usages.reduce<CostSummary>((acc, u) => addUsage(acc, u), emptyCost())
        events.emit({
          type: 'stage-done',
          lang: '*',
          stage: 'context',
          chunkIndex: null,
          usage: {
            promptTokens: cost.tokensIn,
            completionTokens: cost.tokensOut,
            costUsd: cost.usd,
          },
        })
        return { materials: { sources, guidelineSets }, cost }
      }

      const execute = async (): Promise<void> => {
        events.emit({ type: 'job-started', jobId: job.id, targets: job.targets })
        await ports.storage.jobs.put({ ...job, status: 'running' })
        let prepared: { materials: JobMaterials; cost: CostSummary }
        try {
          prepared = await prepare()
        } catch (error) {
          ports.logger.error('job.prepareFailed', { error: errorMessage(error) })
          await ports.storage.jobs.put({ ...job, status: isAbort(error) ? 'cancelled' : 'failed' })
          for (const t of job.targets)
            events.emit({ type: 'target-failed', lang: t.lang, error: errorMessage(error) })
          events.emit({ type: 'job-done', jobId: job.id, cost: emptyCost() })
          return
        }
        const results = await Promise.all(
          job.targets.map(async (target): Promise<TargetResult | null> => {
            try {
              const result = await runTarget(job, target, prepared.materials, ctx)
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
        events.emit({
          type: 'job-done',
          jobId: job.id,
          cost: sumCosts([prepared.cost, ...done.map((r) => r.cost)]),
        })
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
      const callCount = chunkCount * job.targets.length
      const contextTokens = sources
        .filter((s) => s.enabled && job.options.contextSourceIds.includes(s.id))
        .reduce(
          (acc, s) => acc + Math.min(countTokens(s.rawText), job.options.contextTokenBudget),
          0,
        )
      const pricing = findPricing(models, job.models.translatorA)
      const perCallPrompt = (chunkCount > 1 ? sourceTokens : sourceTokens) + contextTokens + 200
      const estimatedUsd = pricing
        ? usageCost(
            { promptTokens: perCallPrompt * chunkCount, completionTokens: sourceTokens * 1.2 },
            pricing,
          ) * job.targets.length
        : null
      return { sourceTokens, contextTokens, chunkCount, callCount, estimatedUsd }
    },
  }
}
