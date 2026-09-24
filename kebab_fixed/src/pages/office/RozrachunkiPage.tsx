/**
 * Rozrachunki z odbiorcami — zestawienie zbiorcze.
 *
 * Zastępuje arkusz `PODSUMOWANIE` z `PŁATNOŚCI08.04.xlsx`, który u nich jest
 * w całości `#REF!` — sprzedane kg, łączny obrót i zaległości nie liczą się
 * tam wcale.
 *
 * Kurs do sumy jest POLEM, nie stałą: w ich arkuszu siedzi na osobnej
 * zakładce (`Tabela 1`, 4,2668) i bywa wklepywany ręcznie. Skoro suma
 * zaległości zależy od kursu, kurs ma być widoczny obok tej sumy —
 * inaczej nikt nie wie, po czym ją policzono.
 */
import { useState } from 'react'
import { useApi } from '@/hooks/useApi'
import { rozrachunkiApi, fxApi } from '@/lib/api'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { RefreshCw, Wallet } from 'lucide-react'
import { KartaRozrachunkow } from '@/features/rozrachunki/KartaRozrachunkow'
import { fmtSaldo, stanSalda, sumaZaleglosci } from '@/features/rozrachunki/rozrachunkiView'

const KOLOR: Record<string, string> = {
  dlug: 'text-red-700',
  nadplata: 'text-green-700',
  zero: 'text-muted-foreground',
}

export function RozrachunkiPage() {
  const { data, loading } = useApi(() => rozrachunkiApi.lista())
  const [kursStr, setKursStr] = useState('')
  const [wybrany, setWybrany] = useState<string | null>(null)
  const [pobiera, setPobiera] = useState(false)

  const wiersze = data ?? []
  const kurs = Number(kursStr.replace(',', '.')) || 0
  const suma = sumaZaleglosci(wiersze, kurs)
  const sawEuro = wiersze.some(w => w.waluta === 'EUR')

  function pobierzKurs() {
    setPobiera(true)
    fxApi.eurRate()
      .then(d => { if (d?.rate) setKursStr(String(d.rate)) })
      .catch(() => { /* kurs można wpisać ręcznie */ })
      .finally(() => setPobiera(false))
  }

  return (
    <div className="animate-fade-in space-y-3">
      <Card className="p-3">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <div className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
              Zaległości razem
            </div>
            <div className="text-2xl font-bold tabular-nums text-red-700">
              {fmtSaldo(suma, 'PLN')}
            </div>
          </div>
          <div className="ml-auto flex items-end gap-2">
            <label className="text-[11px] text-muted-foreground">
              Kurs EUR
              <div className="flex items-center gap-1">
                <Input value={kursStr} onChange={e => setKursStr(e.target.value)}
                       placeholder="4,2668" className="h-8 w-24 text-sm" />
                <Button variant="outline" size="icon" className="h-8 w-8"
                        title="Pobierz kurs z NBP" disabled={pobiera}
                        onClick={pobierzKurs}>
                  <RefreshCw size={13} />
                </Button>
              </div>
            </label>
          </div>
        </div>
        {sawEuro && kurs <= 0 && (
          /* Bez kursu pozycje w euro są POMIJANE, nie zerowane — suma bez
             ostrzeżenia wyglądałaby na kompletną. */
          <div className="mt-1.5 text-[11.5px] text-amber-700">
            Wpisz kurs — do czasu jego podania kontrahenci rozliczani w euro
            nie wchodzą do sumy.
          </div>
        )}
      </Card>

      {loading ? (
        <div className="space-y-2">{[0, 1, 2].map(i => <Skeleton key={i} className="h-9 w-full" />)}</div>
      ) : wiersze.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
          <Wallet size={32} className="opacity-20" />
          <div className="text-sm font-medium">Nikt nie ma włączonego rozliczenia</div>
          <div className="text-xs">
            Włącz je w kartotece kontrahenta — „Rozliczenie w systemie".
          </div>
        </Card>
      ) : (
        <Card className="divide-y">
          {wiersze.map(w => (
            <div key={w.clientId}>
              <button type="button" data-klient={w.clientId}
                onClick={() => setWybrany(wybrany === w.clientId ? null : w.clientId)}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-muted/50">
                <span className="flex-1 text-[13px] font-semibold">{w.name}</span>
                {!w.skonfigurowane && (
                  <span className="text-[11px] text-amber-700">brak salda otwarcia</span>
                )}
                <span className={`font-mono text-[13px] font-bold tabular-nums ${
                  KOLOR[stanSalda(w.saldo)]}`}>
                  {fmtSaldo(w.saldo, w.waluta)}
                </span>
              </button>
              {wybrany === w.clientId && (
                <div className="border-t bg-muted/30">
                  <KartaRozrachunkow clientId={w.clientId} />
                </div>
              )}
            </div>
          ))}
        </Card>
      )}
    </div>
  )
}
