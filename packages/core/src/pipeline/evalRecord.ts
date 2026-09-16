import type { EvalRecord, RoleModels, TargetResult, TranslationJob } from '../types.ts'

export function promptOverrideHash(overrides: Record<string, string | undefined>): string {
  const entries = Object.entries(overrides)
    .filter(([, v]) => v?.trim())
    .sort(([a], [b]) => a.localeCompare(b))
  if (entries.length === 0) return 'default'
  let h = 0
  for (const ch of JSON.stringify(entries)) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return h.toString(16)
}

export const wordCount = (text: string): number =>
  text.split(/\s+/).filter((w) => w.length > 0).length

export function buildEvalRecord(
  job: TranslationJob,
  models: RoleModels,
  result: TargetResult,
  now: number,
): EvalRecord {
  const issueCounts: Record<string, number> = {}
  for (const r of result.reviews)
    for (const i of r.issues) issueCounts[i.category] = (issueCounts[i.category] ?? 0) + 1
  return {
    id: `${result.jobId}:${result.targetKey}`,
    jobId: result.jobId,
    lang: result.lang,
    createdAt: now,
    domain: result.brief?.domain ?? job.domain,
    difficulty: result.plan.difficulty,
    models,
    score: result.score,
    issueCounts,
    violations: result.guidelineReport.length + result.terminologyReport.length,
    disagreements: result.disagreements.length,
    escalated: result.escalations.length > 0,
    costUsd: result.cost.usd,
    calls: result.cost.calls,
    words: wordCount(job.sourceText),
    promptOverrideHash: promptOverrideHash(job.options.promptOverrides),
    humanEdited: false,
    editDistance: null,
  }
}
