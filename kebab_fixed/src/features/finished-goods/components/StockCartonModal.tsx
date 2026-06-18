/**
 * „Dodaj karton z ręki" — wyrób na magazyn dla JEDNEGO klienta.
 * Karton może być mieszany: wiele pozycji (rodzaj+receptura+tuleja+waga+ilość),
 * np. 30×10kg + 20×15kg w jednym kartonie. Po zapisie karton dostaje globalny numer
 * i czeka na powiązanie z zamówieniem (zgodność per pozycja: klient+receptura+rodzaj+tuleja+waga).
 */
import { useState } from 'react'
import { useApi } from '@/hooks/useApi'
import { clientsApi, recipesApi, productTypesApi, packagingApi, stockCartonsApi, finishedGoodsApi, type StockCartonLineDto } from '@/lib/api'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { PackagePlus, Plus, Trash2 } from 'lucide-react'

interface LineDraft {
  recipeId: string
  productTypeId: string
  packagingId: string
  kgPerUnit: string
  qty: string
}

function emptyLine(): LineDraft {
  return { recipeId: '', productTypeId: '', packagingId: '', kgPerUnit: '', qty: '' }
}

export function StockCartonModal({ onCreated }: { onCreated?: (cartonId: string) => void }) {
  const [open, setOpen] = useState(false)
  const { data: clients } = useApi(() => clientsApi.list(), [])
  const { data: recipes } = useApi(() => recipesApi.list(), [])
  const { data: ptypes } = useApi(() => productTypesApi.list(), [])
  const { data: packs } = useApi(() => packagingApi.list(), [])
  // Wyroby gotowe na magazynie (bez zamówienia, dostępne) — do prefilla pozycji.
  const { data: fgAll } = useApi(() => finishedGoodsApi.list(), [])
  const stockGoods = ((fgAll as any[]) ?? []).filter(
    g => !(g.clientOrderNo || '').trim() && Number(g.qtyAvailable) > 0,
  )

  const [clientId, setClientId] = useState('')
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const lineValid = (l: LineDraft) => l.recipeId && l.productTypeId && Number(l.qty) > 0 && Number(l.kgPerUnit) > 0
  const valid = clientId && lines.length > 0 && lines.every(lineValid)

  function reset() {
    setClientId(''); setLines([emptyLine()]); setError(null)
  }

  function setLine(i: number, patch: Partial<LineDraft>) {
    setLines(prev => prev.map((l, idx) => idx === i ? { ...l, ...patch } : l))
  }
  function addLine() { setLines(prev => [...prev, emptyLine()]) }
  function removeLine(i: number) { setLines(prev => prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev) }

  function prefillFromGoods(g: any) {
    const norm = (s?: string) => (s ?? '').trim().toLowerCase()
    const c = (clients ?? []).find((x: any) => norm(x.name) === norm(g.clientName))
    if (c) setClientId(c.id)
    const draft: LineDraft = {
      recipeId: g.recipeId || '',
      productTypeId: g.productTypeId || '',
      packagingId: g.packagingId || '',
      kgPerUnit: String(g.kgPerUnit ?? ''),
      qty: String(g.qtyAvailable ?? ''),
    }
    // Pierwsza pozycja pusta → wypełnij ją; inaczej dodaj nową.
    setLines(prev => {
      const firstEmpty = prev.findIndex(l => !l.recipeId && !l.productTypeId)
      if (firstEmpty >= 0) return prev.map((l, idx) => idx === firstEmpty ? draft : l)
      return [...prev, draft]
    })
  }

  async function submit() {
    if (!valid || busy) return
    setBusy(true); setError(null)
    const find = (arr: any[] | null | undefined, id: string) => (arr ?? []).find((x: any) => x.id === id)
    try {
      const dtoLines: StockCartonLineDto[] = lines.map(l => ({
        recipeId: l.recipeId,        recipeName: find(recipes, l.recipeId)?.name ?? '',
        productTypeId: l.productTypeId, productTypeName: find(ptypes, l.productTypeId)?.name ?? '',
        packagingId: l.packagingId,  packagingName: find(packs, l.packagingId)?.name ?? '',
        kgPerUnit: Number(l.kgPerUnit), qty: Number(l.qty),
      }))
      const carton = await stockCartonsApi.create({
        clientId,
        clientName: find(clients, clientId)?.name ?? '',
        lines: dtoLines,
      })
      setOpen(false); reset(); onCreated?.(carton.id)
      // Od razu otwórz etykietę kartonu (magazynier ją drukuje i pakuje do niego sztuki)
      window.open(`/etykiety/karton/${carton.id}`, '_blank')
    } catch (e: any) {
      setError(e?.message || 'Nie udało się dodać kartonu')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setOpen(true)}>
        <PackagePlus size={15} /> Karton magazynowy
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Nowy karton magazynowy</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <Field label="Klient (wspólny dla całego kartonu)">
              <Picker value={clientId} onChange={setClientId} items={clients} placeholder="Wybierz klienta…" />
            </Field>

            {stockGoods.length > 0 && (
              <Field label="Z magazynu wyrobu gotowego (dodaje pozycję)">
                <Select value="" onValueChange={(id) => {
                  const g = stockGoods.find((x: any) => x.id === id)
                  if (g) prefillFromGoods(g)
                }}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Wybierz kebab z magazynu…" /></SelectTrigger>
                  <SelectContent>
                    {stockGoods.map((g: any) => (
                      <SelectItem key={g.id} value={g.id}>
                        {(g.batchNo ? g.batchNo + ' · ' : '')}{g.clientName || '—'} · {g.productTypeName || g.recipeName} · {g.qtyAvailable}×{g.kgPerUnit}kg
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}

            <div className="space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Pozycje kartonu</div>
              {lines.map((l, i) => (
                <div key={i} className="rounded-lg border border-slate-200 bg-slate-50 p-2 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-600">Pozycja {i + 1}</span>
                    {lines.length > 1 && (
                      <button type="button" onClick={() => removeLine(i)}
                        className="text-slate-400 hover:text-red-600" aria-label="Usuń pozycję">
                        <Trash2 size={15} />
                      </button>
                    )}
                  </div>
                  <Picker value={l.recipeId} onChange={(v) => setLine(i, { recipeId: v })} items={recipes} placeholder="Receptura…" />
                  <Picker value={l.productTypeId} onChange={(v) => setLine(i, { productTypeId: v })} items={ptypes} placeholder="Rodzaj produktu…" />
                  <Picker value={l.packagingId} onChange={(v) => setLine(i, { packagingId: v })} items={packs} placeholder="Tuleja (opcjonalnie)…" />
                  <div className="grid grid-cols-2 gap-2">
                    <Input type="number" min={1} placeholder="Ilość (szt)" value={l.qty} onChange={e => setLine(i, { qty: e.target.value })} />
                    <Input type="number" min={0} step="0.001" placeholder="Waga sztuki (kg)" value={l.kgPerUnit} onChange={e => setLine(i, { kgPerUnit: e.target.value })} />
                  </div>
                </div>
              ))}
              <Button type="button" variant="ghost" size="sm" className="gap-1.5" onClick={addLine}>
                <Plus size={14} /> Dodaj pozycję
              </Button>
            </div>

            {error && <div className="text-sm font-semibold text-red-600">{error}</div>}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Anuluj</Button>
            <Button disabled={!valid || busy} onClick={submit}>Dodaj karton</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      {children}
    </label>
  )
}

function Picker({ value, onChange, items, placeholder }: {
  value: string; onChange: (v: string) => void; items: any[] | null | undefined; placeholder: string
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-9 text-sm"><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent>
        {(items ?? []).map((it: any) => (
          <SelectItem key={it.id} value={it.id}>{it.name || it.code || it.id}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
