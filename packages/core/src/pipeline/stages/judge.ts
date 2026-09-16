import { buildJudgePrompt, type JudgePromptInput } from '../../prompts/judge.ts'
import { judgmentSchema } from '../../schemas/pipeline.ts'
import type { Judgment } from '../../types.ts'
import { callRoleJson, type StageContext } from '../call.ts'

export async function judgeChunk(
  input: JudgePromptInput & { lang: string; targetKey: string; model: string; chunkIndex: number },
  ctx: StageContext,
): Promise<Judgment> {
  const { value } = await callRoleJson(
    {
      lang: input.lang,
      targetKey: input.targetKey,
      stage: 'judge',
      role: 'judge',
      model: input.model,
      chunkIndex: input.chunkIndex,
      prompt: buildJudgePrompt(input),
      temperature: 0,
    },
    judgmentSchema,
    ctx,
  )
  const known = new Set(input.candidates.map((c) => c.role))
  const winner =
    value.winner === 'merge'
      ? value.mergedText
        ? 'merge'
        : 'translatorA'
      : known.has(value.winner)
        ? value.winner
        : 'translatorA'
  return {
    chunkIndex: input.chunkIndex,
    model: input.model,
    winner,
    rationale: value.rationale,
    ...(winner === 'merge' && value.mergedText ? { mergedText: value.mergedText } : {}),
  }
}
