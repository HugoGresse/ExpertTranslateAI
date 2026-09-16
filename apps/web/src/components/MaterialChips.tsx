import type { FC } from 'react'
import { languageName } from '../data/languages'

export interface MaterialItem {
  id: string
  name: string
  lang?: string | undefined
}

export interface MaterialChipsProps {
  label: string
  emptyHint: string
  items: MaterialItem[]
  selected: string[]
  onToggle: (id: string) => void
}

export const MaterialChips: FC<MaterialChipsProps> = ({
  label,
  emptyHint,
  items,
  selected,
  onToggle,
}) => (
  <div className="mb-3 last:mb-0">
    <p className="mb-1 text-sm font-medium text-neutral-700">{label}</p>
    {items.length === 0 ? <p className="text-xs text-neutral-500">{emptyHint}</p> : null}
    <ul className="flex flex-wrap gap-2">
      {items.map((item) => {
        const active = selected.includes(item.id)
        return (
          <li key={item.id}>
            <button
              type="button"
              aria-pressed={active}
              onClick={() => onToggle(item.id)}
              className={`rounded-full border px-3 py-1 text-sm ${active ? 'border-accent bg-blue-50 text-accent' : 'border-neutral-300 bg-white text-neutral-600'}`}
            >
              {item.name}
              {item.lang ? (
                <span className="ml-1 text-xs opacity-70">{languageName(item.lang)}</span>
              ) : null}
            </button>
          </li>
        )
      })}
    </ul>
  </div>
)
