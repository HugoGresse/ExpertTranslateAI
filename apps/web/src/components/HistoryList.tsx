import type { TranslationJob } from '@experttranslate/core'
import { type FC, useEffect, useState } from 'react'
import { storage } from '../adapters/dexieStorage'
import { logger } from '../adapters/logger'
import { languageLabel } from '../data/languages'
import { jobCost } from '../stores/restoreRun'
import { Button, basePath, buttonClass, Card, formatUsd, Spinner } from './ui'

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
    <p className="mt-1 line-clamp-2 text-xs text-neutral-500">{job.sourceText.slice(0, 400)}</p>
  </li>
)

/** Jobs from before the cost was stored on the job: add it up once from the results, then keep it. */
async function backfillCost(job: TranslationJob): Promise<number> {
  const cost = jobCost(await storage.results.listByJob(job.id))
  if (job.status !== 'running' && job.status !== 'queued')
    await storage.jobs
      .put({ ...job, cost })
      .catch((error: unknown) =>
        logger.warn('history.costBackfillFailed', { jobId: job.id, error: String(error) }),
      )
  return cost.usd
}

export const HistoryList: FC = () => {
  const [jobs, setJobs] = useState<TranslationJob[] | null>(null)
  const [costs, setCosts] = useState<Record<string, number>>({})

  useEffect(() => {
    let live = true
    void (async () => {
      const started = performance.now()
      // Only the jobs table: results carry full traces and are read just for legacy rows below.
      const list = await storage.jobs.list()
      if (!live) return
      setJobs(list)
      setCosts(
        Object.fromEntries(list.flatMap((j) => (j.cost ? [[j.id, j.cost.usd] as const] : []))),
      )
      logger.debug('history.loaded', {
        jobs: list.length,
        ms: Math.round(performance.now() - started),
      })
      for (const job of list.filter((j) => !j.cost)) {
        const usd = await backfillCost(job)
        if (!live) return
        setCosts((c) => ({ ...c, [job.id]: usd }))
      }
    })().catch((error: unknown) => {
      logger.error('history.loadFailed', { error: String(error) })
      if (live) setJobs([])
    })
    return () => {
      live = false
    }
  }, [])

  const total = (jobs ?? []).reduce((acc, j) => acc + (costs[j.id] ?? 0), 0)

  const remove = async (id: string): Promise<void> => {
    await storage.results.deleteByJob(id)
    await storage.jobs.delete(id)
    logger.info('history.deleted', { jobId: id })
    setJobs((list) => list?.filter((j) => j.id !== id) ?? null)
  }

  if (jobs === null)
    return (
      <Card title="History">
        <p className="flex items-center gap-2 text-sm text-muted" aria-live="polite">
          <Spinner /> Loading history…
        </p>
      </Card>
    )

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
