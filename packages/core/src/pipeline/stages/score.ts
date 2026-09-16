import { buildScorePrompt, type ScorePromptInput } from '../../prompts/score.ts'
import { scoreSchema } from '../../schemas/pipeline.ts'
import { buildQualityScore } from '../../scoring/confidence.ts'
import type { Candidate, Issue, QualityScore } from '../../types.ts'
import { callRoleJson, type StageContext } from '../call.ts'

export async function scoreTarget(
  input: ScorePromptInput & {
    lang: string
    targetKey: string
    model: string
    candidates: Candidate[]
    unresolved: Issue[]
  },
  ctx: StageContext,
): Promise<QualityScore> {
  const { value } = await callRoleJson(
    {
      lang: input.lang,
      targetKey: input.targetKey,
      stage: 'score',
      role: 'scorer',
      model: input.model,
      chunkIndex: null,
      prompt: buildScorePrompt(input),
      temperature: 0,
    },
    scoreSchema,
    ctx,
  )
  return buildQualityScore(value, input.candidates, input.unresolved)
}
