import { emptyCost, findPricing, sumCosts, usageCost } from './llm/pricing.ts'
import { createEventQueue } from './pipeline/eventQueue.ts'
import { type StageContext, translateChunk } from './pipeline/stages/translate.ts'
import type { EnginePorts } from './ports.ts'
import { chunkText } from './text/chunk.ts'
import { placeholderParity, protectPlaceholders, restorePlaceholders } from './text/placeholders.ts'
import { countTokens } from './text/tokens.ts'
import type {
  Candidate,
  CostSummary,
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
  estimate(job: TranslationJob, models: ModelInfo[]): JobEstimate
}

const sourceLabel = (job: TranslationJob): string =>
  job.sourceLang === AUTO_LANG ? 'the source language (detect it yourself)' : job.sourceLang

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const isAbort = (error: unknown): boolean =>
  error instanceof DOMException && error.name === 'AbortError'

async function runTarget(
  job: TranslationJob,
  target: Target,
  ctx: StageContext,
): Promise<TargetResult> {
  const protectedSource = protectPlaceholders(job.sourceText)
  const chunks = chunkText(protectedSource.text, job.options.maxTokensPerChunk)
  ctx.events.emit({ type: 'target-started', lang: target.lang, chunkCount: chunks.length })
  ctx.logger.info('target.start', {
    lang: target.lang,
    chunks: chunks.length,
    model: job.models.translatorA,
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
  const cost = candidates.reduce<CostSummary>(
    (acc, c) => ({
      usd: acc.usd + (c.usage.costUsd ?? 0),
      tokensIn: acc.tokensIn + c.usage.promptTokens,
      tokensOut: acc.tokensOut + c.usage.completionTokens,
      calls: acc.calls + 1,
    }),
    emptyCost(),
  )
  return {
    jobId: job.id,
    lang: target.lang,
    chunks,
    candidates,
    finalText,
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

      const execute = async (): Promise<void> => {
        events.emit({ type: 'job-started', jobId: job.id, targets: job.targets })
        await ports.storage.jobs.put({ ...job, status: 'running' })
        const results = await Promise.all(
          job.targets.map(async (target): Promise<TargetResult | null> => {
            try {
              const result = await runTarget(job, target, ctx)
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
        events.emit({ type: 'job-done', jobId: job.id, cost: sumCosts(done.map((r) => r.cost)) })
      }

      execute().then(
        () => events.close(),
        (error: unknown) => events.fail(error),
      )
      return events
    },

    estimate(job, models) {
      const sourceTokens = countTokens(job.sourceText)
      const chunkCount = chunkText(job.sourceText, job.options.maxTokensPerChunk).length
      const callCount = chunkCount * job.targets.length
      const pricing = findPricing(models, job.models.translatorA)
      const contextTokens = chunkCount > 1 ? sourceTokens * chunkCount : sourceTokens
      const estimatedUsd = pricing
        ? usageCost(
            {
              promptTokens: contextTokens + 200 * chunkCount,
              completionTokens: sourceTokens * 1.2,
            },
            pricing,
          ) * job.targets.length
        : null
      return { sourceTokens, chunkCount, callCount, estimatedUsd }
    },
  }
}
