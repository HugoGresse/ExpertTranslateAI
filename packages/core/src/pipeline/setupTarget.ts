import { activeContextSources, buildContextBlock, truncateToTokens } from '../context/prepare.ts'
import { glossaryTargetTerms } from '../glossary/check.ts'
import { formatGlossaryBlock } from '../glossary/format.ts'
import { resolveGlossary } from '../glossary/resolve.ts'
import {
  activeGuidelineSets,
  formatGuidelinesBlock,
  type NumberedRule,
  numberRules,
} from '../guidelines/format.ts'
import type { PromptMaterials } from '../prompts/materials.ts'
import { chunkText } from '../text/chunk.ts'
import { protectPlaceholders } from '../text/placeholders.ts'
import { formatMemoryBlock, matchMemory } from '../tm/match.ts'
import type {
  Brief,
  Chunk,
  ContextSource,
  GlossaryEntry,
  GlossaryScope,
  GuidelineSet,
  MemoryHit,
  RoleModels,
  Target,
  TmEntry,
  TraceEvent,
  TranslationJob,
} from '../types.ts'
import { AUTO_LANG } from '../types.ts'
import type { StageContext } from './call.ts'
import { targetKey } from './targetKey.ts'

export interface JobMaterials {
  sources: ContextSource[]
  guidelineSets: GuidelineSet[]
  glossaryScopes: GlossaryScope[]
  glossaryEntries: GlossaryEntry[]
  memory: TmEntry[]
  brief: Brief | null
  trace: TraceEvent[]
  models: RoleModels
}

export interface TargetSetup {
  lang: string
  key: string
  target: Target
  targetLabel: string
  sourceLang: string
  resolvedSourceLang: string | null
  materials: PromptMaterials
  sets: GuidelineSet[]
  rules: NumberedRule[]
  glossary: GlossaryEntry[]
  glossaryTerms: string[]
  memoryHits: MemoryHit[]
  protectedText: string
  placeholders: Map<string, string>
  chunks: Chunk[]
  models: RoleModels
}

export const resolveSourceLang = (job: TranslationJob, brief: Brief | null): string | null =>
  job.sourceLang !== AUTO_LANG ? job.sourceLang : (brief?.detectedLang ?? null)

const sourceLabel = (job: TranslationJob, brief: Brief | null): string =>
  resolveSourceLang(job, brief) ?? 'the source language (detect it yourself)'

function truncateGuidelinesBlock(
  block: string,
  budget: number,
): { text: string; truncated: boolean } {
  if (!block) return { text: '', truncated: false }
  const inner = block.replace(/^<GUIDELINES>\n?/, '').replace(/\n?<\/GUIDELINES>$/, '')
  const fitted = truncateToTokens(inner, Math.max(1, budget - 8))
  return { text: `<GUIDELINES>\n${fitted.text}\n</GUIDELINES>`, truncated: fitted.truncated }
}

export const targetLabelOf = (t: Target): string =>
  t.region ? `${t.lang} as spoken in ${t.region}` : t.lang

export function setupTarget(
  job: TranslationJob,
  target: Target,
  materials: JobMaterials,
  ctx: StageContext,
): TargetSetup {
  const protectedSource = protectPlaceholders(job.sourceText)
  const chunks = chunkText(protectedSource.text, job.options.maxTokensPerChunk)
  const sources = activeContextSources(materials.sources, target.lang)
  const context = buildContextBlock(sources, job.options.contextTokenBudget, ctx.logger)
  const sets = activeGuidelineSets(materials.guidelineSets, target.lang)
  const guidelines = truncateGuidelinesBlock(
    formatGuidelinesBlock(sets),
    job.options.guidelinesTokenBudget,
  )
  if (guidelines.truncated) ctx.logger.warn('guidelines.truncated', { lang: target.lang })
  const glossary = resolveGlossary(
    materials.glossaryScopes,
    materials.glossaryEntries,
    job.options.glossaryScopeIds,
    target.lang,
  )
  const resolvedSourceLang = resolveSourceLang(job, materials.brief)
  const memory = job.options.useMemory
    ? matchMemory(job.sourceText, materials.memory, resolvedSourceLang, target.lang)
    : { exact: [], fuzzy: [] }
  const glossaryBlock = formatGlossaryBlock(glossary)
  const memoryBlock = formatMemoryBlock(memory)
  ctx.logger.info('target.start', {
    lang: target.lang,
    chunks: chunks.length,
    contextSources: sources.length,
    contextTokens: context.tokens,
    guidelineSets: sets.length,
    glossaryEntries: glossary.length,
    memoryExact: memory.exact.length,
    memoryFuzzy: memory.fuzzy.length,
    sourceLang: resolvedSourceLang,
  })
  return {
    lang: target.lang,
    key: targetKey(target),
    target,
    targetLabel: targetLabelOf(target),
    sourceLang: sourceLabel(job, materials.brief),
    resolvedSourceLang,
    materials: {
      brief: materials.brief,
      ...(context.block ? { contextBlock: context.block } : {}),
      ...(guidelines.text ? { guidelinesBlock: guidelines.text } : {}),
      ...(glossaryBlock ? { glossaryBlock } : {}),
      ...(memoryBlock ? { memoryBlock } : {}),
      overrides: job.options.promptOverrides,
    },
    sets,
    rules: numberRules(sets),
    glossary,
    glossaryTerms: glossaryTargetTerms(glossary),
    memoryHits: [...memory.exact, ...memory.fuzzy],
    protectedText: protectedSource.text,
    placeholders: protectedSource.placeholders,
    chunks,
    models: materials.models,
  }
}
