import type { FC } from 'react'
import { languageLabel } from '../data/languages'
import type { RunState } from '../stores/run'
import { formatUsd } from './ui'

export const Spinner: FC<{ className?: string }> = ({ className = '' }) => (
  <span
    role="status"
    aria-label="Working"
    className={`inline-block h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent ${className}`}
  />
)

const STATUS_ICON: Record<string, string> = { done: '✓', failed: '!', pending: '·' }

/** What the app is doing right now: one line per target plus the running cost. */
export const RunStatus: FC<{ run: RunState }> = ({ run }) => {
  const targets = Object.values(run.targets)
  const running = run.status === 'running'
  const done = targets.filter((t) => t.status === 'done').length
  return (
    <div className="flex flex-col gap-1 text-xs" aria-live="polite">
      <div className="flex flex-wrap items-center gap-2">
        {running ? <Spinner /> : null}
        <span className="font-medium">
          {running
            ? `Translating… ${done}/${targets.length} target${targets.length > 1 ? 's' : ''} done`
            : run.status === 'done'
              ? 'Done'
              : run.status === 'cancelled'
                ? 'Cancelled'
                : run.status === 'failed'
                  ? 'Failed'
                  : ''}
        </span>
        <span className="text-neutral-600">
          {run.live.calls} call{run.live.calls === 1 ? '' : 's'} · {run.live.tokensIn} in /{' '}
          {run.live.tokensOut} out · <strong>{formatUsd(run.live.usd)}</strong>
          {running ? ' so far' : ''}
        </span>
      </div>
      {running ? (
        <ul className="flex flex-col gap-0.5 text-neutral-600">
          {targets.map((t) => (
            <li key={`${t.lang}#${t.region ?? ''}`} className="flex items-center gap-2">
              <span className="w-4 text-center">
                {t.status === 'running' ? <Spinner className="h-3 w-3" /> : STATUS_ICON[t.status]}
              </span>
              <span className="font-medium text-neutral-700">
                {languageLabel(t.lang, t.region)}
              </span>
              <span>
                {t.activity}
                {t.callsDone > 0 ? ` · ${t.callsDone} calls` : ''}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
