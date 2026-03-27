import { cva, type VariantProps } from 'class-variance-authority'
import { Slot } from '@radix-ui/react-slot'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  [
    'inline-flex items-center justify-center font-medium select-none',
    'transition-all duration-150',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:ring-offset-1',
    'disabled:opacity-50 disabled:pointer-events-none',
  ].join(' '),
  {
    variants: {
      variant: {
        primary:   'bg-brand text-white hover:bg-brand-dark shadow-sm border border-brand/20 active:scale-[.98]',
        secondary: 'bg-white text-ink border border-surface-4 hover:bg-surface-3 hover:border-surface-5 shadow-sm active:scale-[.98]',
        ghost:     'bg-transparent text-ink-3 hover:bg-surface-3 hover:text-ink border border-transparent',
        danger:    'bg-danger text-white hover:bg-red-700 shadow-sm border border-danger/20 active:scale-[.98]',
        outline:   'bg-transparent text-brand border border-brand/40 hover:bg-brand-light hover:border-brand',
        success:   'bg-success text-white hover:bg-green-700 shadow-sm border border-success/20 active:scale-[.98]',
        // For the desktop toolbar — flat, icon+text, compact
        toolbar:   'bg-transparent text-ink-3 hover:bg-surface-3 hover:text-ink border border-transparent rounded-md',
      },
      size: {
        xs: 'h-6  px-2   text-[11px] gap-1   rounded',
        sm: 'h-7  px-2.5 text-[12px] gap-1.5 rounded',
        md: 'h-8  px-3   text-[13px] gap-2   rounded',
        lg: 'h-9  px-4   text-[13px] gap-2   rounded-lg',
        xl: 'h-10 px-5   text-sm     gap-2   rounded-lg',
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
