import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mes-accent focus-visible:ring-offset-2 focus-visible:ring-offset-mes-bg disabled:pointer-events-none disabled:opacity-40 active:scale-[0.98]',
  {
    variants: {
      variant: {
        default:     'bg-mes-accent text-white hover:bg-mes-accent-h shadow-mes-sm',
        destructive: 'bg-mes-danger text-white hover:bg-red-700 shadow-mes-sm',
        outline:     'border border-mes-border bg-transparent text-white hover:bg-mes-elevated hover:border-mes-accent',
        ghost:       'text-slate-300 hover:bg-mes-elevated hover:text-white',
        secondary:   'bg-mes-elevated border border-mes-border text-slate-200 hover:bg-mes-muted',
        success:     'bg-mes-success text-white hover:bg-emerald-700 shadow-mes-sm',
        warning:     'bg-mes-warning text-white hover:bg-amber-600 shadow-mes-sm',
        link:        'text-mes-accent-l underline-offset-4 hover:underline p-0 h-auto',
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm:      'h-7 px-3 text-xs',
        lg:      'h-11 px-6 text-base',
        xl:      'h-14 px-8 text-lg font-semibold',  // operator-sized
        icon:    'h-9 w-9',
        'icon-sm':'h-7 w-7',
      },
    },
    defaultVariants: {
      variant: 'default',
      size:    'default',
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
  loading?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading, children, disabled, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={disabled || loading}
        {...props}
      >
        {loading && (
          <svg className="animate-spin h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        )}
        {children}
      </Comp>
    )
  }
)
Button.displayName = 'Button'

export { Button, buttonVariants }
