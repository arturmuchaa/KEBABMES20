import { cva, type VariantProps } from 'class-variance-authority'
import { Slot } from '@radix-ui/react-slot'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:ring-offset-1 focus-visible:ring-offset-surface-2 disabled:opacity-50 disabled:pointer-events-none select-none',
  {
    variants: {
      variant: {
        primary:   'bg-brand text-white hover:bg-brand-dark border border-brand/20 shadow-sm',
        secondary: 'bg-surface-3 text-ink border border-surface-4 hover:bg-surface-4 hover:border-surface-5',
        ghost:     'bg-transparent text-ink-3 border border-transparent hover:bg-surface-3 hover:text-ink',
        danger:    'bg-danger text-white hover:bg-red-600 border border-danger/20 shadow-sm',
        outline:   'bg-transparent text-ink border border-surface-4 hover:bg-surface-3 hover:text-ink',
        success:   'bg-success text-white hover:bg-green-600 border border-success/20 shadow-sm',
      },
      size: {
        sm: 'h-7 px-2.5 text-[12px] gap-1.5 rounded',
        md: 'h-8 px-3 text-[13px] gap-2 rounded',
        lg: 'h-9 px-4 text-[13px] gap-2 rounded-lg',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  }
)

interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  loading?: boolean
  icon?: React.ReactNode
  fullWidth?: boolean
  asChild?: boolean
}

export function Button({
  variant, size, loading, icon, fullWidth, asChild = false,
  children, className, disabled, ...rest
}: ButtonProps) {
  const Comp = asChild ? Slot : 'button'
  return (
    <Comp
      className={cn(buttonVariants({ variant, size }), fullWidth && 'w-full', className)}
      disabled={disabled || loading}
      {...rest}
    >
      {loading
        ? <span className="w-3.5 h-3.5 border-2 border-current/30 border-t-current rounded-full animate-spin flex-shrink-0" />
        : icon && <span className="flex-shrink-0">{icon}</span>
      }
      {children}
    </Comp>
  )
}

export { buttonVariants }
