import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Construction } from 'lucide-react'

interface PlaceholderPageProps {
  title:   string
  phase?:  string
  icon?:   string
  description?: string
}

export function PlaceholderPage({ title, phase = 'Faza 2', icon = '🚧', description }: PlaceholderPageProps) {
  return (
    <div className="flex items-center justify-center min-h-[60vh] animate-fade-in">
      <Card className="text-center max-w-md w-full py-12">
        <div className="text-5xl mb-4">{icon}</div>
        <div className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-warn bg-warn-light border border-warn-border px-3 py-1 rounded-full mb-4">
          <Construction size={12} />
          {phase} — W przygotowaniu
        </div>
        <h2 className="text-lg font-bold text-ink mb-2">{title}</h2>
        <p className="text-sm text-ink-3 mb-6 leading-relaxed">
          {description ?? 'Ten moduł zostanie zaimplementowany w kolejnym etapie. Architektura systemu jest gotowa na rozszerzenie bez refaktoryzacji.'}
        </p>
        <div className="bg-surface-2 rounded-lg p-3 text-xs text-ink-3 font-mono text-left space-y-1">
          <div className="font-bold text-ink-2 mb-2">Zaplanowane endpointy API:</div>
          <div>✓ Schema Prisma gotowa</div>
          <div>✓ Moduł NestJS przygotowany</div>
          <div>○ Implementacja logiki biznesowej</div>
          <div>○ Integracja z frontendem</div>
        </div>
      </Card>
    </div>
  )
}
