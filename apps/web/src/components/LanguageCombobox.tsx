import { type FC, type KeyboardEvent, useEffect, useId, useRef, useState } from 'react'
import { type LanguageOption, languageName, languageTag, searchLanguages } from '../data/languages'
import { inputClass } from './ui'

/** A non-language choice listed above the languages, such as `Auto-detect` or `Any`. */
export interface ExtraOption {
  value: string
  label: string
}

export interface LanguageComboboxProps {
  value: string
  onChange: (value: string) => void
  /** Called on Enter once a language is picked and the list is closed. */
  onSubmit?: () => void
  extraOptions?: ExtraOption[]
  ariaLabel?: string
  placeholder?: string
  className?: string
}

interface Choice {
  value: string
  label: string
  tag?: string
}

const fromLanguage = (l: LanguageOption): Choice => ({
  value: l.code,
  label: l.name,
  tag: languageTag(l.code),
})

/** Choices matching the query: extras whose label matches first, then languages ranked by `searchLanguages`. */
const matchChoices = (query: string, extras: ExtraOption[]): Choice[] => {
  const q = query.trim().toLowerCase()
  const extraChoices = extras.filter((e) => !q || e.label.toLowerCase().includes(q))
  return [...extraChoices, ...searchLanguages(query).map(fromLanguage)]
}

/**
 * A language picker you can type into: the list narrows as you type, arrows move through it and
 * Enter picks the highlighted match, which is the best one until you move. A second Enter submits.
 */
export const LanguageCombobox: FC<LanguageComboboxProps> = ({
  value,
  onChange,
  onSubmit,
  extraOptions = [],
  ariaLabel,
  placeholder = 'Type a language or code',
  className = '',
}) => {
  const listId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState<string | null>(null)
  const [active, setActive] = useState(0)
  const open = query !== null

  const choices = query === null ? [] : matchChoices(query, extraOptions)
  const display = extraOptions.find((e) => e.value === value)?.label ?? languageName(value)

  useEffect(() => {
    if (!open) return
    listRef.current?.children[active]?.scrollIntoView({ block: 'nearest' })
  }, [active, open])

  // Once the list closes on a focused input, select the label so the next keystroke starts a new search.
  useEffect(() => {
    if (!open && document.activeElement === inputRef.current) inputRef.current?.select()
  }, [open])

  const close = (): void => setQuery(null)

  /** Opens the full list with the current value highlighted, so Enter right away keeps it. */
  const openList = (): void => {
    setQuery('')
    setActive(
      Math.max(
        0,
        matchChoices('', extraOptions).findIndex((c) => c.value === value),
      ),
    )
  }

  const pick = (choice: Choice | undefined): void => {
    if (choice) onChange(choice.value)
    close()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!open) {
        openList()
        return
      }
      const step = e.key === 'ArrowDown' ? 1 : -1
      setActive((i) => Math.min(Math.max(i + step, 0), choices.length - 1))
    } else if (e.key === 'Enter' && (open || onSubmit)) {
      e.preventDefault()
      if (open) pick(choices[active])
      else onSubmit?.()
    } else if (e.key === 'Escape' && open) {
      e.preventDefault()
      close()
    }
  }

  return (
    <div className={`relative ${className}`}>
      <input
        ref={inputRef}
        className={`${inputClass} w-full`}
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && choices[active] ? `${listId}-${active}` : undefined}
        autoComplete="off"
        spellCheck={false}
        placeholder={open ? display || placeholder : undefined}
        value={query ?? display}
        onFocus={openList}
        onClick={() => {
          if (!open) openList()
        }}
        onBlur={close}
        onChange={(e) => {
          // While closed the input shows the label, so a new search starts from the typed text alone.
          setQuery(open ? e.target.value : ((e.nativeEvent as InputEvent).data ?? ''))
          setActive(0)
        }}
        onKeyDown={onKeyDown}
      />
      {open ? (
        <div
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={ariaLabel ?? 'Languages'}
          // Keep focus in the input, so its blur does not close the list on a click or a scrollbar drag.
          onMouseDown={(e) => e.preventDefault()}
          className="absolute z-20 mt-1 max-h-64 w-full min-w-56 overflow-y-auto rounded-xl border border-line bg-canvas py-1 text-sm shadow-lg"
        >
          {choices.length === 0 ? (
            <p className="px-3 py-3 text-xs text-muted">No language matches “{query?.trim()}”.</p>
          ) : (
            choices.map((c, i) => (
              <button
                type="button"
                tabIndex={-1}
                key={c.value}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                className={`flex w-full items-baseline gap-2 px-3 py-1.5 text-left ${i === active ? 'bg-neutral-100' : 'hover:bg-neutral-50'} ${c.value === value ? 'font-semibold' : ''}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(c)}
              >
                <span className="w-14 shrink-0 font-mono text-[11px] text-muted">
                  {c.tag ?? ''}
                </span>
                {c.label}
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  )
}
