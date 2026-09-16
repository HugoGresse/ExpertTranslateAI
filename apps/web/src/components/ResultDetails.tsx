import type { Brief, QualityScore, Review, TargetResult } from '@experttranslate/core'
import { type FC, useState } from 'react'
import { Button } from './ui'

const DIMENSIONS: Array<{
  key: keyof Omit<QualityScore, 'overall' | 'confidence' | 'notes'>
  label: string
}> = [
  { key: 'fidelity', label: 'Fidelity' },
  { key: 'terminology', label: 'Terminology' },
  { key: 'grammar', label: 'Grammar' },
  { key: 'naturalness', label: 'Naturalness' },
  { key: 'register', label: 'Register' },
  { key: 'consistency', label: 'Consistency' },
]

const tone = (n: number): string =>
  n >= 85 ? 'bg-green-500' : n >= 65 ? 'bg-amber-400' : 'bg-red-500'

export const ScoreCard: FC<{ score: QualityScore }> = ({ score }) => (
  <div className="mt-3 rounded-md border border-neutral-200 p-3 text-xs">
    <div className="mb-2 flex items-baseline gap-3">
      <span className="text-lg font-semibold">{score.overall}</span>
      <span className="text-neutral-600">overall · confidence {score.confidence}%</span>
    </div>
    <ul className="grid gap-1 sm:grid-cols-2">
      {DIMENSIONS.map((d) => (
        <li key={d.key} className="flex items-center gap-2">
          <span className="w-24 text-neutral-600">{d.label}</span>
          <span className="h-2 flex-1 rounded bg-neutral-100">
            <span
              className={`block h-2 rounded ${tone(score[d.key])}`}
              style={{ width: `${score[d.key]}%` }}
            />
          </span>
          <span className="w-8 text-right">{score[d.key]}</span>
        </li>
      ))}
    </ul>
    {score.notes.length > 0 ? (
      <ul className="mt-2 list-disc pl-4 text-neutral-700">
        {score.notes.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
    ) : null}
  </div>
)

export const BriefCard: FC<{ brief: Brief }> = ({ brief }) => {
  const [open, setOpen] = useState(false)
  return (
    <div className="mb-3 rounded-md border border-neutral-200 bg-neutral-50 p-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">Brief</span>
        <span className="rounded bg-white px-1.5">{brief.detectedLang}</span>
        <span className="rounded bg-white px-1.5">{brief.domain}</span>
        <span className="rounded bg-white px-1.5">{brief.difficulty}</span>
        <Button variant="ghost" className="ml-auto" onClick={() => setOpen((o) => !o)}>
          {open ? 'Less' : 'More'}
        </Button>
      </div>
      {open ? (
        <div className="mt-2 flex flex-col gap-1">
          {brief.summary ? <p>{brief.summary}</p> : null}
          {brief.tone ? <p>Tone: {brief.tone}</p> : null}
          {brief.audience ? <p>Audience: {brief.audience}</p> : null}
          {brief.keyTerms.length > 0 ? (
            <p>
              Key terms:{' '}
              {brief.keyTerms.map((t) => (t.note ? `${t.term} (${t.note})` : t.term)).join('; ')}
            </p>
          ) : null}
          {brief.risks.length > 0 ? <p>Risks: {brief.risks.join('; ')}</p> : null}
        </div>
      ) : null}
    </div>
  )
}

const severityClass: Record<string, string> = {
  minor: 'text-neutral-600',
  major: 'text-amber-700',
  critical: 'text-red-700',
}

export const ReviewCard: FC<{ reviews: Review[] }> = ({ reviews }) => {
  const [open, setOpen] = useState(false)
  const issues = reviews.flatMap((r) => r.issues)
  return (
    <div className="mt-3">
      <Button variant="ghost" onClick={() => setOpen((o) => !o)}>
        {open
          ? 'Hide review'
          : `Show review (${issues.length} issue${issues.length === 1 ? '' : 's'})`}
      </Button>
      {open ? (
        <div className="mt-2 rounded-md border border-neutral-200 p-2 text-xs">
          {issues.length === 0 ? (
            <p className="text-neutral-500">The reviewer reported no issues.</p>
          ) : null}
          <ul className="flex flex-col gap-1">
            {issues.map((i) => (
              <li key={`${i.candidate}-${i.category}-${i.explanation}`}>
                <span className={`font-medium ${severityClass[i.severity] ?? ''}`}>
                  {i.severity} {i.category}
                </span>{' '}
                <span className="text-neutral-500">[{i.candidate}]</span> {i.explanation}
                {i.targetSpan ? (
                  <span className="text-neutral-500"> — “{i.targetSpan}”</span>
                ) : null}
                {i.fix ? <span className="text-green-700"> → {i.fix}</span> : null}
              </li>
            ))}
          </ul>
          {reviews.some((r) => r.suggestions.length > 0) ? (
            <p className="mt-2 text-neutral-700">
              Suggestions: {reviews.flatMap((r) => r.suggestions).join(' ')}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export const CandidatesCard: FC<{ result: TargetResult }> = ({ result }) => {
  const [open, setOpen] = useState(false)
  const roles = result.plan.translators
  return (
    <div className="mt-3">
      <Button variant="ghost" onClick={() => setOpen((o) => !o)}>
        {open ? 'Hide candidates' : `Compare candidates (${roles.length})`}
      </Button>
      {open ? (
        <div className="mt-2 flex flex-col gap-3 text-xs">
          {result.chunks.map((chunk) => (
            <div key={chunk.index} className="rounded-md border border-neutral-200 p-2">
              {result.chunks.length > 1 ? (
                <p className="mb-1 font-medium">Chunk {chunk.index + 1}</p>
              ) : null}
              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                {result.candidates
                  .filter((c) => c.chunkIndex === chunk.index)
                  .map((c) => (
                    <div key={c.role} className="rounded bg-neutral-50 p-2">
                      <p className="mb-1 font-medium">
                        {c.role.replace('translator', 'Candidate ')}{' '}
                        <span className="font-normal text-neutral-500">{c.model}</span>
                      </p>
                      <pre className="whitespace-pre-wrap">{c.text}</pre>
                    </div>
                  ))}
              </div>
              {result.judgments
                .filter((j) => j.chunkIndex === chunk.index)
                .map((j) => (
                  <p key={j.model} className="mt-2 text-neutral-700">
                    Judge picked <span className="font-medium">{j.winner}</span>: {j.rationale}
                  </p>
                ))}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
