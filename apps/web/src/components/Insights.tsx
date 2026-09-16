import {
  aggregateEvals,
  type EvalGroupKey,
  type EvalRecord,
  issueTotals,
} from '@experttranslate/core'
import { type FC, useMemo, useState } from 'react'
import { storage } from '../adapters/dexieStorage'
import { logger } from '../adapters/logger'
import { useRepo } from '../hooks/useRepo'
import { pickOneOf } from '../lib/guards'
import { Button, Card, formatUsd, inputClass } from './ui'

type GroupKey = EvalGroupKey
const GROUP_KEYS = ['translator', 'domain', 'lang', 'difficulty', 'prompts'] as const

const Bar: FC<{ value: number | null; max: number }> = ({ value, max }) => (
  <span className="inline-block h-2 w-24 rounded bg-neutral-100 align-middle">
    <span
      className="block h-2 rounded bg-accent"
      style={{ width: `${value === null || max === 0 ? 0 : Math.min(100, (value / max) * 100)}%` }}
    />
  </span>
)

export const Insights: FC = () => {
  const evals = useRepo<EvalRecord>(storage.evals)
  const [group, setGroup] = useState<GroupKey>('translator')
  const rows = useMemo(() => aggregateEvals(evals.items, group), [evals.items, group])
  const totals = useMemo(() => issueTotals(evals.items), [evals.items])
  const maxIssue = totals[0]?.[1] ?? 0

  return (
    <div className="flex flex-col gap-4">
      <Card title={`Insights (${evals.items.length} evaluated runs)`}>
        <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
          <span>Group by</span>
          <select
            className={inputClass}
            value={group}
            onChange={(e) => setGroup(pickOneOf(GROUP_KEYS, e.target.value, 'translator'))}
            aria-label="Group by"
          >
            <option value="translator">translator model</option>
            <option value="domain">domain</option>
            <option value="lang">target language</option>
            <option value="difficulty">difficulty</option>
            <option value="prompts">prompt version</option>
          </select>
          <Button
            variant="danger"
            className="ml-auto"
            onClick={() => void clearAll(evals.items, evals.reload)}
          >
            Clear log
          </Button>
        </div>
        {rows.length === 0 ? (
          <p className="text-sm text-neutral-500">Run a translation to start collecting data.</p>
        ) : null}
        {rows.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-neutral-500">
                <tr>
                  <th className="pr-2">{group}</th>
                  <th className="pr-2">runs</th>
                  <th className="pr-2">score</th>
                  <th className="pr-2">confidence</th>
                  <th className="pr-2">$ / 1k words</th>
                  <th className="pr-2">total</th>
                  <th className="pr-2">violations / run</th>
                  <th className="pr-2">escalated</th>
                  <th className="pr-2">edited</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key} className="border-t border-neutral-100">
                    <td className="py-1 pr-2 font-medium">{r.key}</td>
                    <td className="py-1 pr-2">{r.runs}</td>
                    <td className="py-1 pr-2">
                      <Bar value={r.avgScore} max={100} /> {r.avgScore ?? '–'}
                    </td>
                    <td className="py-1 pr-2">
                      <Bar value={r.avgConfidence} max={100} /> {r.avgConfidence ?? '–'}
                    </td>
                    <td className="py-1 pr-2">{formatUsd(r.costPer1kWords)}</td>
                    <td className="py-1 pr-2">{formatUsd(r.totalUsd)}</td>
                    <td className="py-1 pr-2">{r.violationsPerRun}</td>
                    <td className="py-1 pr-2">{r.escalatedRate}%</td>
                    <td className="py-1 pr-2">{r.humanEditRate}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Card>
      {totals.length > 0 ? (
        <Card title="Reviewer issue categories">
          <ul className="flex flex-col gap-1 text-sm">
            {totals.map(([k, v]) => (
              <li key={k} className="flex items-center gap-2">
                <span className="w-28 text-neutral-600">{k}</span>
                <Bar value={v} max={maxIssue} />
                <span>{v}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  )
}

async function clearAll(items: EvalRecord[], reload: () => Promise<void>): Promise<void> {
  try {
    for (const r of items) await storage.evals.delete(r.id)
    logger.info('insights.cleared', { count: items.length })
  } catch (error) {
    logger.error('insights.clearFailed', { error: String(error) })
  }
  await reload()
}
