import type { StoragePort } from '../ports.ts'
import type { TranslationJob } from '../types.ts'

type Rows<K extends keyof StoragePort> = StoragePort[K] extends { list(): Promise<infer T> }
  ? T
  : never

/** Materials a client ships with a job so the server needs no copy of the client's library. */
export interface RemoteMaterials {
  contexts: Rows<'contexts'>
  guidelines: Rows<'guidelines'>
  glossaryScopes: Rows<'glossaryScopes'>
  glossaryEntries: Rows<'glossaryEntries'>
  tm: Rows<'tm'>
}

/** Body of `POST /api/jobs`; the response is an SSE stream of ProgressEvent JSON, ended by `[DONE]`. */
export interface RemoteJobRequest {
  job: TranslationJob
  materials: RemoteMaterials
}

export const REMOTE_MATERIAL_TABLES = [
  'contexts',
  'guidelines',
  'glossaryScopes',
  'glossaryEntries',
  'tm',
] as const satisfies ReadonlyArray<keyof RemoteMaterials>

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null

/** Shape check only; row contents are trusted like any other client-supplied job. */
export function isRemoteJobRequest(x: unknown): x is RemoteJobRequest {
  if (!isRecord(x) || !isRecord(x.job) || !isRecord(x.materials)) return false
  const { job, materials } = x
  if (typeof job.id !== 'string' || typeof job.sourceText !== 'string') return false
  if (!Array.isArray(job.targets) || !isRecord(job.models) || !isRecord(job.options)) return false
  return REMOTE_MATERIAL_TABLES.every((t) => Array.isArray(materials[t]))
}

/** Gathers exactly the materials a job references from a local store. */
export async function collectMaterials(
  storage: StoragePort,
  job: TranslationJob,
): Promise<RemoteMaterials> {
  const byIds = async <T extends { id: string }>(
    list: () => Promise<T[]>,
    ids: string[],
  ): Promise<T[]> => (ids.length === 0 ? [] : (await list()).filter((r) => ids.includes(r.id)))
  const wantsGlossary = job.options.glossaryScopeIds.length > 0
  return {
    contexts: await byIds(() => storage.contexts.list(), job.options.contextSourceIds),
    guidelines: await byIds(() => storage.guidelines.list(), job.options.guidelineSetIds),
    glossaryScopes: wantsGlossary ? await storage.glossaryScopes.list() : [],
    glossaryEntries: wantsGlossary ? await storage.glossaryEntries.list() : [],
    tm: job.options.useMemory ? await storage.tm.list() : [],
  }
}
