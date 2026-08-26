/**
 * PullFromOrders — „Importuj z zamówień": zamówienia wchodzą do planu dnia.
 *
 * Plan powstaje po połowie z zamówień i z decyzji szefa, więc oba wejścia mają
 * być wygodne — ale panel otwiera się NA ŻĄDANIE, a nie zajmuje stałej kolumny.
 *
 * Układ pogrupowany klientami (25.08.2026, zgłoszenie z biura): kilka zamówień
 * dawało ponad pięćdziesiąt pozycji na płaskiej liście i „nie dało się połapać,
 * co jest co". Planista myśli klientami — najpierw DLA KOGO dziś produkuje,
 * potem CO — więc tak samo układa się lista, z sumą kilogramów przy każdym
 * kliencie i jednym kliknięciem na całą grupę.
 *
 * Nic NIE jest zaznaczone z góry. Wciągnięcie pięćdziesięciu pozycji przez
 * przypadek to plan do ręcznego rozbierania; wybranie ich świadomie to jedno
 * kliknięcie w „Zaznacz wszystkie".
 *
 * Pokazujemy RESZTĘ do wyprodukowania, nie ilość z zamówienia — pozycja
 * zrobiona w połowie nie może wjechać w plan drugi raz w całości.
 */
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { cn, fmtKgTrim } from '@/lib/utils'
import { X, Download, Search } from 'lucide-react'
import {
  groupPullableByClient, pullableLines, toPlanLines,
  type OrderLite, type ProgressByLine, type PullableLine,
} from '../pullFromOrders'
import type { PlanLine } from '../planLineModel'

interface RecipeLite { id: string; name: string }

export function PullFromOrders({ orders, progress, recipes = [], onPull, onClose }: {
  orders:   OrderLite[]
  progress: ProgressByLine
  /** Nazwy receptur — wiersz ma mówić CO produkujemy, nie tylko dla kogo. */
  recipes?: RecipeLite[]
  onPull:   (lines: PlanLine[]) => void
  onClose:  () => void
}) {
  const dostepne = useMemo(() => pullableLines(orders, progress), [orders, progress])
  const [zazn, setZazn] = useState<Set<string>>(() => new Set())
  const [szukaj, setSzukaj] = useState('')

  const nazwaReceptury = (id: string) => recipes.find(r => r.id === id)?.name ?? ''

  // Filtr obejmuje klienta, numer zamówienia i recepturę — trzy rzeczy, po
  // których planista szuka. Zaznaczenia NIE czyścimy: schowana pozycja
  // zostaje wybrana i wjedzie do planu.
  const widoczne = useMemo(() => {
    const q = szukaj.trim().toLowerCase()
    if (!q) return dostepne
    return dostepne.filter(l =>
      `${l.clientName} ${l.orderNo} ${nazwaReceptury(l.recipeId)}`.toLowerCase().includes(q))
  }, [dostepne, szukaj, recipes])

  const grupy = useMemo(() => groupPullableByClient(widoczne), [widoczne])

  const wybrane = dostepne.filter(l => zazn.has(l.lineId))
  const sumaKg = wybrane.reduce((s, l) => s + l.kg, 0)

  const przelacz = (id: string) => setZazn(prev => {
    const n = new Set(prev)
    n.has(id) ? n.delete(id) : n.add(id)
    return n
  })

  const przelaczGrupe = (lines: PullableLine[]) => setZazn(prev => {
    const n = new Set(prev)
    const wszystkie = lines.every(l => n.has(l.lineId))
    for (const l of lines) wszystkie ? n.delete(l.lineId) : n.add(l.lineId)
    return n
  })

  const przelaczWszystkie = () => setZazn(prev => {
    const wszystkie = widoczne.every(l => prev.has(l.lineId))
    if (wszystkie) {
      const n = new Set(prev)
      for (const l of widoczne) n.delete(l.lineId)
      return n
    }
    return new Set([...prev, ...widoczne.map(l => l.lineId)])
  })

  const znacznik = (stan: 'pusty' | 'czesc' | 'pelny') => (
    <span className={cn(
      'flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[2px] border text-[9px] leading-none',
      stan === 'pelny' ? 'border-ink bg-ink text-white'
        : stan === 'czesc' ? 'border-ink text-ink' : 'border-surface-4',
    )}>
      {stan === 'pelny' ? '✓' : stan === 'czesc' ? '–' : ''}
    </span>
  )

  return (
    <aside className="flex w-[360px] shrink-0 flex-col border border-surface-4 bg-white shadow-card"
      data-testid="panel-zamowien">
      <header className="flex items-center gap-2 border-b border-surface-3 bg-surface-2 px-3 py-1.5">
        <span className="font-display text-[9.5px] font-bold uppercase tracking-[0.14em] text-ink-3">
          Importuj z zamówień
        </span>
        <button onClick={onClose} className="ml-auto text-ink-4 hover:text-ink" title="Zamknij">
          <X size={14} />
        </button>
      </header>

      <div className="flex items-center gap-2 border-b border-surface-3 px-3 py-1.5">
        <div className="relative flex-1">
          <Search size={12} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-ink-4" />
          <input data-testid="szukaj" value={szukaj} onChange={e => setSzukaj(e.target.value)}
            placeholder="klient, zamówienie, receptura"
            className="h-7 w-full rounded-[3px] border border-surface-4 pl-6 pr-2 text-[12px] outline-none focus:border-ink" />
        </div>
        {widoczne.length > 0 && (
          <button type="button" data-testid="zaznacz-wszystkie" onClick={przelaczWszystkie}
            className="shrink-0 text-[11px] font-semibold text-ink underline underline-offset-2">
            {widoczne.every(l => zazn.has(l.lineId)) ? 'Odznacz wszystkie' : 'Zaznacz wszystkie'}
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {dostepne.length === 0 && (
          <p className="py-6 text-center text-[11.5px] text-ink-4">
            Nie ma potwierdzonych zamówień z niezrealizowanymi pozycjami.
          </p>
        )}
        {dostepne.length > 0 && grupy.length === 0 && (
          <p className="py-6 text-center text-[11.5px] text-ink-4">
            Nic nie pasuje do „{szukaj}".
          </p>
        )}

        {grupy.map(g => {
          const zaznaczonych = g.lines.filter(l => zazn.has(l.lineId)).length
          const stan = zaznaczonych === 0 ? 'pusty' : zaznaczonych === g.lines.length ? 'pelny' : 'czesc'
          return (
            <div key={g.clientId} data-testid={`grupa-${g.clientId}`}>
              {/* Nagłówek klienta przyklejony przy przewijaniu — przy pięćdziesięciu
                  pozycjach bez tego nie wiadomo, czyje wiersze się właśnie ogląda. */}
              <div className="sticky top-0 z-10 flex items-center gap-2 border-y border-surface-3 bg-surface-2 px-3 py-1">
                <button type="button" data-testid={`grupa-zaznacz-${g.clientId}`}
                  onClick={() => przelaczGrupe(g.lines)}
                  className="flex min-w-0 items-center gap-2 text-left">
                  {znacznik(stan)}
                  <span className="truncate text-[12.5px] font-bold text-ink">{g.clientName}</span>
                </button>
                <span data-testid={`grupa-suma-${g.clientId}`}
                  className="ml-auto shrink-0 font-mono text-[11.5px] tabular-nums text-ink-3">
                  {g.pozycji} poz. · {fmtKgTrim(g.kg)} kg
                </span>
              </div>

              {g.lines.map(l => {
                const wybrana = zazn.has(l.lineId)
                return (
                  <button key={l.lineId} type="button" data-testid={`pozycja-${l.lineId}`}
                    onClick={() => przelacz(l.lineId)}
                    className={cn(
                      'flex w-full items-center gap-2 border-b border-surface-2 px-3 py-1.5 text-left last:border-b-0',
                      wybrana ? 'bg-surface-2' : 'hover:bg-surface-2',
                    )}>
                    {znacznik(wybrana ? 'pelny' : 'pusty')}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] font-semibold text-ink">
                        {nazwaReceptury(l.recipeId) || '—'}
                      </span>
                      <span className="block font-mono text-[10.5px] text-ink-4">{l.orderNo}</span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block font-mono text-[12.5px] font-bold tabular-nums text-ink">
                        {l.qtyRemaining}×{fmtKgTrim(l.kgPerUnit)}
                      </span>
                      <span className="block font-mono text-[11px] tabular-nums text-ink-3">
                        {fmtKgTrim(l.kg)} kg
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
          )
        })}
      </div>

      <footer className="flex items-center gap-2 border-t border-surface-3 px-3 py-2">
        <span data-testid="stopka" className="font-mono text-[12px] font-semibold tabular-nums text-ink">
          {wybrane.length === 0
            ? 'nic nie wybrano'
            : `${wybrane.length} poz. · ${fmtKgTrim(sumaKg)} kg`}
        </span>
        <Button size="sm" data-testid="importuj" className="ml-auto h-7 gap-1 text-[11.5px]"
          disabled={wybrane.length === 0}
          onClick={() => { onPull(toPlanLines(wybrane)); onClose() }}>
          <Download size={12} />
          Importuj
        </Button>
      </footer>
    </aside>
  )
}
