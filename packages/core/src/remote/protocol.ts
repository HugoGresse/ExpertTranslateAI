import { expandScopeIds } from '../glossary/resolve.ts'
import type { StoragePort } from '../ports.ts'
import { remoteJobRequestSchema } from '../schemas/job.ts'
import { loadByIds } from '../storage/loadByIds.ts'
import type {
  ContextSource,
  GlossaryEntry,
  GlossaryScope,
  GuidelineSet,
  TmEntry,
  TranslationJob,
} from '../types.ts'
import { AUTO_LANG } from '../types.ts'

/** Materials a client ships with a job so the server needs no copy of the client's library. */
export interface RemoteMaterials {
  contexts: ContextSource[]
  guidelines: GuidelineSet[]
  glossaryScopes: GlossaryScope[]
  glossaryEntries: GlossaryEntry[]
  tm: TmEntry[]
}

/** Body of `POST /api/jobs`; the response is an SSE stream of ProgressEvent JSON, ended by `[DONE]`. */
export interface RemoteJobRequest {
  job: TranslationJob
  materials: RemoteMaterials
}

/** Wire-level frame the server sends when the run dies before `job-done`. */
export interface RemoteErrorEvent {
  type: 'error'
  message: string
}

export const REMOTE_MATERIAL_TABLES = [
  'contexts',
  'guidelines',
  'glossaryScopes',
  'glossaryEntries',
  'tm',
] as const satisfies ReadonlyArray<keyof RemoteMaterials>

export type RemoteRequestParse =
  | { ok: true; value: RemoteJobRequest }
  | { ok: false; issues: string[] }

/** Validates a request body; rows beyond `id` are trusted like any other client-supplied job data. */
export function parseRemoteJobRequest(x: unknown): RemoteRequestParse {
  const result = remoteJobRequestSchema.safeParse(x)
  if (!result.success)
    return {
      ok: false,
      issues: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    }
  // zod's passthrough rows are typed as `{ id: string } & Record<string, unknown>`; the schema is the
  // structural gate, the domain types describe what the rows are.
  return { ok: true, value: result.data as unknown as RemoteJobRequest }
}

export const isRemoteJobRequest = (x: unknown): x is RemoteJobRequest => parseRemoteJobRequest(x).ok

/** Gathers only what the job can use: referenced ids, active glossary scopes and target-language rows. */
export async function collectMaterials(
  storage: StoragePort,
  job: TranslationJob,
): Promise<RemoteMaterials> {
  const targetLangs = new Set(job.targets.map((t) => t.lang))
  const wantsGlossary = job.options.glossaryScopeIds.length > 0
  const scopes = wantsGlossary ? await storage.glossaryScopes.list() : []
  const active = expandScopeIds(scopes, job.options.glossaryScopeIds)
  const entries = wantsGlossary
    ? (await storage.glossaryEntries.list()).filter(
        (e) => active.has(e.scopeId) && (e.kind === 'doNotTranslate' || targetLangs.has(e.lang)),
      )
    : []
  const tm = job.options.useMemory
    ? (await storage.tm.list()).filter(
        (e) =>
          targetLangs.has(e.targetLang) &&
          (job.sourceLang === AUTO_LANG || e.sourceLang === job.sourceLang),
      )
    : []
  return {
    contexts: await loadByIds(storage.contexts, job.options.contextSourceIds),
    guidelines: await loadByIds(storage.guidelines, job.options.guidelineSetIds),
    glossaryScopes: scopes.filter((s) => active.has(s.id)),
    glossaryEntries: entries,
    tm,
  }
}
