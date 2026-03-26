import { cn } from '@/lib/utils'

function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'animate-pulse rounded-md bg-mes-muted/60',
        className
      )}
      {...props}
    />
  )
}

export function SkeletonCard() {
  return (
    <div className="rounded-xl border border-mes-border bg-mes-surface p-5 flex items-start gap-4">
      <Skeleton className="h-11 w-11 rounded-lg" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-3 w-20" />
      </div>
    </div>
  )
}

export function SkeletonTable({ rows = 5 }: { rows?: number }) {
  return (
    <div className="rounded-xl border border-mes-border bg-mes-surface overflow-hidden">
      <div className="p-4 border-b border-mes-border">
        <Skeleton className="h-4 w-40" />
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-3 border-b border-mes-border/50 last:border-0">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-32 flex-1" />
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-6 w-16 rounded-full" />
        </div>
      ))}
    </div>
  )
}

export { Skeleton }
