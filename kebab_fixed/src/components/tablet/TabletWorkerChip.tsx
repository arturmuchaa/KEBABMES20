import { cn } from '@/lib/utils'
import type { User } from '@/types'

export function TabletWorkerChip({ user, selected, onSelect }: {
  user: User; selected: boolean; onSelect: () => void
}) {
  const initials = user.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
  return (
    <button
      onClick={onSelect}
      className={cn(
        'flex items-center gap-3 px-4 py-3 rounded-xl border-2 transition-all active:scale-[.97]',
        selected
          ? 'border-brand bg-brand text-white shadow-md'
          : 'border-surface-4 bg-white text-ink hover:border-brand/40 hover:bg-slate-50',
      )}
    >
      <div className={cn(
        'w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0',
        selected ? 'bg-white/20 text-white' : 'bg-brand-light text-brand',
      )}>
        {initials}
      </div>
      <span className="font-semibold text-sm leading-tight text-left">{user.name}</span>
    </button>
  )
}
