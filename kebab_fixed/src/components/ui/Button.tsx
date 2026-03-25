import { cn } from '@/lib/utils'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary'|'secondary'|'ghost'|'danger'
  size?:    'sm'|'md'|'lg'
  loading?: boolean
  icon?:    React.ReactNode
  fullWidth?: boolean
}

const V = {
  primary:   'bg-brand text-white hover:bg-brand-dark border border-brand/20 shadow-btn disabled:opacity-50',
  secondary: 'bg-white text-ink-2 border border-surface-4 hover:border-surface-5 hover:bg-surface-2 shadow-btn disabled:opacity-50',
  ghost:     'bg-transparent text-ink-3 border border-transparent hover:bg-surface-3 hover:text-ink-2 disabled:opacity-50',
  danger:    'bg-danger text-white hover:bg-red-700 border border-red-700/20 shadow-btn disabled:opacity-50',
}

const S = {
  sm: 'h-8  px-3   text-xs  gap-1.5 rounded',
  md: 'h-9  px-4   text-sm  gap-2   rounded-md',
  lg: 'h-10 px-5   text-base gap-2  rounded-md',
}

export function Button({
  variant = 'primary', size = 'md', loading, icon, fullWidth,
  children, className, disabled, ...rest
}: ButtonProps) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center font-medium transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40',
        V[variant], S[size],
        fullWidth && 'w-full',
        className,
      )}
      disabled={disabled || loading}
      {...rest}
    >
      {loading
        ? <span className="w-3.5 h-3.5 border-2 border-current/30 border-t-current rounded-full animate-spin flex-shrink-0" />
        : icon && <span className="flex-shrink-0">{icon}</span>
      }
      {children}
    </button>
  )
}
