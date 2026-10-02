import { callRole, type StageContext } from '../pipeline/call.ts'
import { buildCondensePrompt } from '../prompts/condenseContext.ts'
import { countTokens } from '../text/tokens.ts'
import { sliceSafe } from '../text/unicode.ts'
import type { ContextDigest, ContextSource, Usage } from '../types.ts'
import { digestLlmsTxt, parseLlmsTxt } from './llmsTxt.ts'

export function sourceText(source: ContextSource): string {
  const own =
    source.kind === 'llms-txt' ? digestLlmsTxt(parseLlmsTxt(source.rawText)) : source.rawText
  const linked = source.linked ?? []
  if (linked.length === 0) return own
  return [own, ...linked.map((p) => `---\n# ${p.title} (${p.url})\n\n${p.text.trim()}`)].join(
    '\n\n',
  )
}

/** Roughly 24k tokens: what a small helper model can take in one condense call. */
export const MAX_CONDENSE_INPUT_CHARS = 96_000

/**
 * Token count of a source, stopping once it is clearly above `cap`; enough to compare against a
 * budget without tokenising hundreds of thousands of crawled characters.
 */
export function sourceTokensUpTo(source: ContextSource, cap: number): number {
  return Math.min(countTokens(sliceSafe(sourceText(source), 0, (cap + 1) * 8)), cap + 1)
}

export function needsCondense(source: ContextSource, budget: number): boolean {
  return sourceTokensUpTo(source, budget) > budget
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
  const full = sourceText(source)
  // Crawled pages can be far larger than the helper's context; condense their head instead of failing the job.
  const text =
    full.length > MAX_CONDENSE_INPUT_CHARS ? sliceSafe(full, 0, MAX_CONDENSE_INPUT_CHARS) : full
  if (text !== full)
    ctx.logger.warn('context.condense.inputCapped', {
      source: source.id,
      chars: full.length,
      kept: text.length,
    })
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
