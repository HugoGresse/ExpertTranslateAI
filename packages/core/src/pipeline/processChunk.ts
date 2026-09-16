import { checkTerminology } from '../glossary/check.ts'
import { detectDisagreements } from '../scoring/disagreement.ts'
import type {
  Candidate,
  Chunk,
  Disagreement,
  GuidelineViolation,
  Issue,
  Judgment,
  Review,
  RoleModels,
  TranslationJob,
  TranslatorRole,
} from '../types.ts'
import type { StageContext } from './call.ts'
import type { Plan } from './plan.ts'
import type { TargetSetup } from './setupTarget.ts'
import { finalizeChunk } from './stages/finalize.ts'
import { checkChunkGuidelines } from './stages/guidelineCheck.ts'
import { judgeChunk } from './stages/judge.ts'
import { reviewChunk } from './stages/review.ts'
import { translateChunk } from './stages/translate.ts'
import { degrade, termAsGuideline } from './violations.ts'

export interface ChunkOutcome {
  candidates: Candidate[]
  review: Review | null
  judgment: Judgment | null
  violations: GuidelineViolation[]
  disagreements: Disagreement[]
  finalText: string
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

export async function processChunk(
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

  const disagreements = detectDisagreements(candidates, chunk.index, setup.glossaryTerms)
  if (disagreements.length > 0)
    ctx.logger.debug('chunk.disagreements', {
      lang: setup.lang,
      chunk: chunk.index,
      count: disagreements.length,
      high: disagreements.filter((d) => d.severity === 'high').length,
    })
  const [review, violations] = await Promise.all([
    plan.review
      ? reviewChunk({ ...common, model: models.reviewer, disagreements }, ctx).catch(
          (error: unknown) => degrade(error, 'review', setup.lang, ctx, null),
        )
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
    checkTerminology(chunk.text, c.text, setup.glossary).map(termAsGuideline),
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
