import { activeContextSources, buildContextBlock, truncateToTokens } from '../context/prepare.ts'
import { checkTerminology } from '../glossary/check.ts'
import { formatGlossaryBlock } from '../glossary/format.ts'
import { resolveGlossary } from '../glossary/resolve.ts'
import { checkGuidelines } from '../guidelines/check.ts'
import {
  activeGuidelineSets,
  formatGuidelinesBlock,
  type NumberedRule,
  numberRules,
} from '../guidelines/format.ts'
import { addUsage, emptyCost } from '../llm/pricing.ts'
import type { PromptMaterials } from '../prompts/materials.ts'
import { detectDisagreements } from '../scoring/disagreement.ts'
import { chunkText } from '../text/chunk.ts'
import {
  placeholderParity,
  protectPlaceholders,
  restorePlaceholders,
} from '../text/placeholders.ts'
import { formatMemoryBlock, matchMemory } from '../tm/match.ts'
import type {
  Brief,
  Candidate,
  Chunk,
  ContextSource,
  CostSummary,
  Disagreement,
  Escalation,
  GlossaryEntry,
  GlossaryScope,
  GuidelineSet,
  GuidelineViolation,
  Issue,
  Judgment,
  MemoryHit,
  QualityScore,
  Review,
  RoleModels,
  Target,
  TargetResult,
  TermViolation,
  TmEntry,
  TraceEvent,
  TranslationJob,
  TranslatorRole,
} from '../types.ts'
import { AUTO_LANG } from '../types.ts'
import type { StageContext } from './call.ts'
import { decideEscalation, nextDifficulty } from './escalation.ts'
import { type Plan, planFor } from './plan.ts'
import { finalizeChunk } from './stages/finalize.ts'
import { checkChunkGuidelines } from './stages/guidelineCheck.ts'
import { judgeChunk } from './stages/judge.ts'
import { reviewChunk } from './stages/review.ts'
import { scoreTarget } from './stages/score.ts'
import { translateChunk } from './stages/translate.ts'

export interface JobMaterials {
  sources: ContextSource[]
  guidelineSets: GuidelineSet[]
  glossaryScopes: GlossaryScope[]
  glossaryEntries: GlossaryEntry[]
  memory: TmEntry[]
  brief: Brief | null
  trace: TraceEvent[]
  models: RoleModels
}

interface TargetSetup {
  lang: string
  target: Target
  targetLabel: string
  sourceLang: string
  materials: PromptMaterials
  sets: GuidelineSet[]
  rules: NumberedRule[]
  glossary: GlossaryEntry[]
  memoryHits: MemoryHit[]
  protectedText: string
  chunks: Chunk[]
}

interface ChunkOutcome {
  candidates: Candidate[]
  review: Review | null
  judgment: Judgment | null
  violations: GuidelineViolation[]
  disagreements: Disagreement[]
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
  const glossary = resolveGlossary(
    materials.glossaryScopes,
    materials.glossaryEntries,
    job.options.glossaryScopeIds,
    target.lang,
  )
  const memorySourceLang =
    job.sourceLang !== AUTO_LANG ? job.sourceLang : (materials.brief?.detectedLang ?? null)
  const memory = job.options.useMemory
    ? matchMemory(job.sourceText, materials.memory, memorySourceLang, target.lang)
    : { exact: [], fuzzy: [] }
  const glossaryBlock = formatGlossaryBlock(glossary)
  const memoryBlock = formatMemoryBlock(memory)
  ctx.logger.info('target.start', {
    lang: target.lang,
    chunks: chunks.length,
    contextSources: sources.length,
    contextTokens: context.tokens,
    guidelineSets: sets.length,
    glossaryEntries: glossary.length,
    memoryExact: memory.exact.length,
    memoryFuzzy: memory.fuzzy.length,
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
      ...(glossaryBlock ? { glossaryBlock } : {}),
      ...(memoryBlock ? { memoryBlock } : {}),
    },
    sets,
    rules: numberRules(sets),
    glossary,
    memoryHits: [...memory.exact, ...memory.fuzzy],
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
  models: RoleModels,
  chunk: Chunk,
  ctx: StageContext,
): Promise<ChunkOutcome> {
  const candidates = await Promise.all(
    plan.translators.map((role) =>
      translateChunk(
        {
          lang: setup.lang,
          role,
          model: models[role],
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

  const disagreements = detectDisagreements(
    candidates,
    chunk.index,
    setup.glossary.map((g) => g.source),
  )
  if (disagreements.length > 0)
    ctx.logger.debug('chunk.disagreements', {
      lang: setup.lang,
      chunk: chunk.index,
      count: disagreements.length,
      high: disagreements.filter((d) => d.severity === 'high').length,
    })
  const [review, violations] = await Promise.all([
    plan.review
      ? reviewChunk({ ...common, model: models.reviewer, disagreements }, ctx)
      : Promise.resolve(null),
    plan.guidelineCheck && setup.materials.guidelinesBlock
      ? checkChunkGuidelines(
          {
            ...common,
            model: models.reviewer,
            guidelinesBlock: setup.materials.guidelinesBlock,
            rules: setup.rules,
          },
          ctx,
        ).catch((error: unknown) => degrade(error, 'guidelines', setup.lang, ctx, []))
      : Promise.resolve([]),
  ])
  const issues: Issue[] = review?.issues ?? []
  const termViolations = candidates.flatMap((c) =>
    checkTerminology(chunk.text, c.text, setup.glossary).map((v) => termAsGuideline(v, c.role)),
  )
  const allViolations = [...violations, ...termViolations]
  const judgment = plan.judge
    ? await judgeChunk({ ...common, model: models.judge, issues, violations: allViolations }, ctx)
    : null
  const base = pickBase(candidates, review, judgment)
  const finalText = plan.finalize
    ? await finalizeChunk(
        {
          ...common,
          model: models.finalizer,
          base,
          issues,
          violations: allViolations,
          suggestions: review?.suggestions ?? [],
          judgment,
          preserveFormatting: job.options.preserveFormatting,
        },
        ctx,
      )
    : base.text
  return { candidates, review, judgment, violations, disagreements, finalText }
}

export async function runTarget(
  job: TranslationJob,
  plan: Plan,
  target: Target,
  materials: JobMaterials,
  ctx: StageContext,
): Promise<TargetResult> {
  const setup = setupTarget(job, target, materials, ctx)
  const protectedSource = protectPlaceholders(job.sourceText)
  const placeholders = Object.fromEntries(protectedSource.placeholders)
  ctx.events.emit({
    type: 'target-started',
    lang: target.lang,
    chunkCount: setup.chunks.length,
    placeholders,
  })

  const models = materials.models
  let outcomes = await Promise.all(
    setup.chunks.map((chunk) => processChunk(job, plan, setup, models, chunk, ctx)),
  )
  const assemble = (list: ChunkOutcome[]): string => {
    const joined = list.map((o) => o.finalText).join(setup.chunks.length > 1 ? '\n\n' : '')
    return restorePlaceholders(joined, protectedSource.placeholders)
  }
  const escalations: Escalation[] = []
  const firstScore = plan.score
    ? await scoreFor(job, plan, setup, models, outcomes, assemble(outcomes), ctx)
    : null
  const decision = job.options.autoEscalate
    ? decideEscalation({
        difficulty: plan.difficulty,
        chunkCount: setup.chunks.length,
        disagreements: outcomes.flatMap((o) => o.disagreements),
        score: firstScore,
        confidenceThreshold: job.options.escalationConfidence,
        violations: [
          ...checkGuidelines(assemble(outcomes), setup.sets, job.sourceText),
          ...checkTerminology(job.sourceText, assemble(outcomes), setup.glossary),
        ],
      })
    : null
  let effectivePlan = plan
  if (decision) {
    const to = nextDifficulty(plan.difficulty)
    if (to) {
      effectivePlan = planFor(to)
      ctx.logger.info('target.escalate', {
        lang: target.lang,
        from: plan.difficulty,
        to,
        chunks: decision.chunks,
        reason: decision.reason,
      })
      for (const chunkIndex of decision.chunks) {
        escalations.push({ chunkIndex, from: plan.difficulty, to, reason: decision.reason })
        ctx.events.emit({
          type: 'escalated',
          lang: target.lang,
          chunkIndex,
          from: plan.difficulty,
          to,
          reason: decision.reason,
        })
      }
      const rerun = await Promise.all(
        decision.chunks.map(async (chunkIndex) => {
          const chunk = setup.chunks[chunkIndex]
          if (!chunk) throw new Error(`Unknown chunk ${chunkIndex}`)
          return [
            chunkIndex,
            await processChunk(job, effectivePlan, setup, models, chunk, ctx),
          ] as const
        }),
      )
      const byIndex = new Map(rerun)
      outcomes = outcomes.map((o, i) => byIndex.get(i) ?? o)
    }
  }
  const candidates = outcomes.flatMap((o) => o.candidates)
  const reviews = outcomes.flatMap((o) => (o.review ? [o.review] : []))
  const judgments = outcomes.flatMap((o) => (o.judgment ? [o.judgment] : []))
  const joined = outcomes.map((o) => o.finalText).join(setup.chunks.length > 1 ? '\n\n' : '')
  const parity = placeholderParity(setup.protectedText, joined)
  if (parity.missing.length > 0 || parity.extra.length > 0)
    ctx.logger.warn('target.placeholderMismatch', { lang: target.lang, ...parity })
  const finalText = assemble(outcomes)

  const regexReport = checkGuidelines(finalText, setup.sets, job.sourceText)
  const terminologyReport = checkTerminology(job.sourceText, finalText, setup.glossary)
  if (terminologyReport.length > 0)
    ctx.logger.warn('target.terminologyViolations', {
      lang: target.lang,
      count: terminologyReport.length,
    })
  const score =
    escalations.length > 0 && effectivePlan.score
      ? await scoreFor(job, effectivePlan, setup, models, outcomes, finalText, ctx)
      : firstScore
  if (regexReport.length > 0)
    ctx.logger.warn('target.guidelineViolations', { lang: target.lang, count: regexReport.length })

  const cost = ctx.trace.reduce<CostSummary>((acc, t) => addUsage(acc, t.usage), emptyCost())
  return {
    jobId: job.id,
    lang: target.lang,
    chunks: setup.chunks,
    placeholders,
    candidates,
    finalText,
    brief: materials.brief,
    plan: { difficulty: effectivePlan.difficulty, translators: effectivePlan.translators },
    reviews,
    judgments,
    score,
    guidelineReport: regexReport,
    terminologyReport,
    memoryHits: setup.memoryHits,
    disagreements: outcomes.flatMap((o) => o.disagreements),
    escalations,
    cost,
    trace: [...materials.trace, ...ctx.trace],
    status: 'done',
  }
}

async function scoreFor(
  job: TranslationJob,
  plan: Plan,
  setup: TargetSetup,
  models: RoleModels,
  outcomes: ChunkOutcome[],
  finalText: string,
  ctx: StageContext,
): Promise<QualityScore | null> {
  if (!plan.score) return null
  const regexReport = checkGuidelines(finalText, setup.sets, job.sourceText)
  const terminologyReport = checkTerminology(job.sourceText, finalText, setup.glossary)
  return scoreTarget(
    {
      lang: setup.lang,
      model: models.scorer,
      sourceLang: setup.sourceLang,
      targetLabel: setup.targetLabel,
      sourceText: job.sourceText,
      finalText,
      materials: setup.materials,
      candidates: outcomes.flatMap((o) => o.candidates),
      unresolved: [
        ...regexReport.map(violationAsIssue),
        ...terminologyReport.map((v) => violationAsIssue(termAsGuideline(v, 'translatorA'))),
      ],
    },
    ctx,
  ).catch((error: unknown) => degrade(error, 'score', setup.lang, ctx, null))
}

function degrade<T>(
  error: unknown,
  stage: string,
  lang: string,
  ctx: StageContext,
  fallback: T,
): T {
  if (error instanceof DOMException && error.name === 'AbortError') throw error
  ctx.logger.warn('stage.degraded', {
    stage,
    lang,
    error: error instanceof Error ? error.message : String(error),
  })
  return fallback
}

const termAsGuideline = (v: TermViolation, _role: TranslatorRole): GuidelineViolation => ({
  ruleId: `glossary:${v.entryId}`,
  ruleText: `Glossary: "${v.source}" → ${v.expected}`,
  severity: v.severity,
  explanation: v.explanation,
  ...(v.found ? { targetSpan: v.found } : {}),
})

const violationAsIssue = (v: GuidelineViolation): Issue => ({
  candidate: 'translatorA',
  category: 'guideline',
  severity: v.severity,
  explanation: v.explanation,
  ...(v.targetSpan ? { targetSpan: v.targetSpan } : {}),
})
