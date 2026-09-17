import type { ButtonHTMLAttributes, FC, ReactNode } from 'react'

type Variant = 'primary' | 'secondary' | 'weak' | 'danger' | 'ghost'
type Size = 'sm' | 'md' | 'lg'

/* Button geometry follows the TDS scale: small 32px / 8px radius, medium 38px / 10px, large 48px / 14px. */
const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-primary text-on-primary hover:bg-primary-strong active:bg-primary-strong disabled:bg-neutral-300 disabled:text-white',
  secondary:
    'border border-line bg-canvas text-fg hover:bg-neutral-50 active:bg-neutral-100 disabled:text-neutral-400',
  weak: 'bg-weak-bg text-weak-fg hover:bg-[#dbeafe] active:bg-[#cfe3fd] disabled:opacity-60',
  danger: 'border border-red-200 bg-canvas text-danger hover:bg-red-50',
  ghost: 'text-body hover:bg-neutral-100',
}
const SIZES: Record<Size, string> = {
  sm: 'h-8 rounded-lg px-3 text-[13px]',
  md: 'h-[38px] rounded-[10px] px-4 text-sm',
  lg: 'h-12 rounded-[14px] px-5 text-[17px]',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  loading?: boolean
}

export const Button: FC<ButtonProps> = ({
  variant = 'secondary',
  size = 'md',
  loading = false,
  className = '',
  children,
  disabled,
  ...rest
}) => (
  <button
    type="button"
    aria-busy={loading || undefined}
    disabled={disabled || loading}
    className={`inline-flex items-center justify-center gap-2 whitespace-nowrap font-semibold transition disabled:cursor-not-allowed ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
    {...rest}
  >
    {loading ? <Spinner className="h-4 w-4 border-current border-t-transparent" /> : null}
    {children}
  </button>
)

export const Spinner: FC<{ className?: string }> = ({ className = '' }) => (
  <span
    role="status"
    aria-label="Working"
    className={`inline-block h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent ${className}`}
  />
)

export interface FieldProps {
  label: string
  hint?: string
  children: ReactNode
}

export const Field: FC<FieldProps> = ({ label, hint, children }) => (
  // biome-ignore lint/a11y/noLabelWithoutControl: the control is passed as children and wrapped by the label
  <label className="flex flex-col gap-1 text-sm">
    <span className="font-semibold text-body">{label}</span>
    {children}
    {hint ? <span className="text-xs text-muted">{hint}</span> : null}
  </label>
)

export const inputClass =
  'rounded-[10px] border border-line bg-canvas px-3 py-2 text-sm text-fg placeholder:text-muted focus:border-primary focus:outline-none disabled:bg-neutral-100'

export const Card: FC<{
  title?: string
  children: ReactNode
  className?: string
  actions?: ReactNode
}> = ({ title, children, className = '', actions }) => (
  <section className={`rounded-2xl border border-line bg-canvas p-5 ${className}`}>
    {title || actions ? (
      <div className="mb-4 flex items-center justify-between gap-3">
        {title ? <h2 className="text-lg font-semibold">{title}</h2> : <span />}
        {actions}
      </div>
    ) : null}
    {children}
  </section>
)

export interface SegmentOption<T extends string> {
  value: T
  label: string
  hint?: string
}

/** Single-choice control for a handful of options; extension over TDS (no documented segmented control). */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: SegmentOption<T>[]
  value: T
  onChange: (value: T) => void
  label: string
}): ReactNode {
  return (
    <fieldset
      aria-label={label}
      className="inline-flex rounded-[10px] border-0 bg-neutral-100 p-0.5"
    >
      {options.map((o) => {
        const on = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            title={o.hint}
            onClick={() => onChange(o.value)}
            className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${on ? 'bg-canvas text-fg shadow-sm' : 'text-muted hover:text-body'}`}
          >
            {o.label}
          </button>
        )
      })}
    </fieldset>
  )
}

export const Chip: FC<{
  active?: boolean
  onClick?: () => void
  children: ReactNode
  title?: string
  tone?: 'default' | 'success' | 'warning'
}> = ({ active = false, onClick, children, title, tone = 'default' }) => {
  const toneClass =
    tone === 'success'
      ? 'border-success/40 bg-success-bg text-success'
      : tone === 'warning'
        ? 'border-warning/40 bg-warning-bg text-warning'
        : active
          ? 'border-primary bg-weak-bg text-weak-fg'
          : 'border-line bg-canvas text-body hover:bg-neutral-50'
  const base = `inline-flex items-center gap-1 rounded-full border px-3 py-1 text-[13px] font-medium ${toneClass}`
  return onClick ? (
    <button type="button" aria-pressed={active} title={title} onClick={onClick} className={base}>
      {children}
    </button>
  ) : (
    <span title={title} className={base}>
      {children}
    </span>
  )
}

export const basePath = (path: string): string =>
  `${import.meta.env.BASE_URL.replace(/\/$/, '')}${path}`

export const formatUsd = (usd: number): string =>
  usd < 0.01 ? `$${usd.toFixed(5)}` : `$${usd.toFixed(3)}`
