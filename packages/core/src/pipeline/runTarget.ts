import { activeContextSources, buildContextBlock, truncateToTokens } from '../context/prepare.ts'
import { checkGuidelines } from '../guidelines/check.ts'
import {
  activeGuidelineSets,
  formatGuidelinesBlock,
  type NumberedRule,
  numberRules,
} from '../guidelines/format.ts'
import { addUsage, emptyCost } from '../llm/pricing.ts'
import type { PromptMaterials } from '../prompts/materials.ts'
import { chunkText } from '../text/chunk.ts'
import {
  placeholderParity,
  protectPlaceholders,
  restorePlaceholders,
} from '../text/placeholders.ts'
import type {
  Brief,
  Candidate,
  Chunk,
  ContextSource,
  CostSummary,
  GuidelineSet,
  GuidelineViolation,
  Issue,
  Judgment,
  Review,
  Target,
  TargetResult,
  TranslationJob,
  TranslatorRole,
} from '../types.ts'
import { AUTO_LANG } from '../types.ts'
import type { StageContext } from './call.ts'
import type { Plan } from './plan.ts'
import { finalizeChunk } from './stages/finalize.ts'
import { checkChunkGuidelines } from './stages/guidelineCheck.ts'
import { judgeChunk } from './stages/judge.ts'
import { reviewChunk } from './stages/review.ts'
import { scoreTarget } from './stages/score.ts'
import { translateChunk } from './stages/translate.ts'

export interface JobMaterials {
  sources: ContextSource[]
  guidelineSets: GuidelineSet[]
  brief: Brief | null
}

interface TargetSetup {
  lang: string
  target: Target
  targetLabel: string
  sourceLang: string
  materials: PromptMaterials
  sets: GuidelineSet[]
  rules: NumberedRule[]
  protectedText: string
  chunks: Chunk[]
}

interface ChunkOutcome {
  candidates: Candidate[]
  review: Review | null
  judgment: Judgment | null
  violations: GuidelineViolation[]
  finalText: string
}

const sourceLabel = (job: TranslationJob, brief: Brief | null): string =>
  job.sourceLang !== AUTO_LANG
    ? job.sourceLang
    : (brief?.detectedLang ?? 'the source language (detect it yourself)')

const targetLabelOf = (t: Target): string =>
  t.region ? `${t.lang} as spoken in ${t.region}` : t.lang

function setupTarget(
  job: TranslationJob,
  target: Target,
  materials: JobMaterials,
  ctx: StageContext,
): TargetSetup {
  const protectedSource = protectPlaceholders(job.sourceText)
  const chunks = chunkText(protectedSource.text, job.options.maxTokensPerChunk)
  const sources = activeContextSources(materials.sources, target.lang)
  const context = buildContextBlock(sources, job.options.contextTokenBudget, ctx.logger)
  const sets = activeGuidelineSets(materials.guidelineSets, target.lang)
  const guidelines = truncateToTokens(
    formatGuidelinesBlock(sets),
    job.options.guidelinesTokenBudget,
  )
  if (guidelines.truncated) ctx.logger.warn('guidelines.truncated', { lang: target.lang })
  ctx.logger.info('target.start', {
    lang: target.lang,
    chunks: chunks.length,
    contextSources: sources.length,
    contextTokens: context.tokens,
    guidelineSets: sets.length,
  })
  return {
    lang: target.lang,
    target,
    targetLabel: targetLabelOf(target),
    sourceLang: sourceLabel(job, materials.brief),
    materials: {
      brief: materials.brief,
      ...(context.block ? { contextBlock: context.block } : {}),
      ...(guidelines.text ? { guidelinesBlock: guidelines.text } : {}),
    },
    sets,
    rules: numberRules(sets),
    protectedText: protectedSource.text,
    chunks,
  }
}

function pickBase(
  candidates: Candidate[],
  review: Review | null,
  judgment: Judgment | null,
): { role: TranslatorRole | 'merge'; text: string } {
  if (judgment?.winner === 'merge' && judgment.mergedText)
    return { role: 'merge', text: judgment.mergedText }
  const preferred = judgment && judgment.winner !== 'merge' ? judgment.winner : review?.preferred
  const chosen = candidates.find((c) => c.role === preferred) ?? candidates[0]
  if (!chosen) throw new Error('No candidate translation produced')
  return { role: chosen.role, text: chosen.text }
}

async function processChunk(
  job: TranslationJob,
  plan: Plan,
  setup: TargetSetup,
  chunk: Chunk,
  ctx: StageContext,
): Promise<ChunkOutcome> {
  const candidates = await Promise.all(
    plan.translators.map((role) =>
      translateChunk(
        {
          lang: setup.lang,
          role,
          model: job.models[role],
          chunk,
          prompt: {
            sourceLang: setup.sourceLang,
            target: setup.target,
            options: job.options,
            fullText: setup.protectedText,
            isMultiChunk: setup.chunks.length > 1,
            materials: setup.materials,
          },
        },
        ctx,
      ),
    ),
  )
  const common = {
    lang: setup.lang,
    chunkIndex: chunk.index,
    sourceLang: setup.sourceLang,
    targetLabel: setup.targetLabel,
    sourceChunk: chunk.text,
    candidates,
    materials: setup.materials,
  }

  const [review, violations] = await Promise.all([
    plan.review
      ? reviewChunk({ ...common, model: job.models.reviewer }, ctx)
      : Promise.resolve(null),
    plan.guidelineCheck && setup.materials.guidelinesBlock
      ? checkChunkGuidelines(
          {
            ...common,
            model: job.models.reviewer,
            guidelinesBlock: setup.materials.guidelinesBlock,
            rules: setup.rules,
          },
          ctx,
        )
      : Promise.resolve([]),
  ])
  const issues: Issue[] = review?.issues ?? []
  const judgment = plan.judge
    ? await judgeChunk({ ...common, model: job.models.judge, issues, violations }, ctx)
    : null
  const base = pickBase(candidates, review, judgment)
  const finalText = plan.finalize
    ? await finalizeChunk(
        {
          ...common,
          model: job.models.finalizer,
          base,
          issues,
          violations,
          suggestions: review?.suggestions ?? [],
          judgment,
          preserveFormatting: job.options.preserveFormatting,
        },
        ctx,
      )
    : base.text
  return { candidates, review, judgment, violations, finalText }
}

export async function runTarget(
  job: TranslationJob,
  plan: Plan,
  target: Target,
  materials: JobMaterials,
  ctx: StageContext,
): Promise<TargetResult> {
  const setup = setupTarget(job, target, materials, ctx)
  ctx.events.emit({ type: 'target-started', lang: target.lang, chunkCount: setup.chunks.length })
  const protectedSource = protectPlaceholders(job.sourceText)

  const outcomes = await Promise.all(
    setup.chunks.map((chunk) => processChunk(job, plan, setup, chunk, ctx)),
  )
  const candidates = outcomes.flatMap((o) => o.candidates)
  const reviews = outcomes.flatMap((o) => (o.review ? [o.review] : []))
  const judgments = outcomes.flatMap((o) => (o.judgment ? [o.judgment] : []))
  const joined = outcomes.map((o) => o.finalText).join(setup.chunks.length > 1 ? '\n\n' : '')
  const parity = placeholderParity(setup.protectedText, joined)
  if (parity.missing.length > 0 || parity.extra.length > 0)
    ctx.logger.warn('target.placeholderMismatch', { lang: target.lang, ...parity })
  const finalText = restorePlaceholders(joined, protectedSource.placeholders)

  const regexReport = checkGuidelines(finalText, setup.sets, job.sourceText)
  const unresolved: Issue[] = reviews
    .flatMap((r) => r.issues)
    .filter((i) => i.severity === 'critical' && !plan.finalize)
  const score = plan.score
    ? await scoreTarget(
        {
          lang: target.lang,
          model: job.models.scorer,
          sourceLang: setup.sourceLang,
          targetLabel: setup.targetLabel,
          sourceText: job.sourceText,
          finalText,
          materials: setup.materials,
          candidates,
          unresolved: [...unresolved, ...regexReport.map(violationAsIssue)],
        },
        ctx,
      )
    : null
  if (regexReport.length > 0)
    ctx.logger.warn('target.guidelineViolations', { lang: target.lang, count: regexReport.length })

  const cost = ctx.trace
    .filter((t) => t.lang === target.lang)
    .reduce<CostSummary>((acc, t) => addUsage(acc, t.usage), emptyCost())
  return {
    jobId: job.id,
    lang: target.lang,
    chunks: setup.chunks,
    candidates,
    finalText,
    brief: materials.brief,
    plan: { difficulty: plan.difficulty, translators: plan.translators },
    reviews,
    judgments,
    score,
    guidelineReport: regexReport,
    cost,
    trace: ctx.trace.filter((t) => t.lang === target.lang || t.lang === '*'),
    status: 'done',
  }
}

const violationAsIssue = (v: GuidelineViolation): Issue => ({
  candidate: 'translatorA',
  category: 'guideline',
  severity: v.severity,
  explanation: v.explanation,
  ...(v.targetSpan ? { targetSpan: v.targetSpan } : {}),
})
