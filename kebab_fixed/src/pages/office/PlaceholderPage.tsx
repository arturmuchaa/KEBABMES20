import { Construction } from 'lucide-react'
import { Card, CardContent, CardDescription, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

interface PlaceholderPageProps {
  title:        string
  phase?:       string
  icon?:        string
  description?: string
}

export function PlaceholderPage({ title, phase = 'Faza 2', icon = '🚧', description }: PlaceholderPageProps) {
  return (
    <div className="flex items-center justify-center min-h-[60vh] animate-fade-in">
      <Card className="text-center max-w-md w-full py-12">
        <CardContent className="pt-6 space-y-4">
          <div className="text-5xl">{icon}</div>
          <Badge variant="warning" className="gap-1.5">
            <Construction size={12} />
            {phase} — W przygotowaniu
          </Badge>
          <CardTitle className="text-lg">{title}</CardTitle>
          <CardDescription className="leading-relaxed">
            {description ?? 'Ten moduł zostanie zaimplementowany w kolejnym etapie. Architektura systemu jest gotowa na rozszerzenie bez refaktoryzacji.'}
          </CardDescription>
          <Card className="bg-muted/40 border-transparent text-left">
            <CardContent className="px-4 py-3 space-y-1">
              <CardTitle className="text-xs text-muted-foreground mb-2">Zaplanowane endpointy API:</CardTitle>
              <CardDescription className="font-mono text-xs">✓ Schema Prisma gotowa</CardDescription>
              <CardDescription className="font-mono text-xs">✓ Moduł NestJS przygotowany</CardDescription>
              <CardDescription className="font-mono text-xs">○ Implementacja logiki biznesowej</CardDescription>
              <CardDescription className="font-mono text-xs">○ Integracja z frontendem</CardDescription>
            </CardContent>
          </Card>
        </CardContent>
      </Card>
    </div>
  )
}
