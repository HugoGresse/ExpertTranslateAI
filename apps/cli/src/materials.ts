import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import {
  type ContextSource,
  contentHash,
  extractRules,
  type FetchPort,
  type GuidelineSet,
  isLlmsTxt,
  type LlmPort,
  type LoggerPort,
  type ReasoningEffort,
  type StoragePort,
} from '@experttranslate/core'

const isUrl = (spec: string): boolean => /^https?:\/\//i.test(spec)

export interface MaterialPorts {
  storage: StoragePort
  fetch: FetchPort
  logger: LoggerPort
  now: () => number
  makeId: () => string
}

async function readSpec(spec: string, ports: MaterialPorts): Promise<string> {
  if (isUrl(spec)) return (await ports.fetch.text(spec)).body
  ports.logger.debug('material.read', { file: spec })
  const text = await readFile(spec, 'utf8')
  ports.logger.debug('material.readDone', { file: spec, chars: text.length })
  return text
}

/**
 * Loads ad hoc context sources (URLs or files) and returns their ids. A source is stored once per
 * distinct content, so repeated runs with the same file reuse the row and its cached digest.
 */
export async function loadContexts(specs: string[], ports: MaterialPorts): Promise<string[]> {
  if (specs.length === 0) return []
  const byHash = new Map((await ports.storage.contexts.list()).map((c) => [c.contentHash, c.id]))
  const ids: string[] = []
  for (const spec of specs) {
    const rawText = await readSpec(spec, ports)
    const hash = await contentHash(rawText)
    const existing = byHash.get(hash)
    if (existing) {
      ports.logger.debug('context.reused', { spec, id: existing })
      ids.push(existing)
      continue
    }
    const source: ContextSource = {
      id: ports.makeId(),
      name: isUrl(spec) ? spec : basename(spec),
      kind: isLlmsTxt(rawText, spec) ? 'llms-txt' : isUrl(spec) ? 'markdown-url' : 'markdown-file',
      ...(isUrl(spec) ? { url: spec, fetchedAt: ports.now() } : {}),
      rawText,
      contentHash: hash,
      enabled: true,
      createdAt: ports.now(),
    }
    await ports.storage.contexts.put(source)
    byHash.set(hash, source.id)
    ports.logger.info('context.added', {
      spec,
      id: source.id,
      kind: source.kind,
      chars: rawText.length,
    })
    ids.push(source.id)
  }
  return ids
}

export interface GuidelineExtraction {
  llm: LlmPort
  model: string
  reasoningEffort: ReasoningEffort
  signal?: AbortSignal
}

/** Deterministic id so the same guideline text maps to one stored set across runs. */
const guidelineSetId = (hash: string): string => `cli-gl-${hash.slice(0, 16)}`

/**
 * Stores each guideline file once (keyed by content) and extracts checkable rules with the helper
 * model on first sight, so later runs pay no extraction call and the audit can report violations.
 */
export async function loadGuidelineFiles(
  files: string[],
  ports: MaterialPorts,
  extraction: GuidelineExtraction,
): Promise<string[]> {
  const ids: string[] = []
  for (const file of files) {
    const freeText = (await readSpec(file, ports)).trim()
    if (!freeText) {
      ports.logger.warn('guidelines.empty', { file })
      continue
    }
    const id = guidelineSetId(await contentHash(freeText))
    const existing = await ports.storage.guidelines.get(id)
    if (existing) {
      ports.logger.debug('guidelines.reused', { file, id, rules: existing.rules.length })
      ids.push(id)
      continue
    }
    let rules: GuidelineSet['rules'] = []
    try {
      const extracted = await extractRules(
        extraction.llm,
        extraction.model,
        freeText,
        ports.makeId,
        {
          reasoningEffort: extraction.reasoningEffort,
          logger: ports.logger,
          ...(extraction.signal ? { signal: extraction.signal } : {}),
        },
      )
      rules = extracted.rules
      ports.logger.info('guidelines.extracted', { file, rules: rules.length, ...extracted.usage })
    } catch (error) {
      ports.logger.warn('guidelines.extractFailed', {
        file,
        error: String(error),
        note: 'free text is still sent to the models, but the rule audit will be empty',
      })
    }
    const set: GuidelineSet = {
      id,
      name: basename(file),
      rules,
      freeText,
      enabled: true,
      createdAt: ports.now(),
    }
    await ports.storage.guidelines.put(set)
    ports.logger.info('guidelines.added', { file, id, rules: rules.length, chars: freeText.length })
    ids.push(id)
  }
  return ids
}
