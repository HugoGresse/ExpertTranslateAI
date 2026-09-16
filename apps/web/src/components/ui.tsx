import type { ButtonHTMLAttributes, FC, ReactNode } from 'react'

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost'

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-white hover:bg-blue-700 disabled:bg-neutral-300',
  secondary: 'border border-neutral-300 bg-white hover:bg-neutral-50 disabled:text-neutral-400',
  danger: 'border border-red-300 text-red-700 hover:bg-red-50',
  ghost: 'hover:bg-neutral-100',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
}

export const Button: FC<ButtonProps> = ({ variant = 'secondary', className = '', ...rest }) => (
  <button
    type="button"
    className={`rounded-md px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed ${VARIANTS[variant]} ${className}`}
    {...rest}
  />
)

export interface FieldProps {
  label: string
  hint?: string
  children: ReactNode
}

export const Field: FC<FieldProps> = ({ label, hint, children }) => (
  <label className="flex flex-col gap-1 text-sm">
    <span className="font-medium text-neutral-700">{label}</span>
    {children}
    {hint ? <span className="text-xs text-neutral-500">{hint}</span> : null}
  </label>
)

export const inputClass =
  'rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm focus:border-accent focus:outline-none'

export const Card: FC<{ title?: string; children: ReactNode; className?: string }> = ({
  title,
  children,
  className = '',
}) => (
  <section className={`rounded-lg border border-neutral-200 bg-white p-4 ${className}`}>
    {title ? <h2 className="mb-3 text-base font-semibold">{title}</h2> : null}
    {children}
  </section>
)

export const basePath = (path: string): string =>
  `${import.meta.env.BASE_URL.replace(/\/$/, '')}${path}`

export const formatUsd = (usd: number): string =>
  usd < 0.01 ? `$${usd.toFixed(5)}` : `$${usd.toFixed(3)}`
