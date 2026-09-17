import {
  formatContext,
  formatModelPrice,
  groupModels,
  isAliasModel,
  type ModelInfo,
} from '@experttranslate/core'
import {
  type FC,
  type KeyboardEvent,
  useDeferredValue,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'

export interface ModelPickerProps {
  models: ModelInfo[]
  value: string
  onChange: (id: string) => void
  loading?: boolean
  /** Empty means "follow the translator model"; the input then shows a placeholder. */
  allowEmpty?: boolean
  id?: string
}

type Row =
  | { kind: 'header'; key: string; label: string; pinned?: boolean }
  | { kind: 'option'; key: string; model: ModelInfo; index: number }

/**
 * Browse mode (empty query) shows a pinned "Latest major" section then author groups; typing
 * filters every model by id and name. Options are collected in parallel for keyboard navigation.
 */
function buildRows(models: ModelInfo[], q: string): { rows: Row[]; options: ModelInfo[] } {
  const rows: Row[] = []
  const options: ModelInfo[] = []
  const push = (model: ModelInfo): void => {
    rows.push({ kind: 'option', key: model.id, model, index: options.length })
    options.push(model)
  }
  if (!q) {
    const { pinned, groups } = groupModels(models)
    const pinnedIds = new Set(pinned.map((m) => m.id))
    if (pinned.length > 0) {
      rows.push({ kind: 'header', key: '__pinned', label: 'Latest major', pinned: true })
      pinned.forEach(push)
    }
    for (const g of groups) {
      const rest = g.models.filter((m) => !pinnedIds.has(m.id))
      if (rest.length === 0) continue
      rows.push({ kind: 'header', key: g.author, label: g.author })
      rest.forEach(push)
    }
    return { rows, options }
  }
  const filtered = models.filter(
    (m) => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q),
  )
  for (const g of groupModels(filtered, 0).groups) {
    rows.push({ kind: 'header', key: g.author, label: g.author })
    g.models.forEach(push)
  }
  return { rows, options }
}

/**
 * Editable combobox for an OpenRouter model id. The typed text is always a valid value, since the
 * catalog changes constantly; the list is assistance. ArrowDown/Up move, Enter picks, Escape closes.
 */
export const ModelPicker: FC<ModelPickerProps> = ({
  models,
  value,
  onChange,
  loading = false,
  allowEmpty = false,
  id,
}) => {
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(-1)
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listId = useId()
  const deferred = useDeferredValue(value)
  const q = deferred.trim().toLowerCase()
  const { rows, options } = useMemo(() => buildRows(models, q), [models, q])
  const matched = useMemo(() => models.find((m) => m.id === value) ?? null, [models, value])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  // biome-ignore lint/correctness/useExhaustiveDependencies: the highlight resets whenever the visible options change
  useEffect(() => setHighlight(-1), [q, open])

  const choose = (m: ModelInfo): void => {
    onChange(m.id)
    setOpen(false)
    inputRef.current?.focus()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!open) setOpen(true)
      else setHighlight((h) => Math.min(options.length - 1, h + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight((h) => Math.max(0, h - 1))
    } else if (e.key === 'Enter') {
      const pick = options[highlight]
      if (open && pick) {
        e.preventDefault()
        choose(pick)
      }
    } else if (e.key === 'Escape' && open) {
      e.preventDefault()
      setOpen(false)
    }
  }

  const activeId = highlight >= 0 ? `${listId}-opt-${highlight}` : undefined

  return (
    <div ref={rootRef} className="relative">
      <div className="relative">
        <input
          ref={inputRef}
          id={id}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeId}
          autoComplete="off"
          spellCheck={false}
          className="w-full rounded-[10px] border border-line bg-canvas py-2 pr-9 pl-3 font-mono text-[13px] text-fg placeholder:font-sans placeholder:text-muted focus:border-primary focus:outline-none"
          placeholder={allowEmpty ? 'Follow the translator model' : 'vendor/model-id'}
          value={value}
          onChange={(e) => {
            onChange(e.target.value)
            if (!open) setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
        <button
          type="button"
          tabIndex={-1}
          aria-label={open ? 'Close model list' : 'Open model list'}
          className="absolute inset-y-0 right-0 flex items-center px-2.5 text-muted"
          onClick={() => {
            setOpen((o) => !o)
            inputRef.current?.focus()
          }}
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 16 16"
            className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
          >
            <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      {matched ? (
        <span className="mt-1 inline-flex items-center gap-1.5 text-xs text-muted">
          {isAliasModel(matched.id) ? (
            <span className="rounded bg-weak-bg px-1 text-[10px] font-semibold uppercase text-weak-fg">
              alias
            </span>
          ) : null}
          {matched.name}
          {formatModelPrice(matched) ? <span>· {formatModelPrice(matched)}</span> : null}
          {formatContext(matched.contextLength) ? (
            <span>· {formatContext(matched.contextLength)}</span>
          ) : null}
        </span>
      ) : value.trim() && !loading && models.length > 0 ? (
        <span className="mt-1 inline-block text-xs text-warning">
          Not in the catalog; it is sent to OpenRouter as typed.
        </span>
      ) : null}

      {open ? (
        <div
          id={listId}
          role="listbox"
          aria-label="Models"
          className="absolute z-20 mt-1 max-h-80 w-full min-w-[320px] overflow-y-auto rounded-xl border border-line bg-canvas py-1 shadow-lg"
        >
          {loading ? (
            <p className="px-3 py-3 text-xs text-muted">Loading the catalog…</p>
          ) : rows.length === 0 ? (
            <p className="px-3 py-3 text-xs text-muted">
              {models.length === 0
                ? 'No catalog yet: add a key or server first.'
                : `No model matches “${value.trim()}”.`}
            </p>
          ) : (
            rows.map((row) =>
              row.kind === 'header' ? (
                <div
                  key={`h-${row.key}`}
                  role="presentation"
                  className="sticky top-0 flex items-center gap-1 bg-canvas/95 px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted backdrop-blur"
                >
                  {row.pinned ? <span aria-hidden="true">✦</span> : null}
                  {row.label}
                </div>
              ) : (
                <button
                  type="button"
                  key={`o-${row.key}`}
                  id={`${listId}-opt-${row.index}`}
                  role="option"
                  aria-selected={row.index === highlight}
                  className={`flex w-full items-baseline gap-2 px-3 py-1.5 text-left ${row.index === highlight ? 'bg-neutral-100' : 'hover:bg-neutral-50'} ${row.model.id === value ? 'font-semibold' : ''}`}
                  onMouseEnter={() => setHighlight(row.index)}
                  onClick={() => choose(row.model)}
                >
                  <span className="truncate font-mono text-[13px]">{row.model.id}</span>
                  {isAliasModel(row.model.id) ? (
                    <span className="shrink-0 rounded bg-weak-bg px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-weak-fg">
                      alias
                    </span>
                  ) : null}
                  <span className="ml-auto flex shrink-0 items-center gap-2 font-mono text-[11px] text-muted">
                    {formatModelPrice(row.model) ? (
                      <span>{formatModelPrice(row.model)}</span>
                    ) : null}
                    {formatContext(row.model.contextLength) ? (
                      <span>{formatContext(row.model.contextLength)}</span>
                    ) : null}
                  </span>
                </button>
              ),
            )
          )}
        </div>
      ) : null}
    </div>
  )
}
