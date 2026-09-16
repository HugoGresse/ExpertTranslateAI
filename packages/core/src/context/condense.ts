import { callRole, type StageContext } from '../pipeline/call.ts'
import { buildCondensePrompt } from '../prompts/condenseContext.ts'
import { countTokens } from '../text/tokens.ts'
import type { ContextDigest, ContextSource, Usage } from '../types.ts'
import { digestLlmsTxt, parseLlmsTxt } from './llmsTxt.ts'

export function sourceText(source: ContextSource): string {
  if (source.kind === 'llms-txt') return digestLlmsTxt(parseLlmsTxt(source.rawText))
  return source.rawText
}

export function needsCondense(source: ContextSource, budget: number): boolean {
  return countTokens(sourceText(source)) > budget
}

export function hasFreshDigest(source: ContextSource): boolean {
  return source.condensed !== undefined && source.condensed.forHash === source.contentHash
}

export async function condenseSource(
  model: string,
  source: ContextSource,
  budget: number,
  ctx: StageContext,
): Promise<{ digest: ContextDigest; usage: Usage }> {
  const text = sourceText(source)
  const prompt = buildCondensePrompt({ name: source.name, text, targetTokens: budget })
  ctx.logger.info('context.condense.start', {
    source: source.id,
    tokens: countTokens(text),
    budget,
    model,
  })
  const { text: condensed, usage } = await callRole(
    {
      lang: '*',
      targetKey: '*',
      stage: 'context',
      role: 'helper',
      model,
      chunkIndex: null,
      prompt,
      temperature: 0.2,
    },
    ctx,
  )
  const digest: ContextDigest = {
    text: condensed,
    model,
    tokenEstimate: countTokens(condensed),
    forHash: source.contentHash,
  }
  ctx.logger.info('context.condense.done', {
    source: source.id,
    tokens: digest.tokenEstimate,
    ...usage,
  })
  return { digest, usage }
}
