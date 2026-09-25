import type { TranslationJob } from '@experttranslate/core'
import { type FC, useCallback, useEffect, useState } from 'react'
import { storage } from '../adapters/dexieStorage'
import { logger } from '../adapters/logger'
import { languageLabel } from '../data/languages'
import { jobCost } from '../stores/restoreRun'
import { Button, basePath, buttonClass, Card, formatUsd } from './ui'

const JobRow: FC<{ job: TranslationJob; cost: number | null; onDelete: (id: string) => void }> = ({
  job,
  cost,
  onDelete,
}) => (
  <li className="rounded-lg border border-neutral-200 bg-white p-3">
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
      <div>
        <span className="font-medium">{new Date(job.createdAt).toLocaleString()}</span>
        <span className="ml-2 text-neutral-600">
          {job.targets.map((t) => languageLabel(t.lang, t.region)).join(', ')} ·{' '}
          {job.models.translatorA} · {job.status}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <span
          className="rounded-full bg-neutral-100 px-2 py-0.5 text-sm font-semibold"
          title="Total cost of this run"
        >
          {cost === null ? '—' : formatUsd(cost)}
        </span>
        <a href={basePath(`/?job=${encodeURIComponent(job.id)}`)} className={buttonClass()}>
          Open
        </a>
        <Button variant="danger" onClick={() => onDelete(job.id)}>
          Delete
        </Button>
      </div>
    </div>
    <p className="mt-1 line-clamp-2 text-xs text-neutral-500">{job.sourceText}</p>
  </li>
)

export const HistoryList: FC = () => {
  const [jobs, setJobs] = useState<TranslationJob[]>([])
  const [costs, setCosts] = useState<Record<string, number>>({})

  const reload = useCallback(async (): Promise<void> => {
    const list = (await storage.jobs.list()).sort((a, b) => b.createdAt - a.createdAt)
    setJobs(list)
    const entries = await Promise.all(
      list.map(async (job) => {
        const results = await storage.results.listByJob(job.id)
        return [job.id, jobCost(results).usd] as const
      }),
    )
    setCosts(Object.fromEntries(entries))
  }, [])
  const total = jobs.reduce((acc, j) => acc + (costs[j.id] ?? 0), 0)

  useEffect(() => {
    void reload()
  }, [reload])

  const remove = async (id: string): Promise<void> => {
    await storage.results.deleteByJob(id)
    await storage.jobs.delete(id)
    logger.info('history.deleted', { jobId: id })
    await reload()
  }

  return (
    <Card title="History">
      <p className="mb-3 text-sm">
        {jobs.length} run{jobs.length === 1 ? '' : 's'} · total spent{' '}
        <strong className="text-base">{formatUsd(total)}</strong>
      </p>
      {jobs.length === 0 ? <p className="text-sm text-neutral-500">No translations yet.</p> : null}
      <ul className="flex flex-col gap-3">
        {jobs.map((job) => (
          <JobRow
            key={job.id}
            job={job}
            cost={costs[job.id] ?? null}
            onDelete={(id) => void remove(id)}
          />
        ))}
      </ul>
    </Card>
  )
}
