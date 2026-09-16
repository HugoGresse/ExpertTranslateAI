import type { BackTranslation } from '@experttranslate/core'
import { type FC, useState } from 'react'
import { Button } from './ui'

const kindLabel: Record<BackTranslation['deltas'][number]['kind'], string> = {
  loss: 'lost',
  addition: 'added',
  shift: 'shifted',
}

export const BackTranslationCard: FC<{ backTranslation: BackTranslation; sourceText: string }> = ({
  backTranslation,
  sourceText,
}) => {
  const [open, setOpen] = useState(false)
  const major = backTranslation.deltas.filter((d) => d.severity === 'major').length
  return (
    <div className="mt-3">
      <Button variant="ghost" onClick={() => setOpen((o) => !o)}>
        {open
          ? 'Hide back-translation'
          : `Back-translation: ${backTranslation.deltas.length} delta${backTranslation.deltas.length === 1 ? '' : 's'}${major > 0 ? `, ${major} major` : ''}`}
      </Button>
      {open ? (
        <div className="mt-2 text-xs">
          <div className="grid gap-2 md:grid-cols-2">
            <div className="rounded-md border border-neutral-200 p-2">
              <p className="mb-1 font-medium">Original</p>
              <pre className="whitespace-pre-wrap">{sourceText}</pre>
            </div>
            <div className="rounded-md border border-neutral-200 p-2">
              <p className="mb-1 font-medium">
                Back-translated{' '}
                <span className="font-normal text-neutral-500">{backTranslation.model}</span>
              </p>
              <pre className="whitespace-pre-wrap">{backTranslation.text}</pre>
            </div>
          </div>
          {backTranslation.deltas.length === 0 ? (
            <p className="mt-2 text-green-700">No meaning deltas detected.</p>
          ) : (
            <ul className="mt-2 flex flex-col gap-1">
              {backTranslation.deltas.map((d) => (
                <li
                  key={`${d.kind}-${d.source}-${d.back}`}
                  className={`rounded-md border p-2 ${d.severity === 'major' ? 'border-red-300 bg-red-50' : 'border-amber-200 bg-amber-50'}`}
                >
                  <span className="font-medium">
                    {d.severity} · meaning {kindLabel[d.kind]}
                  </span>
                  {d.source ? <span> · “{d.source}”</span> : null}
                  {d.back ? <span className="text-neutral-600"> → “{d.back}”</span> : null}
                  {d.note ? <p className="text-neutral-700">{d.note}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  )
}
