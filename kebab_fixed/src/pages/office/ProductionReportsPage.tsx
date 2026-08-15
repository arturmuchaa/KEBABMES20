import { useOtworzDokument } from '@/lib/otworzDokument'
/**
 * Zalecenia produkcyjne (karta 2.5.1) — lista do druku.
 *
 * Dzień produkcji × receptura = jedna karta. Dokument składa się z danych,
 * więc pojawia się tu sam, gdy tylko dzień zostanie zamknięty — nic nie
 * trzeba „generować".
 */
import { useState } from 'react'
import { FileText, Printer, ChevronDown, ChevronUp } from 'lucide-react'
import { useApi } from '@/hooks/useApi'
import { productionReportsApi } from '@/lib/apiClient'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { fmtDatePl, fmtKg } from '@/lib/utils'

export function ProductionReportsPage() {
  const otworz = useOtworzDokument()
  const { data, loading } = useApi(() => productionReportsApi.days(60))
  const [open, setOpen] = useState<string | null>(null)
  const dni: any[] = data ?? []

  function drukuj(day: string, recipeId: string) {
    otworz(`/office/zalecenie-produkcyjne/druk?data=${day}&receptura=${recipeId}`)
  }

  return (
    <div className="space-y-4 animate-fade-in">
      <div>
        <h1 className="text-lg font-bold text-ink">Zalecenia produkcyjne</h1>
        <p className="text-[12px] text-muted-foreground mt-0.5">
          Karta 2.5.1 do instrukcji 2.5 — raport z realizacji produkcji.
          Jedna karta na recepturę z danego dnia.
        </p>
      </div>

      {loading ? (
        <div className="space-y-2">{[1, 2, 3].map(i => <Skeleton key={i} className="h-16 w-full" />)}</div>
      ) : dni.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">
          Brak zamkniętych dni produkcji — karty pojawią się po zamknięciu pierwszego.
        </CardContent></Card>
      ) : (
        <div className="rounded-lg border bg-background divide-y">
          {dni.map(d => {
            const rozwiniety = open === d.planDate
            const kg = d.recipes.reduce((s: number, r: any) => s + Number(r.kg || 0), 0)
            return (
              <div key={d.planDate}>
                <button
                  onClick={() => setOpen(rozwiniety ? null : d.planDate)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-muted/40 transition-colors text-left"
                >
                  <FileText size={15} className="text-muted-foreground" />
                  <span className="font-bold text-[13px]">{fmtDatePl(d.planDate)}</span>
                  <span className="text-[11px] text-muted-foreground">
                    {d.recipes.length} {d.recipes.length === 1 ? 'karta' : 'karty'} · {fmtKg(kg, 0)} kg
                  </span>
                  <span className="ml-auto text-muted-foreground">
                    {rozwiniety ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                  </span>
                </button>
                {rozwiniety && (
                  <div className="bg-muted/20 border-t divide-y">
                    {d.recipes.map((r: any) => (
                      <div key={r.recipeId} className="flex items-center gap-3 px-4 py-2 text-[12px]">
                        <code className="font-mono font-bold text-primary">{r.cardNo}</code>
                        <span className="font-semibold">{r.recipeName}</span>
                        <span className="text-muted-foreground">
                          {r.qty} szt · {fmtKg(r.kg, 0)} kg
                        </span>
                        <button
                          onClick={() => drukuj(d.planDate, r.recipeId)}
                          className="ml-auto inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-surface-4 bg-white hover:bg-surface-2 font-semibold"
                        >
                          <Printer size={13} /> Drukuj kartę
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
