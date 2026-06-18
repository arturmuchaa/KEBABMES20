/**
 * „Dodaj karton z ręki" — wyrób na magazyn z przypisanym klientem.
 * Po zapisie karton dostaje globalny numer i czeka na powiązanie z zamówieniem
 * (klient + receptura + rodzaj + tuleja + waga muszą się zgadzać).
 */
import { useState } from 'react'
import { useApi } from '@/hooks/useApi'
import { clientsApi, recipesApi, productTypesApi, packagingApi, finishedGoodsApi } from '@/lib/api'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { PackagePlus } from 'lucide-react'

export function StockCartonModal({ onCreated }: { onCreated?: () => void }) {
  const [open, setOpen] = useState(false)
  const { data: clients } = useApi(() => clientsApi.list(), [])
  const { data: recipes } = useApi(() => recipesApi.list(), [])
  const { data: ptypes } = useApi(() => productTypesApi.list(), [])
  const { data: packs } = useApi(() => packagingApi.list(), [])

  const [clientId, setClientId] = useState('')
  const [recipeId, setRecipeId] = useState('')
  const [productTypeId, setProductTypeId] = useState('')
  const [packagingId, setPackagingId] = useState('')
  const [qty, setQty] = useState('')
  const [kgPerUnit, setKgPerUnit] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const valid = clientId && recipeId && productTypeId && Number(qty) > 0 && Number(kgPerUnit) > 0

  function reset() {
    setClientId(''); setRecipeId(''); setProductTypeId(''); setPackagingId('')
    setQty(''); setKgPerUnit(''); setError(null)
  }

  async function submit() {
    if (!valid || busy) return
    setBusy(true); setError(null)
    const find = (arr: any[] | null | undefined, id: string) => (arr ?? []).find((x: any) => x.id === id)
    try {
      await finishedGoodsApi.createStockCarton({
        clientId,        clientName:      find(clients, clientId)?.name ?? '',
        recipeId,        recipeName:      find(recipes, recipeId)?.name ?? '',
        productTypeId,   productTypeName: find(ptypes, productTypeId)?.name ?? '',
        packagingId,     packagingName:   find(packs, packagingId)?.name ?? '',
        qty: Number(qty), kgPerUnit: Number(kgPerUnit),
      })
      setOpen(false); reset(); onCreated?.()
    } catch (e: any) {
      setError(e?.message || 'Nie udało się dodać kartonu')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setOpen(true)}>
        <PackagePlus size={15} /> Dodaj karton z ręki
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Karton z ręki (na magazyn)</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <Field label="Klient">
              <Picker value={clientId} onChange={setClientId} items={clients} placeholder="Wybierz klienta…" />
            </Field>
            <Field label="Receptura">
              <Picker value={recipeId} onChange={setRecipeId} items={recipes} placeholder="Wybierz recepturę…" />
            </Field>
            <Field label="Rodzaj produktu">
              <Picker value={productTypeId} onChange={setProductTypeId} items={ptypes} placeholder="Wybierz rodzaj…" />
            </Field>
            <Field label="Tuleja">
              <Picker value={packagingId} onChange={setPackagingId} items={packs} placeholder="(opcjonalnie)" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Ilość (szt)">
                <Input type="number" min={1} value={qty} onChange={e => setQty(e.target.value)} />
              </Field>
              <Field label="Waga sztuki (kg)">
                <Input type="number" min={0} step="0.001" value={kgPerUnit} onChange={e => setKgPerUnit(e.target.value)} />
              </Field>
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
