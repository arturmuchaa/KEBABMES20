/**
 * PalletsEditor — edytor palet wydania dla zamówienia klienta.
 *
 * Cechy:
 * - Stałe numery palet i kartonów nadawane przez backend (nie indeks listy).
 * - Paleta może zawierać pozycje z różnych linii zamówienia (połączone palety).
 * - Pokazuje pozostałe szt do rozdysponowania per linia.
 */
import { useState, useMemo, useEffect } from 'react'
import { useApi } from '@/hooks/useApi'
import { orderPalletsApi, type OrderPallet, type OrderLine } from '@/lib/apiClient'
import { palletsApi, type PalletBatchRow, type StockCartonOption } from '@/lib/api'
import { formatCartonNo } from '@/lib/unitLocation'
import { fmtKg } from '@/lib/utils'
import { Plus, Trash2, Pencil, Package, Printer } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { StatusBadge } from '@/components/ui/badge'
import { OrderSection } from '@/features/orders/OrderUI'
import { kgText } from '@/features/orders/orderPlanning'
import '@/features/orders/order-planning.css'
import {
  Card, CardContent, CardDescription, CardTitle,
} from '@/components/ui/card'

interface Props {
  orderId: string
  lines:   OrderLine[]
  assignedCartons?: StockCartonOption[] | null
  orderNo?: string
  clientName?: string
}

function lineLabel(l: OrderLine): string {
  const parts = [`${l.kgPerUnit} kg`]
  if (l.recipeName)      parts.push(l.recipeName)
  if (l.productTypeName) parts.push(l.productTypeName)
  if (l.packagingName) parts.push(l.packagingName)
  return parts.join(' · ')
}

export function PalletsEditor({ orderId, lines, assignedCartons = [], orderNo, clientName }: Props) {
  const { data: pallets, refetch, loading: palletsLoading, error: palletsError } = useApi(() => orderPalletsApi.list(orderId), [orderId])
  const list = pallets ?? []

  const [showAdd,    setShowAdd]    = useState(false)
  const [editingIdx, setEditingIdx] = useState<number | null>(null)
  const [saving,     setSaving]     = useState(false)
  const [error,      setError]      = useState<string | null>(null)
  // Zaznaczone palety do druku zbiorczego. Numery, nie indeksy — indeks
  // przestaje wskazywać tę samą paletę po usunięciu którejś z listy.
  const [zaznaczone, setZaznaczone] = useState<number[]>([])

  /** Otwiera wydruk kartek. Bez numerów = wszystkie palety zamówienia.
   *  `window.open` w oknie Tauri potrafi zwrócić null — wtedy nawigujemy
   *  w bieżącej karcie, żeby druk nie przepadł bez śladu. */
  function otworzWydruk(palletNos?: number[]) {
    const query = palletNos?.length ? `?palety=${palletNos.join(',')}` : ''
    const url = `/office/zamowienia/${orderId}/palety/druk${query}`
    const win = window.open(url, '_blank')
    if (!win || win.closed || typeof win.closed === 'undefined') window.location.href = url
  }

  const przelacz = (palletNo: number) => setZaznaczone(
    z => z.includes(palletNo) ? z.filter(n => n !== palletNo) : [...z, palletNo])

  // ── Ile szt z danej linii już rozdysponowano na palety (opcjonalnie excl.) ──
  const assignedByLine = useMemo(() => {
    const m: Record<string, number> = {}
    list.forEach(p => p.items.forEach(it => {
      m[it.orderLineId] = (m[it.orderLineId] ?? 0) + it.qty
    }))
    return m
  }, [list])

  function remainingForLine(lineId: string, excludePalletIdx?: number): number {
    const line = lines.find(l => l.id === lineId)
    if (!line) return 0
    const assigned = assignedByLine[lineId] ?? 0
    const inExcluded = excludePalletIdx != null
      ? (list[excludePalletIdx]?.items.find(i => i.orderLineId === lineId)?.qty ?? 0)
      : 0
    return Math.max(0, line.qty - assigned + inExcluded)
  }

  async function persist(updated: OrderPallet[]) {
    setSaving(true); setError(null)
    try {
      await orderPalletsApi.save(orderId, updated)
      await refetch()
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Błąd zapisu palet')
      return false
    } finally {
      setSaving(false)
    }
  }

  async function handleSavePallet(idx: number | null, items: { lineId: string; qty: number }[], notes: string) {
    const newPallet: OrderPallet = {
      ...(idx == null ? { palletNo: 0 } : list[idx]),
      notes,
      items: items.filter(i => i.qty > 0).map(i => ({ orderLineId: i.lineId, qty: i.qty })),
    }
    if (newPallet.items.length === 0) {
      setError('Dodaj przynajmniej jedną pozycję na paletę')
      return
    }
    const updated = idx == null
      ? [...list, newPallet]
      : list.map((p, i) => i === idx ? newPallet : p)
    if (await persist(updated)) {
      setShowAdd(false)
      setEditingIdx(null)
    }
  }

  async function handleRemove(idx: number) {
    if (!confirm(`Usunąć paletę nr ${list[idx].palletNo}?`)) return
    await persist(list.filter((_, i) => i !== idx))
  }

  const totalKg = list.reduce((s, p) => s + p.items.reduce(
    (ss, it) => ss + it.qty * (lines.find(l => l.id === it.orderLineId)?.kgPerUnit ?? 0), 0,
  ), 0)
  const totalUnits = list.reduce((s, p) => s + p.items.reduce((ss, it) => ss + it.qty, 0), 0)
  // Kartony pozostają odrębnymi jednostkami SCARTON: pokazujemy je razem,
  // ale nigdy nie wysyłamy ich do save() ani nie drukujemy jako etykiet PAL.
  const stock = assignedCartons ?? []
  const stockQty = stock.reduce((s, c) => s + c.lines.reduce((q, l) => q + l.targetQty, 0), 0)
  const stockKg = stock.reduce((s, c) => s + c.lines.reduce((kg, l) => kg + l.targetQty * l.kgPerUnit, 0), 0)

  return (
    <div className="orders-workspace mt-4">
      <OrderSection title="Palety wydania" description={[clientName, orderNo, `${list.length} palet · ${totalUnits} szt. · ${kgText(totalKg)}`].filter(Boolean).join(' · ')} action={
        <div className="flex flex-wrap items-center gap-2">
          {list.length > 0 && (
            <>
              <Button
                variant="outline" size="sm" className="gap-1"
                disabled={saving || zaznaczone.length === 0}
                onClick={() => otworzWydruk(zaznaczone)}
                title="Drukuj kartki zaznaczonych palet (po 2 na paletę)"
              >
                <Printer size={12} /> Drukuj zaznaczone{zaznaczone.length ? ` (${zaznaczone.length})` : ''}
              </Button>
              <Button
                variant="outline" size="sm" className="gap-1"
                disabled={saving}
                onClick={() => otworzWydruk()}
                title="Drukuj kartki wszystkich palet (po 2 na paletę)"
              >
                <Printer size={12} /> Drukuj wszystkie
              </Button>
            </>
          )}
          <Button
            variant="outline"
            size="sm"
            className="gap-1 border-blue-300 text-blue-800"
            disabled={saving || (showAdd && editingIdx === null)}
            onClick={() => { setEditingIdx(null); setShowAdd(true); setError(null) }}
          >
            <Plus size={12} /> Dodaj paletę
          </Button>
        </div>}
      >
      <p className="order-info">Rozpis palet to przydział do wysyłki, nie dowód wykonania. Status pakowania i mroźni pokazujemy osobno. Numery palet i etykiety QR pozostają bez zmian.</p>

      {assignedCartons === null || palletsLoading || palletsError ? (
        <p role="status" className="order-info order-warning">Brak kompletu aktualnych danych palet i kartonów — suma palet powyżej jest częściowa.{palletsError && <button className="ml-2 underline" onClick={() => void refetch()}>Ponów pobieranie palet</button>}</p>
      ) : stock.length > 0 ? (
        <div className="rounded border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs" data-testid="combined-pallet-totals">
          <b>Łączny rozpis: {list.length + stock.length} palet/kartonów · {fmtKg(totalKg + stockKg, 0)} kg · {totalUnits + stockQty} szt</b>
          <div>W tym z magazynu: {stock.length} kartonów · {fmtKg(stockKg, 0)} kg · {stockQty} szt. — te ilości są już przypisane, nie twórz ich ponownie.</div>
          <div>Drukuj wszystkie / zaznaczone dotyczy palet wydania. Kartony z magazynu zachowują swoje etykiety.</div>
        </div>
      ) : null}

      {error && (
        <p role="alert" className="m-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>
      )}

      {list.length === 0 && stock.length === 0 && !showAdd && (
        <CardDescription className="p-6 text-sm text-center">
          Brak rozpisanych palet. Dodaj pierwszą paletę, aby przygotować rozpis i etykiety.
        </CardDescription>
      )}

      {/* Lista palet */}
      <div className="order-pallet-grid">
        {stock.map(c => (
          <Card key={`stock-${c.cartonId}`} className="order-pallet-card border-l-4 border-l-emerald-600" data-testid="assigned-stock-pallet">
            <CardContent className="p-3 space-y-2">
              <CardTitle className="text-xs font-bold text-emerald-900">Karton {formatCartonNo(c.cartonNo)} · Dołączona paleta z magazynu</CardTitle>
              <div className="text-[11px] font-semibold text-emerald-800">
                {c.shipped ? 'Wydany' : c.loaded ? 'Na aucie' : c.inColdStorage ? 'W mroźni' : c.scannerless ? 'Bez skanowania sztuk' : `Spakowano ${c.packedQty}/${c.targetQty} szt.`}
              </div>
              {c.lines.map((l, i) => <div key={i} className="text-xs break-words">
                <b>{l.targetQty} × {l.kgPerUnit} kg {l.recipeName}</b>
                {l.packagingName ? ` · ${l.packagingName}` : ''}
                {l.productTypeName ? <div className="text-muted-foreground">{l.productTypeName}</div> : null}
              </div>)}
              <div className="border-t border-emerald-200 pt-1 text-xs font-bold">
                Rozpis: {fmtKg(c.lines.reduce((kg, l) => kg + l.targetQty * l.kgPerUnit, 0), 0)} kg
              </div>
              <p className="text-[11px] text-emerald-800">Oryginalna etykieta kartonu. Odłączanie w sekcji „Kartony z magazynu” powyżej.</p>
            </CardContent>
          </Card>
        ))}
        {list.map((p, idx) => {
          const palletKg = p.items.reduce(
            (s, it) => s + it.qty * (lines.find(l => l.id === it.orderLineId)?.kgPerUnit ?? 0), 0,
          )
          const isEdit = editingIdx === idx
          if (isEdit) {
            return (
              <PalletForm
                key={p.id ?? `e-${idx}`}
                title={`Edycja palety nr ${p.palletNo}`}
                lines={lines}
                initial={p}
                remainingForLine={lineId => remainingForLine(lineId, idx)}
                onSave={(items, notes) => handleSavePallet(idx, items, notes)}
                onCancel={() => setEditingIdx(null)}
                saving={saving}
              />
            )
          }
          return (
            <article key={p.id ?? idx} className="order-pallet-card">
                <header>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      className="accent-blue-600"
                      checked={zaznaczone.includes(p.palletNo)}
                      onChange={() => przelacz(p.palletNo)}
                      aria-label={`Zaznacz paletę nr ${p.palletNo} do druku`}
                      disabled={saving}
                    />
                    <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center">
                      <Package size={16} className="text-blue-800" aria-hidden="true" />
                    </div>
                    <h3>{p.cartonNo ? `Karton ${p.cartonNo} · P${p.palletNo}` : `Paleta nr ${p.palletNo}`}</h3>
                  </div>
                  <div className="flex gap-0.5">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="order-action text-muted-foreground hover:text-ink"
                      onClick={() => otworzWydruk([p.palletNo])}
                      title="Drukuj kartki tej palety (2 kopie)"
                      disabled={saving}
                    >
                      <Printer size={11} />
                    </Button>
                    <Button
                      variant="ghost" size="icon" className="order-action text-muted-foreground hover:text-primary"
                      onClick={() => { setShowAdd(false); setEditingIdx(idx); setError(null) }}
                      aria-label={`Edytuj paletę nr ${p.palletNo}`}
                      disabled={saving}
                    >
                      <Pencil size={11} />
                    </Button>
                    <Button
                      variant="ghost" size="icon" className="order-action text-muted-foreground hover:text-destructive"
                      onClick={() => handleRemove(idx)}
                      aria-label={`Usuń paletę nr ${p.palletNo}`}
                      disabled={saving}
                    >
                      <Trash2 size={11} />
                    </Button>
                  </div>
                </header>
                <div className="px-4 pt-3 flex flex-wrap gap-2 text-xs text-slate-600"><span>Przypisana do {orderNo || 'tego zamówienia'}</span><StatusBadge tone={p.status === 'cold_storage' ? 'blue' : p.status === 'packed' || p.status === 'loaded' ? 'green' : 'gray'} label={PACK_STATUS_LABEL[p.status || 'created'] ?? p.status ?? 'Rozpisana'} /></div>
                <div className="p-4 space-y-3">
                  {p.items.map(it => {
                    const ln = lines.find(l => l.id === it.orderLineId)
                    return (
                      <div key={it.id ?? it.orderLineId} className="flex justify-between gap-3 text-xs">
                        <span className="break-words min-w-0">
                          <span className="font-bold tabular-nums">{it.qty}× </span>
                          {ln ? lineLabel(ln) : '—'}
                        </span>
                        <span className="text-muted-foreground tabular-nums flex-shrink-0 ml-2">
                          {fmtKg(it.qty * (ln?.kgPerUnit ?? 0), 1)} kg
                        </span>
                      </div>
                    )
                  })}
                </div>

                <footer><span>{p.items.reduce((s, i) => s + i.qty, 0)} szt.</span><strong>{kgText(palletKg)}</strong></footer>

                {p.status && p.status !== 'created' && (
                  <PalletPackInfo palletId={p.id} status={p.status} />
                )}

                {p.notes && (
                  <div className="px-4 pb-3 text-xs text-slate-600">{p.notes}</div>
                )}
            </article>
          )
        })}

        {showAdd && (
          <PalletForm
            title="Nowa paleta — numer nada system"
            lines={lines}
            initial={null}
            remainingForLine={lineId => remainingForLine(lineId)}
            onSave={(items, notes) => handleSavePallet(null, items, notes)}
            onCancel={() => setShowAdd(false)}
            saving={saving}
          />
        )}
      </div>
      </OrderSection>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────
// PalletPackInfo — status pakowania + skład partii (read-only, HDI)
// ──────────────────────────────────────────────────────────────────
const PACK_STATUS_LABEL: Record<string, string> = {
  created:      'Rozpisana',
  packing:      'Pakowanie w toku',
  packed:       'Zapakowana',
  cold_storage: 'Mroźnia składowa',
  loaded:       'Załadowana',
  shipped:      'Wydana',
}

function PalletPackInfo({ palletId, status }: { palletId?: string; status: string }) {
  const [batch, setBatch] = useState<PalletBatchRow[]>([])
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!palletId) return
    let cancelled = false
    setError(false)
    palletsApi.batchBreakdown(palletId)
      .then(rows => { if (!cancelled) setBatch(rows ?? []) })
      .catch(() => { if (!cancelled) { setBatch([]); setError(true) } })
    return () => { cancelled = true }
  }, [palletId])

  return (
    <div className="px-4 py-3 border-t border-slate-200 bg-slate-50">
      <div className="text-xs font-semibold text-slate-700">
        {PACK_STATUS_LABEL[status] ?? status}
      </div>
      {error && <p role="status" className="text-xs text-amber-800">Nie udało się odczytać składu partii. Status palety pozostaje bez zmian.</p>}
      {batch.length > 0 && (
        <div className="mt-1 space-y-0.5">
          {batch.map(b => (
            <div key={b.batchNo || '—'} className="flex justify-between text-[10px] tabular-nums">
              <span className="text-muted-foreground">Partia {b.batchNo || '—'}</span>
              <span className="font-semibold">{b.qty} szt · {fmtKg(b.weightKg, 0)} kg</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────
// PalletForm — dodaj/edytuj paletę (wiele pozycji w jednym formularzu)
// ──────────────────────────────────────────────────────────────────
function PalletForm({
  title, lines, initial, remainingForLine, onSave, onCancel, saving,
}: {
  title: string
  lines: OrderLine[]
  initial: OrderPallet | null
  remainingForLine: (lineId: string) => number
  onSave: (items: { lineId: string; qty: number }[], notes: string) => void | Promise<void>
  onCancel: () => void
  saving: boolean
}) {
  const initialMap = useMemo(() => {
    const m: Record<string, number> = {}
    initial?.items.forEach(it => { m[it.orderLineId] = it.qty })
    return m
  }, [initial])

  const [qtys,  setQtys]  = useState<Record<string, number>>(initialMap)
  const [notes, setNotes] = useState(initial?.notes ?? '')

  const totalQty = Object.values(qtys).reduce((s, q) => s + (q || 0), 0)
  const totalKg  = Object.entries(qtys).reduce((s, [lineId, q]) => {
    const ln = lines.find(l => l.id === lineId)
    return s + (q || 0) * (ln?.kgPerUnit ?? 0)
  }, 0)

  function handleSubmit() {
    const items = Object.entries(qtys)
      .filter(([, q]) => q > 0)
      .map(([lineId, q]) => ({ lineId, qty: q }))
    onSave(items, notes)
  }

  return (
    <Card className="bg-white border-2 border-blue-300 col-span-full rounded-xl">
      <CardContent className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold">{title}</CardTitle>
          <span className="text-[11px] text-muted-foreground tabular-nums">
            {totalQty} szt · {fmtKg(totalKg, 1)} kg
          </span>
        </div>

        <div className="space-y-1.5">
          {initial && <p className="text-xs text-amber-800">Numer kartonu pozostaje stały. Po zmianie zawartości wydrukuj ponownie jego etykiety.</p>}
          {lines.map(l => {
            const remaining = remainingForLine(l.id)
            const cur       = qtys[l.id] ?? 0
            const maxQty    = remaining
            return (
              <div key={l.id} className="flex items-center gap-2 text-xs">
                <div className="flex-1 min-w-0">
                  <label htmlFor={`pallet-qty-${l.id}`} className="block break-words">{lineLabel(l)}</label>
                  <CardDescription className="text-[10px]">
                    Pozostało: <span className="font-bold tabular-nums">{remaining}</span> szt z {l.qty}
                  </CardDescription>
                </div>
                <Input
                  id={`pallet-qty-${l.id}`}
                  type="number"
                  min={0}
                  max={maxQty}
                  className="w-20 h-8 text-xs"
                  value={cur || ''}
                  onChange={e => {
                    const raw = Number(e.target.value)
                    const v   = Number.isFinite(raw) ? Math.max(0, Math.min(maxQty, Math.floor(raw))) : 0
                    setQtys(p => ({ ...p, [l.id]: v }))
                  }}
                  placeholder="0"
                />
              </div>
            )
          })}
        </div>

        <div className="space-y-1">
          <Label htmlFor="pallet-notes" className="text-xs">Uwagi do palety</Label>
          <Input
            id="pallet-notes"
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="np. Z górnej półki, numer chłodni..."
            className="h-8 text-xs"
          />
        </div>

        <div className="flex gap-2 pt-1">
          <Button
            size="sm"
            className="h-7 text-[11px] gap-1"
            onClick={handleSubmit}
            disabled={saving || totalQty === 0}
          >
            {saving ? 'Zapisuję...' : (initial ? 'Zapisz zmiany' : 'Dodaj paletę')}
          </Button>
          <Button
            variant="outline" size="sm" className="h-7 text-[11px]"
            onClick={onCancel} disabled={saving}
          >
            Anuluj
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
