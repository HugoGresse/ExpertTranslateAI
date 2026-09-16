import { buildBackTranslatePrompt, buildDeltaPrompt } from '../../prompts/backTranslate.ts'
import type { PromptMaterials } from '../../prompts/materials.ts'
import { deltaSchema } from '../../schemas/pipeline.ts'
import type { BackTranslation } from '../../types.ts'
import { callRole, callRoleJson, type StageContext } from '../call.ts'

export interface BackTranslateInput {
  lang: string
  targetKey: string
  model: string
  sourceLang: string
  targetLabel: string
  sourceText: string
  finalText: string
  materials: PromptMaterials
}

export async function backTranslateTarget(
  input: BackTranslateInput,
  ctx: StageContext,
): Promise<BackTranslation> {
  const { text } = await callRole(
    {
      lang: input.lang,
      targetKey: input.targetKey,
      stage: 'backtranslate',
      role: 'backTranslator',
      model: input.model,
      chunkIndex: null,
      prompt: buildBackTranslatePrompt(input),
      temperature: 0,
    },
    ctx,
  )
  const { value } = await callRoleJson(
    {
      lang: input.lang,
      targetKey: input.targetKey,
      stage: 'backtranslate',
      role: 'backTranslator',
      model: input.model,
      chunkIndex: null,
      prompt: buildDeltaPrompt({
        sourceLang: input.sourceLang,
        sourceText: input.sourceText,
        backText: text,
        materials: input.materials,
      }),
      temperature: 0,
    },
    deltaSchema,
    ctx,
  )
  ctx.logger.info('backtranslate.done', {
    lang: input.lang,
    deltas: value.deltas.length,
    major: value.deltas.filter((d) => d.severity === 'major').length,
  })
  return { text, model: input.model, deltas: value.deltas }
}
