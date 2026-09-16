import { buildReviewPrompt, type ReviewPromptInput } from '../../prompts/review.ts'
import { type ReviewOutput, reviewSchema } from '../../schemas/pipeline.ts'
import type { Issue, Review } from '../../types.ts'
import { callRoleJson, type StageContext } from '../call.ts'

const toIssue = (i: ReviewOutput['issues'][number]): Issue => ({
  candidate: i.candidate,
  category: i.category,
  severity: i.severity,
  explanation: i.explanation,
  ...(i.sourceSpan ? { sourceSpan: i.sourceSpan } : {}),
  ...(i.targetSpan ? { targetSpan: i.targetSpan } : {}),
  ...(i.fix ? { fix: i.fix } : {}),
})

export async function reviewChunk(
  input: ReviewPromptInput & { lang: string; targetKey: string; model: string; chunkIndex: number },
  ctx: StageContext,
): Promise<Review> {
  const { value } = await callRoleJson(
    {
      lang: input.lang,
      targetKey: input.targetKey,
      stage: 'review',
      role: 'reviewer',
      model: input.model,
      chunkIndex: input.chunkIndex,
      prompt: buildReviewPrompt(input),
      temperature: 0,
    },
    reviewSchema,
    ctx,
  )
  const known = new Set(input.candidates.map((c) => c.role))
  return {
    chunkIndex: input.chunkIndex,
    model: input.model,
    issues: value.issues.filter((i) => known.has(i.candidate)).map(toIssue),
    suggestions: value.suggestions,
    preferred: value.preferred && known.has(value.preferred) ? value.preferred : null,
  }
}
