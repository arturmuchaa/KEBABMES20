/**
 * StockPickerDialog — wybór towaru na dokument WZ (klawisz Insert).
 *
 * Magazyn przeniesiony z ekranu do OKNA: ekran wystawiania ma pokazywać
 * dokument, a nie stan magazynowy. Okno zachowuje wszystko, na czym biuro
 * pracowało — podział ubocznych na frakcje (kości nie mieszają się z
 * grzbietami), „dodaj wszystkie" na całą frakcję i oznaczenie pozycji już
 * dołożonych do dokumentu.
 *
 * Bez kolorowych plakietek: rejestr jest monochromatyczny jak reszta biura
 * po redesignie, kolor zostaje na ostrzeżenia.
 */
import { useMemo, useState } from 'react'
import { Beef, Package, Plus, Search } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

import { fmtKg3 } from '../rowMath'
import { zlozNazweWyrobu } from '../nazwaWyrobu'

/** Frakcje surowca w kolejności, w jakiej biuro ich szuka. */
const GRUPY: { key: string; label: string; match: (b: any) => boolean }[] = [
  { key: 'raw',   label: 'Ćwiartka',  match: b => (b.stock_type || 'raw') === 'raw' },
  { key: 'meat',  label: 'Mięso z/s', match: b => b.stock_type === 'meat' },
  { key: 'backs', label: 'Grzbiety',  match: b => b.stock_type === 'byproduct' && b.name === 'Grzbiety' },
  { key: 'bones', label: 'Kości',     match: b => b.stock_type === 'byproduct' && b.name !== 'Grzbiety' },
]

/** Nazwa wyrobu na liście i na dokumencie.
 *
 *  Rodzaj MUSI stać przed recepturą: „KIRMIZI 25kg" to i KEBAB MIX 95/5,
 *  i KEBAB UDO 100 % — dwa różne produkty, których po wydaniu nie da się
 *  odróżnić na WZ-ce (biuro, 26.08.2026). */
export function fgLabel(g: any): string {
  const base = zlozNazweWyrobu(g.product_type_name, g.recipe_name)
  const kg = Number(g.kg_per_unit || 0)
  return kg > 0 ? `${base} ${fmtKg3(kg)}kg` : base
}

export interface StockPickerDialogProps {
  open: boolean
  onClose: () => void
  fg: any[]
  raw: any[]
  /** Pozycje już dołożone do dokumentu — nie da się ich dodać drugi raz. */
  addedIds: Set<string>
  /** Nazwa wybranego klienta — do komunikatu i przełącznika widoku. */
  clientName?: string
  /** Nazwy, którymi magazyn stempluje tego klienta (pełna i skrócona) —
   *  filtr musi łapać obie, inaczej „brak wyrobów" mimo towaru na stanie. */
  clientAliases?: Set<string>
  onAddFg: (g: any) => void
  onAddRaw: (b: any) => void
  onAddRawMany: (items: any[]) => void
}

export function StockPickerDialog({
  open, onClose, fg, raw, addedIds, clientName = '', clientAliases,
  onAddFg, onAddRaw, onAddRawMany,
}: StockPickerDialogProps) {
  const [tab, setTab] = useState<'fg' | 'raw'>('fg')
  const [query, setQuery] = useState('')
  // Po wybraniu klienta zaczynamy od JEGO wyrobów — przy wystawianiu dla
  // jednego odbiorcy reszta magazynu tylko przeszkadza.
  const [tylkoKlienta, setTylkoKlienta] = useState(true)
  // Typowe wydanie idzie na JEDNĄ frakcję (kierowca przyjeżdża po kości),
  // więc frakcje są klikalne — pusty klucz = całość magazynu.
  const [frakcja, setFrakcja] = useState('')
  const q = query.trim().toLowerCase()

  const maKlienta = !!clientAliases?.size
  const fgFiltered = useMemo(() => (fg ?? []).filter(g => {
    const jegoWyrob = !maKlienta || !tylkoKlienta
      || clientAliases!.has((g.client_name || '').trim().toLowerCase())
    return jegoWyrob
      && (!q || `${g.recipe_name || ''} ${g.product_type_name || ''} ${g.batch_no || ''}`.toLowerCase().includes(q))
  }), [fg, q, maKlienta, tylkoKlienta, clientAliases])

  /** Po samej szukajce — z tego liczymy liczniki frakcji, żeby nie znikały
   *  przy zawężeniu do jednej z nich. */
  const rawSzukane = useMemo(() => (raw ?? []).filter(b =>
    !q || `${b.internal_batch_no || ''} ${b.supplier_name || ''} ${b.name || ''}`.toLowerCase().includes(q)),
    [raw, q])

  /** Frakcje, które mają jakikolwiek stan — pusta nie ma czego filtrować. */
  const frakcjeZeStanem = useMemo(() => GRUPY.map(g => {
    const items = (raw ?? []).filter(g.match)
    return { ...g, ile: items.length, kg: items.reduce((a, b) => a + Number(b.kg_available || 0), 0) }
  }).filter(g => g.ile > 0), [raw])

  const rawFiltered = useMemo(
    () => (frakcja
      ? rawSzukane.filter(GRUPY.find(g => g.key === frakcja)?.match ?? (() => true))
      : rawSzukane),
    [rawSzukane, frakcja])

  const pusto = tab === 'fg' ? !fgFiltered.length : !rawFiltered.length

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Dodaj pozycję z magazynu</DialogTitle>
          <DialogDescription>
            Wybrany towar wpada do dokumentu jako kolejny wiersz — ilość i cenę wpisujesz w siatce.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <div className="flex rounded-md border border-surface-4 overflow-hidden">
            {([['fg', 'Wyroby gotowe', Package], ['raw', 'Surowce', Beef]] as const).map(([key, label, Icon]) => (
              <button key={key}
                      aria-label={key === 'fg' ? 'Wyroby gotowe' : 'Surowce'}
                      className={cn('px-3 h-8 text-[11px] font-semibold inline-flex items-center gap-1.5 transition-colors',
                        tab === key ? 'bg-primary text-primary-foreground' : 'bg-background text-ink-3 hover:bg-surface-2')}
                      onClick={() => setTab(key)}>
                <Icon size={12} /> {label}
              </button>
            ))}
          </div>
          {maKlienta && tab === 'fg' && (
            <div className="flex rounded-md border border-surface-4 overflow-hidden">
              {([[true, clientName], [false, 'Wszystkie']] as const).map(([v, label]) => (
                <button key={String(v)}
                        aria-label={v ? `Pokaż wyroby ${clientName}` : 'Pokaż wszystkie wyroby'}
                        className={cn('px-2.5 h-8 text-[11px] font-semibold transition-colors max-w-[160px] truncate',
                          tylkoKlienta === v ? 'bg-primary text-primary-foreground' : 'bg-background text-ink-3 hover:bg-surface-2')}
                        onClick={() => setTylkoKlienta(v)}>
                  {label}
                </button>
              ))}
            </div>
          )}
          <div className="relative flex-1">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-4" />
            <Input className="h-8 pl-8 text-[12px]" aria-label="Szukaj towaru"
                   placeholder={tab === 'fg' ? 'Szukaj wyrobu lub partii…' : 'Szukaj partii, frakcji lub dostawcy…'}
                   value={query} onChange={e => setQuery(e.target.value)} autoFocus />
          </div>
        </div>

        {tab === 'raw' && frakcjeZeStanem.length > 1 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              aria-label="Filtruj wszystkie frakcje"
              className={cn('px-2.5 h-7 rounded-md border text-[11px] font-semibold transition-colors',
                frakcja === ''
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-background text-ink-3 border-surface-4 hover:bg-surface-2')}
              onClick={() => setFrakcja('')}>
              Wszystkie
            </button>
            {frakcjeZeStanem.map(g => (
              <button
                key={g.key}
                aria-label={`Filtruj ${g.label}`}
                className={cn('px-2.5 h-7 rounded-md border text-[11px] font-semibold transition-colors',
                  frakcja === g.key
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-background text-ink-3 border-surface-4 hover:bg-surface-2')}
                onClick={() => setFrakcja(g.key)}>
                {g.label}
                <span className="ml-1.5 font-normal opacity-70 tabular-nums">
                  {g.ile} · {fmtKg3(g.kg).replace('.', ',')} kg
                </span>
              </button>
            ))}
          </div>
        )}

        <div className="border border-surface-4 rounded-md max-h-[52vh] overflow-y-auto divide-y divide-surface-3">
          {tab === 'fg' && fgFiltered.map(g => {
            const dodany = addedIds.has(g.id)
            return (
              <div key={g.id} className="px-3 py-2 flex items-center gap-3 hover:bg-surface-2">
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-medium text-ink truncate">
                    {fgLabel(g)}
                    {g.client_name && <span className="ml-2 text-[10px] text-ink-4">{g.client_name}</span>}
                  </div>
                  <div className="text-[11px] text-ink-4 flex items-center gap-2 mt-0.5">
                    <span className="font-mono">{g.batch_no}</span>
                    <span aria-label={`Stan ${g.id}`}>
                      {g.qty_available} szt · {fmtKg3(Number(g.qty_available || 0) * Number(g.kg_per_unit || 0))} kg
                    </span>
                  </div>
                </div>
                <Button variant="outline" size="sm" className="h-7 text-[11px] gap-1 shrink-0"
                        aria-label={`Dodaj ${g.id}`} disabled={dodany} onClick={() => onAddFg(g)}>
                  {dodany ? 'Dodano' : <><Plus size={12} /> Dodaj</>}
                </Button>
              </div>
            )
          })}

          {tab === 'raw' && GRUPY.map(grupa => {
            const items = rawFiltered.filter(grupa.match)
            if (!items.length) return null
            const sumKg = items.reduce((a, b) => a + Number(b.kg_available || 0), 0)
            const zostalo = items.filter(b => !addedIds.has(b.id))
            return (
              <div key={grupa.key}>
                <div className="px-3 py-1.5 bg-surface-2 border-b border-surface-3 flex items-center gap-2 sticky top-0 z-10"
                     aria-label={`Grupa ${grupa.label}`}>
                  <span className="text-[10px] font-bold uppercase tracking-wide text-ink-2">{grupa.label}</span>
                  <span className="text-[11px] text-ink-4">{items.length} poz. · {fmtKg3(sumKg)} kg</span>
                  {zostalo.length > 0 && (
                    <Button variant="outline" size="sm" className="h-6 ml-auto text-[11px] gap-1 shrink-0"
                            aria-label={`Dodaj wszystkie ${grupa.label}`}
                            onClick={() => onAddRawMany(items)}>
                      <Plus size={11} /> Dodaj wszystkie ({zostalo.length})
                    </Button>
                  )}
                </div>
                {items.map(b => {
                  const dodany = addedIds.has(b.id)
                  return (
                    <div key={b.id} className="px-3 py-2 flex items-center gap-3 hover:bg-surface-2 border-b border-surface-3 last:border-b-0">
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-medium text-ink truncate flex items-center gap-2">
                          <span className="font-mono font-bold">{b.internal_batch_no}</span>
                          <span className="truncate">{b.name || 'Surowiec'}</span>
                        </div>
                        <div className="text-[11px] text-ink-4 flex items-center gap-2 mt-0.5">
                          <span aria-label={`Stan ${b.id}`}>{fmtKg3(Number(b.kg_available || 0))} kg</span>
                          {b.containers ? <span>· {b.containers} poj.</span> : null}
                          {b.supplier_name && <span className="truncate">· {b.supplier_name}</span>}
                        </div>
                      </div>
                      <Button variant="outline" size="sm" className="h-7 text-[11px] gap-1 shrink-0"
                              aria-label={`Dodaj ${b.id}`} disabled={dodany} onClick={() => onAddRaw(b)}>
                        {dodany ? 'Dodano' : <><Plus size={12} /> Dodaj</>}
                      </Button>
                    </div>
                  )
                })}
              </div>
            )
          })}

          {pusto && (
            <div className="px-3 py-8 text-center text-[12px] text-ink-4">
              {q
                ? 'Brak wyników wyszukiwania'
                : maKlienta && tylkoKlienta
                  ? `Brak wyrobów przypisanych do klienta ${clientName} — przełącz na „Wszystkie"`
                  : 'Brak dostępnego stanu magazynowego'}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
