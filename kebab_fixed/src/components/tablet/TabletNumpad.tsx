import { cn } from '@/lib/utils'
import { Delete } from 'lucide-react'

interface TabletNumpadProps {
  value: string
  onChange: (v: string) => void
  label?: string
  unit?: string
  max?: number
}

export function TabletNumpad({ value, onChange, label, unit = 'kg', max }: TabletNumpadProps) {
  const press = (key: string) => {
    if (key === 'DEL') { onChange(value.slice(0, -1) || '0'); return }
    if (key === 'CLR') { onChange('0'); return }
    if (key === '.' && value.includes('.')) return
    const next = value === '0' && key !== '.' ? key : value + key
    if (max !== undefined && parseFloat(next) > max) return
    // max 2 decimals
    const parts = next.split('.')
    if (parts[1] && parts[1].length > 3) return
    onChange(next)
  }

  const keys = ['7','8','9','4','5','6','1','2','3','CLR','0','.']

  return (
    <div className="flex flex-col items-center gap-4 w-full">
      {label && <div className="text-sm font-bold text-ink-3 uppercase tracking-wide">{label}</div>}

      {/* Display */}
      <div className="w-full bg-surface-2 border-2 border-surface-4 rounded-xl flex items-center justify-center gap-2 py-4 min-h-[80px]">
        <span className="text-4xl font-bold font-mono text-ink tracking-tight">{value}</span>
        <span className="text-xl text-ink-3 font-semibold">{unit}</span>
      </div>

      {/* Keys */}
      <div className="grid grid-cols-3 gap-2 w-full">
        {keys.map(k => (
          <button
            key={k}
            onClick={() => press(k)}
            className={cn(
              'h-14 rounded-xl font-bold text-lg transition-all active:scale-95 select-none',
              k === 'CLR'
                ? 'bg-danger-light text-danger border border-danger-border'
                : 'bg-white border border-surface-4 text-ink hover:bg-surface-2 shadow-sm',
            )}
          >
            {k}
          </button>
        ))}
        {/* Del button */}
        <button
          onClick={() => press('DEL')}
          className="h-14 col-span-3 rounded-xl font-bold text-sm bg-surface-3 border border-surface-4 text-ink-3 flex items-center justify-center gap-2 transition-all active:scale-95"
        >
          <Delete size={18} /> Usuń ostatni
        </button>
      </div>
    </div>
  )
}
