import { buildTranslatePrompt, type TranslatePromptInput } from '../../prompts/translate.ts'
import type { Candidate, Chunk, TranslatorRole } from '../../types.ts'
import { callRole, type StageContext } from '../call.ts'

export interface TranslateStageInput {
  lang: string
  role: TranslatorRole
  model: string
  chunk: Chunk
  prompt: Omit<TranslatePromptInput, 'chunkText'>
}

export async function translateChunk(
  input: TranslateStageInput,
  ctx: StageContext,
): Promise<Candidate> {
  const prompt = buildTranslatePrompt({ ...input.prompt, chunkText: input.chunk.text })
  const { text, usage } = await callRole(
    {
      lang: input.lang,
      stage: 'translate',
      role: input.role,
      model: input.model,
      chunkIndex: input.chunk.index,
      prompt,
      temperature: 0.3,
      stream: true,
    },
    ctx,
  )
  return { chunkIndex: input.chunk.index, role: input.role, model: input.model, text, usage }
}
