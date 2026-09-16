import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import {
  type ContextSource,
  contentHash,
  type FetchPort,
  type GuidelineSet,
  isLlmsTxt,
  type LoggerPort,
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

/** Loads ad hoc context sources (URLs or files) into storage for this run and returns their ids. */
export async function loadContexts(specs: string[], ports: MaterialPorts): Promise<string[]> {
  const ids: string[] = []
  for (const spec of specs) {
    const rawText = isUrl(spec) ? (await ports.fetch.text(spec)).body : await readFile(spec, 'utf8')
    const hash = await contentHash(rawText)
    const existing = (await ports.storage.contexts.list()).find((c) => c.contentHash === hash)
    if (existing) {
      ports.logger.debug('context.reused', { spec, id: existing.id })
      ids.push(existing.id)
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

/** Stores each guideline file as a free-text set (no LLM extraction) and returns the ids. */
export async function loadGuidelineFiles(files: string[], ports: MaterialPorts): Promise<string[]> {
  const ids: string[] = []
  for (const file of files) {
    const freeText = (await readFile(file, 'utf8')).trim()
    if (!freeText) {
      ports.logger.warn('guidelines.empty', { file })
      continue
    }
    const set: GuidelineSet = {
      id: ports.makeId(),
      name: basename(file),
      rules: [],
      freeText,
      enabled: true,
      createdAt: ports.now(),
    }
    await ports.storage.guidelines.put(set)
    ports.logger.info('guidelines.added', { file, id: set.id, chars: freeText.length })
    ids.push(set.id)
  }
  return ids
}
