import { buildFinalizePrompt, type FinalizePromptInput } from '../../prompts/finalize.ts'
import { callRole, type StageContext } from '../call.ts'

export async function finalizeChunk(
  input: FinalizePromptInput & {
    lang: string
    targetKey: string
    model: string
    chunkIndex: number
  },
  ctx: StageContext,
): Promise<string> {
  const { text } = await callRole(
    {
      lang: input.lang,
      targetKey: input.targetKey,
      stage: 'finalize',
      role: 'finalizer',
      model: input.model,
      chunkIndex: input.chunkIndex,
      prompt: buildFinalizePrompt(input),
      temperature: 0.1,
      stream: true,
    },
    ctx,
  )
  return text
}
