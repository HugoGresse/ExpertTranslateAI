import type { StageContext } from '../pipeline/call.ts'
import type { LoggerPort, StoragePort } from '../ports.ts'
import { countTokens } from '../text/tokens.ts'
import type { ContextSource, Usage } from '../types.ts'
import { condenseSource, hasFreshDigest, needsCondense, sourceText } from './condense.ts'

export interface ContextBlock {
  block: string
  tokens: number
  truncated: string[]
}

export function activeContextSources(sources: ContextSource[], lang: string): ContextSource[] {
  return sources.filter((s) => s.enabled && (!s.lang || s.lang === lang))
}

export function truncateToTokens(
  text: string,
  maxTokens: number,
): { text: string; truncated: boolean } {
  if (countTokens(text) <= maxTokens) return { text, truncated: false }
  let out = text
  while (out.length > 0 && countTokens(out) > maxTokens)
    out = out.slice(0, Math.floor(out.length * 0.85))
  return { text: `${out}\n…`, truncated: true }
}

export function formatContextBlock(entries: Array<{ name: string; text: string }>): string {
  if (entries.length === 0) return ''
  return ['<CONTEXT>', ...entries.map((e) => `### ${e.name}\n${e.text}`), '</CONTEXT>'].join('\n')
}

export interface EnsureDigestsOptions {
  budgetPerSource: number
  model: string
  storage: StoragePort
  ctx: StageContext
}

export async function ensureDigests(
  sources: ContextSource[],
  opts: EnsureDigestsOptions,
): Promise<{ sources: ContextSource[]; usages: Usage[] }> {
  const usages: Usage[] = []
  const out: ContextSource[] = []
  for (const source of sources) {
    if (!needsCondense(source, opts.budgetPerSource) || hasFreshDigest(source)) {
      out.push(source)
      continue
    }
    const { digest, usage } = await condenseSource(
      opts.model,
      source,
      opts.budgetPerSource,
      opts.ctx,
    )
    usages.push(usage)
    const updated = { ...source, condensed: digest }
    await opts.storage.contexts.put(updated)
    out.push(updated)
  }
  return { sources: out, usages }
}

export function contextTextFor(source: ContextSource, budget: number): string {
  if (!needsCondense(source, budget)) return sourceText(source)
  return source.condensed && hasFreshDigest(source) ? source.condensed.text : sourceText(source)
}

export function buildContextBlock(
  sources: ContextSource[],
  budgetPerSource: number,
  logger: LoggerPort,
): ContextBlock {
  const truncated: string[] = []
  const entries = sources.map((source) => {
    const fitted = truncateToTokens(contextTextFor(source, budgetPerSource), budgetPerSource)
    if (fitted.truncated) {
      truncated.push(source.id)
      logger.warn('context.truncated', { source: source.id, budget: budgetPerSource })
    }
    return { name: source.name, text: fitted.text }
  })
  const block = formatContextBlock(entries)
  return { block, tokens: countTokens(block), truncated }
}
