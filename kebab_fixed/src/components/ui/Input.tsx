import { cn } from '@/lib/utils'
import { forwardRef } from 'react'

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string; error?: string; hint?: string; large?: boolean; tablet?: boolean
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, hint, large, tablet, className, id, ...props }, ref) => {
    const inputId = id || label?.toLowerCase().replace(/\s+/g, '-')
    return (
      <div className="flex flex-col gap-1.5 w-full">
        {label && (
          <label htmlFor={inputId} className={cn(
            'font-semibold uppercase tracking-wide text-slate-900-3',
            tablet ? 'text-sm' : 'text-[11px]'
          )}>
            {label}
          </label>
        )}
        <input
          id={inputId}
          ref={ref}
          className={cn(
            'w-full rounded-lg border bg-white text-slate-900 font-medium',
            'transition-colors placeholder:text-slate-900-4',
            'focus:outline-none focus:ring-2 focus:ring-slate-900/20 focus:border-slate-900',
            'disabled:opacity-50 disabled:bg-slate-50',
            large  && 'h-16 text-2xl font-bold text-center font-mono',
            tablet && 'h-16 text-xl font-bold px-5',
            !large && !tablet && 'h-9 text-sm px-3',
            error  ? 'border-danger focus:ring-danger/25' : 'border-slate-200',
            className,
          )}
          {...props}
        />
        {error && <p className="text-[11px] text-danger font-medium">{error}</p>}
        {hint && !error && <p className="text-[11px] text-slate-900-4">{hint}</p>}
      </div>
    )
  }
)
Input.displayName = 'Input'

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string; error?: string; hint?: string; tablet?: boolean
  options: { value: string; label: string }[]; placeholder?: string
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, error, hint, tablet, options, placeholder, className, id, ...props }, ref) => {
    const inputId = id || label?.toLowerCase().replace(/\s+/g, '-')
    return (
      <div className="flex flex-col gap-1.5 w-full">
        {label && (
          <label htmlFor={inputId} className={cn(
            'font-semibold uppercase tracking-wide text-slate-900-3',
            tablet ? 'text-sm' : 'text-[11px]'
          )}>
            {label}
          </label>
        )}
        <select
          id={inputId}
          ref={ref}
          className={cn(
            'w-full rounded-lg border bg-white text-slate-900 font-medium appearance-none cursor-pointer',
            'transition-colors focus:outline-none focus:ring-2 focus:ring-brand/25 focus:border-brand',
            tablet ? 'h-16 text-xl font-bold px-5' : 'h-9 text-sm px-3',
            error ? 'border-danger' : 'border-slate-200',
            className,
          )}
          {...props}
        >
          {placeholder && <option value="">{placeholder}</option>}
          {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {error && <p className="text-[11px] text-danger font-medium">{error}</p>}
        {hint && !error && <p className="text-[11px] text-slate-900-4">{hint}</p>}
      </div>
    )
  }
)
Select.displayName = 'Select'

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string; error?: string
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ label, error, className, id, ...props }, ref) => {
    const inputId = id || label?.toLowerCase().replace(/\s+/g, '-')
    return (
      <div className="flex flex-col gap-1.5 w-full">
        {label && (
          <label htmlFor={inputId} className="text-[11px] font-semibold uppercase tracking-wide text-slate-900-3">
            {label}
          </label>
        )}
        <textarea
          id={inputId}
          ref={ref}
          rows={3}
          className={cn(
            'w-full px-3 py-2.5 rounded-lg border bg-white text-sm text-slate-900 font-medium resize-none',
            'placeholder:text-slate-900-4 focus:outline-none focus:ring-2 focus:ring-brand/25 focus:border-brand transition-colors',
            error ? 'border-danger' : 'border-slate-200',
            className,
          )}
          {...props}
        />
        {error && <p className="text-[11px] text-danger font-medium">{error}</p>}
      </div>
    )
  }
)
Textarea.displayName = 'Textarea'
