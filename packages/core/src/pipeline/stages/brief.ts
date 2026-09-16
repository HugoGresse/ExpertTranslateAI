import { type BriefPromptInput, buildBriefPrompt } from '../../prompts/brief.ts'
import { briefSchema } from '../../schemas/pipeline.ts'
import type { Brief } from '../../types.ts'
import { callRoleJson, type StageContext } from '../call.ts'

export async function runBrief(
  input: BriefPromptInput & { model: string },
  ctx: StageContext,
): Promise<Brief> {
  const { value } = await callRoleJson(
    {
      lang: '*',
      stage: 'brief',
      role: 'helper',
      model: input.model,
      chunkIndex: null,
      prompt: buildBriefPrompt(input),
      temperature: 0,
    },
    briefSchema,
    ctx,
  )
  ctx.logger.info('brief.done', {
    domain: value.domain,
    difficulty: value.difficulty,
    lang: value.detectedLang,
  })
  return value
}
