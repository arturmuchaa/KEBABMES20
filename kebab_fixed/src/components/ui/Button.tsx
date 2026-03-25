import { cn } from '@/lib/utils'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary'|'secondary'|'ghost'|'danger'
  size?:    'sm'|'md'|'lg'
  loading?: boolean
  icon?:    React.ReactNode
  fullWidth?: boolean
}

const V = {
  primary:   'bg-brand text-white hover:bg-brand-dark border border-brand-dark disabled:opacity-50',
  secondary: 'bg-white text-ink border border-surface-5 hover:border-surface-4 hover:bg-surface-2 disabled:opacity-50',
  ghost:     'bg-transparent text-ink-2 border border-transparent hover:bg-surface-2 disabled:opacity-50',
  danger:    'bg-red-600 text-white hover:bg-red-700 border border-red-700 disabled:opacity-50',
}

const S = {
  sm: 'h-7 px-2.5 text-[12px] gap-1.5',
  md: 'h-8 px-3 text-[13px] gap-2',
  lg: 'h-9 px-4 text-[13px] gap-2',
}

export function Button({
  variant = 'primary', size = 'md', loading, icon, fullWidth,
  children, className, disabled, ...rest
}: ButtonProps) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center font-medium transition-colors focus:outline-none',
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
