import type { EvalRecord } from '../types.ts'

export type EvalGroupKey = 'translator' | 'domain' | 'lang' | 'difficulty' | 'prompts'

export interface EvalRow {
  key: string
  runs: number
  avgScore: number | null
  avgConfidence: number | null
  costPer1kWords: number
  totalUsd: number
  violationsPerRun: number
  escalatedRate: number
  humanEditRate: number
}

const keyOf = (r: EvalRecord, group: EvalGroupKey): string => {
  switch (group) {
    case 'translator':
      return r.models?.translatorA ?? 'unknown'
    case 'domain':
      return r.domain ?? 'unknown'
    case 'lang':
      return r.lang
    case 'difficulty':
      return r.difficulty ?? 'unknown'
    case 'prompts':
      return r.promptOverrideHash ?? 'default'
  }
}

const avg = (values: number[]): number | null =>
  values.length === 0
    ? null
    : Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10

export function aggregateEvals(records: EvalRecord[], group: EvalGroupKey): EvalRow[] {
  const buckets = new Map<string, EvalRecord[]>()
  for (const r of records) {
    const key = keyOf(r, group)
    const list = buckets.get(key)
    if (list) list.push(r)
    else buckets.set(key, [r])
  }
  return [...buckets.entries()]
    .map(([key, list]) => {
      const scored = list.filter((r) => r.score)
      const words = list.reduce((a, r) => a + (r.words ?? 0), 0)
      const usd = list.reduce((a, r) => a + (r.costUsd ?? 0), 0)
      return {
        key,
        runs: list.length,
        avgScore: avg(scored.map((r) => r.score?.overall ?? 0)),
        avgConfidence: avg(scored.map((r) => r.score?.confidence ?? 0)),
        costPer1kWords: words > 0 ? (usd / words) * 1000 : 0,
        totalUsd: usd,
        violationsPerRun:
          Math.round((list.reduce((a, r) => a + (r.violations ?? 0), 0) / list.length) * 10) / 10,
        escalatedRate: Math.round((list.filter((r) => r.escalated).length / list.length) * 100),
        humanEditRate: Math.round((list.filter((r) => r.humanEdited).length / list.length) * 100),
      }
    })
    .sort((a, b) => b.runs - a.runs)
}

export function issueTotals(records: EvalRecord[]): Array<[string, number]> {
  const totals: Record<string, number> = {}
  for (const r of records)
    for (const [k, v] of Object.entries(r.issueCounts ?? {})) totals[k] = (totals[k] ?? 0) + v
  return Object.entries(totals).sort(([, a], [, b]) => b - a)
}

export function markHumanEdit(
  record: EvalRecord,
  original: string,
  edited: string,
  distance: number,
): EvalRecord {
  return { ...record, humanEdited: distance > 0 && original !== edited, editDistance: distance }
}
