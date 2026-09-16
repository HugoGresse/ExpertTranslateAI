import { checkTerminology } from '../glossary/check.ts'
import { checkGuidelines } from '../guidelines/check.ts'
import { placeholderParity, restorePlaceholders } from '../text/placeholders.ts'
import type {
  GuidelineViolation,
  QualityScore,
  RoleModels,
  TermViolation,
  TranslationJob,
} from '../types.ts'
import type { StageContext } from './call.ts'
import type { Plan } from './plan.ts'
import type { ChunkOutcome } from './processChunk.ts'
import type { TargetSetup } from './setupTarget.ts'
import { scoreTarget } from './stages/score.ts'
import { degrade, termAsGuideline, violationAsIssue } from './violations.ts'

export interface Evaluation {
  joined: string
  finalText: string
  regexReport: GuidelineViolation[]
  terminologyReport: TermViolation[]
  score: QualityScore | null
}

export function assembleOutcomes(
  setup: TargetSetup,
  outcomes: ChunkOutcome[],
): { joined: string; finalText: string } {
  const joined = outcomes.map((o) => o.finalText).join(setup.chunks.length > 1 ? '\n\n' : '')
  return { joined, finalText: restorePlaceholders(joined, setup.placeholders) }
}

export async function evaluateOutcomes(
  job: TranslationJob,
  plan: Plan,
  setup: TargetSetup,
  models: RoleModels,
  outcomes: ChunkOutcome[],
  ctx: StageContext,
): Promise<Evaluation> {
  const { joined, finalText } = assembleOutcomes(setup, outcomes)
  const parity = placeholderParity(setup.protectedText, joined)
  if (parity.missing.length > 0 || parity.extra.length > 0)
    ctx.logger.warn('target.placeholderMismatch', { lang: setup.lang, ...parity })
  const regexReport = checkGuidelines(finalText, setup.sets, job.sourceText)
  const terminologyReport = checkTerminology(setup.protectedText, joined, setup.glossary)
  if (regexReport.length > 0)
    ctx.logger.warn('target.guidelineViolations', { lang: setup.lang, count: regexReport.length })
  if (terminologyReport.length > 0)
    ctx.logger.warn('target.terminologyViolations', {
      lang: setup.lang,
      count: terminologyReport.length,
    })
  const score = plan.score
    ? await scoreTarget(
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
            ...terminologyReport.map((v) => violationAsIssue(termAsGuideline(v))),
          ],
        },
        ctx,
      ).catch((error: unknown) => degrade(error, 'score', setup.lang, ctx, null))
    : null
  return { joined, finalText, regexReport, terminologyReport, score }
}
