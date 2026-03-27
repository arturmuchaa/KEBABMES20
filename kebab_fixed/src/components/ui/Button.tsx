import { cva, type VariantProps } from 'class-variance-authority'
import { Slot } from '@radix-ui/react-slot'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  [
    'inline-flex items-center justify-center font-medium select-none',
    'transition-all duration-150',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900/30 focus-visible:ring-offset-1',
    'disabled:opacity-40 disabled:pointer-events-none',
  ].join(' '),
  {
    variants: {
      variant: {
        primary:   'bg-slate-900 text-white hover:bg-slate-800 shadow-sm active:scale-[.98]',
        secondary: 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 hover:border-slate-300 shadow-sm active:scale-[.98]',
        ghost:     'bg-transparent text-slate-500 hover:bg-slate-100 hover:text-slate-900 border border-transparent',
        danger:    'bg-red-600 text-white hover:bg-red-700 shadow-sm active:scale-[.98]',
        outline:   'bg-transparent text-slate-700 border border-slate-300 hover:bg-slate-50 hover:border-slate-400',
        success:   'bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm active:scale-[.98]',
        toolbar:   'bg-transparent text-slate-500 hover:bg-slate-100 hover:text-slate-900 border border-transparent rounded-md',
      },
      size: {
        xs: 'h-6  px-2   text-[11px] gap-1   rounded',
        sm: 'h-7  px-2.5 text-[12px] gap-1.5 rounded',
        md: 'h-8  px-3   text-[13px] gap-2   rounded-md',
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
