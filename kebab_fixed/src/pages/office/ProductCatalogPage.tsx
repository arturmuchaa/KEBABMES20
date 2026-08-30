/**
 * ProductCatalogPage — katalog wyrobów (rodzaj × receptura × tuleja × gramatura).
 *
 * Rodzaj i receptura mają w bazie identyfikatory typu `7e3090df935f4f509658`.
 * Wystarczają maszynie, ale nie da się ich podać na cenniku ani wysłać do
 * księgowości. Katalog nadaje im czytelny kod — i robi to dla POZYCJI, którą
 * się faktycznie sprzedaje, a nie dla samego rodzaju: „KEBAB UDO 100%"
 * w tulei metalowej 60 cm po 20 kg to inny towar niż to samo po 30 kg.
 *
 * To REJESTR, nie kartoteka do ręcznego prowadzenia: kombinacje dopisują się
 * z tego, co realnie wyprodukowano i zamówiono. Biuro poprawia kody i wygasza
 * pozycje, których już nie sprzedaje.
 */
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Download, Pencil, RefreshCw } from 'lucide-react'
import { useApi } from '@/hooks/useApi'
import { productCatalogApi, type ProductCatalogEntry } from '@/lib/apiClient'
import { DataTable } from '@/components/DataTable'
import { usePageHeaderActions } from '@/components/PageHeader'
import { cn } from '@/lib/utils'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardContent, CardDescription } from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'

function eksportCsv(rows: ProductCatalogEntry[]) {
  const naglowki = ['Kod', 'Rodzaj', 'Receptura', 'Tuleja', 'Kg', 'Aktywna']
  const csv = [naglowki.join(';')].concat(rows.map(r => [
    r.code, r.productTypeName, r.recipeName, r.packagingName,
    String(r.kgPerUnit).replace('.', ','), r.active ? 'tak' : 'nie',
  ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(';'))).join('\n')
  // BOM, żeby Excel nie zjadł ogonków przy otwarciu dwuklikiem.
  const blob = new Blob([new TextEncoder().encode('﻿' + csv)], {
    type: 'text/csv;charset=utf-8',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `katalog-wyrobow-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

export function ProductCatalogPage() {
  const { data: pozycje, loading, refetch } = useApi(() => productCatalogApi.list())
  const [edycja, setEdycja] = useState<ProductCatalogEntry | null>(null)
  const [nowyKod, setNowyKod] = useState('')
  const [zapisuje, setZapisuje] = useState(false)
  const [odswieza, setOdswieza] = useState(false)

  const lista = pozycje ?? []
  const aktywne = useMemo(() => lista.filter(p => p.active).length, [lista])

  async function odswiez() {
    setOdswieza(true)
    try {
      const { added } = await productCatalogApi.refresh()
      refetch()
      toast.success(added > 0
        ? `Dopisano ${added} nowych pozycji`
        : 'Katalog jest aktualny — nic nowego nie doszło')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Błąd odświeżania')
    } finally {
      setOdswieza(false)
    }
  }

  async function zapiszKod() {
    if (!edycja) return
    setZapisuje(true)
    try {
      await productCatalogApi.update(edycja.id, { code: nowyKod.trim() })
      refetch()
      setEdycja(null)
      toast.success('Kod zapisany')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Błąd zapisu')
    } finally {
      setZapisuje(false)
    }
  }

  async function przelaczAktywna(p: ProductCatalogEntry) {
    try {
      await productCatalogApi.update(p.id, { active: !p.active })
      refetch()
      toast.success(p.active ? 'Pozycja wygaszona' : 'Pozycja przywrócona')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Błąd zapisu')
    }
  }

  usePageHeaderActions(
    <div className="flex items-center gap-3 text-xs tabular-nums">
      <span className="text-[11px] font-bold uppercase tracking-wide text-ink-3">
        Pozycji: <span className="text-ink font-bold">{lista.length}</span>
      </span>
      <span className="text-[11px] font-bold uppercase tracking-wide text-ink-3">
        Aktywnych: <span className="text-emerald-700 font-bold">{aktywne}</span>
      </span>
      <Button size="sm" variant="outline" className="gap-1.5"
        onClick={() => eksportCsv(lista)} disabled={lista.length === 0}>
        <Download size={14} /> CSV
      </Button>
      <Button size="sm" className="gap-1.5" onClick={odswiez} disabled={odswieza}>
        <RefreshCw size={14} className={odswieza ? 'animate-spin' : ''} /> Odśwież z produkcji
      </Button>
    </div>,
    [lista.length, aktywne, odswieza],
  )

  return (
    <div className="animate-fade-in space-y-3">
      <Card>
        <CardContent className="p-3">
          <CardDescription className="text-[12px]">
            Pozycja katalogu to <strong>rodzaj × receptura × tuleja × gramatura</strong> —
            ta sama czwórka, po której liczy się pokrycie zamówień. Kombinacje
            dopisują się same z produkcji i zamówień; kod możesz poprawić, a pozycji,
            której już nie sprzedajesz, nie usuwaj — wygaś ją, żeby historia
            została czytelna.
          </CardDescription>
        </CardContent>
      </Card>

      {loading ? (
        <div className="rounded-lg border border-surface-4 bg-white p-4 space-y-2">
          {[0, 1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-8 w-full" />)}
        </div>
      ) : (
        <DataTable
          rows={lista}
          rowKey={p => p.id}
          searchText={p => `${p.code} ${p.productTypeName} ${p.recipeName} ${p.packagingName}`}
          searchPlaceholder="Filtruj: kod, rodzaj, receptura, tuleja…"
          columns={[
            { key: 'code', header: 'Kod', sortable: true, sortValue: p => p.code,
              cell: p => <span className="font-mono text-[12px] font-semibold">{p.code}</span> },
            { key: 'productTypeName', header: 'Rodzaj', sortable: true,
              sortValue: p => p.productTypeName,
              cell: p => <span className="font-medium">{p.productTypeName}</span> },
            { key: 'recipeName', header: 'Receptura', sortable: true,
              sortValue: p => p.recipeName,
              cell: p => p.recipeName || <span className="text-muted-foreground">—</span> },
            { key: 'packagingName', header: 'Tuleja', sortable: true,
              sortValue: p => p.packagingName,
              cell: p => p.packagingName || <span className="text-muted-foreground">—</span> },
            { key: 'kgPerUnit', header: 'Kg', sortable: true, sortValue: p => p.kgPerUnit,
              cell: p => <span className="tabular-nums">{p.kgPerUnit}</span> },
            { key: 'active', header: 'Stan', sortable: true, sortValue: p => (p.active ? 1 : 0),
              cell: p => (
                <button type="button" onClick={() => przelaczAktywna(p)}
                  className={cn('text-[11px] font-semibold uppercase tracking-wide',
                    p.active ? 'text-emerald-700' : 'text-ink-4')}>
                  {p.active ? 'aktywna' : 'wygaszona'}
                </button>
              ) },
            { key: 'akcje', header: '',
              cell: p => (
                <Button size="icon" variant="ghost"
                  onClick={() => { setEdycja(p); setNowyKod(p.code) }}>
                  <Pencil size={14} />
                </Button>
              ) },
          ]}
        />
      )}

      <Dialog open={!!edycja} onOpenChange={v => { if (!v) setEdycja(null) }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Kod pozycji</DialogTitle>
            <DialogDescription>
              {edycja && `${edycja.productTypeName} · ${edycja.recipeName || '—'} · ${edycja.packagingName || '—'} · ${edycja.kgPerUnit} kg`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label>Kod</Label>
            <Input value={nowyKod} className="font-mono"
              onChange={e => setNowyKod(e.target.value)} />
            <CardDescription className="text-[11px]">
              Kod wolno zmienić. Czwórki, która definiuje pozycję, nie — inny
              wyrób to inna pozycja katalogu.
            </CardDescription>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setEdycja(null)} disabled={zapisuje}>
              Anuluj
            </Button>
            <Button onClick={zapiszKod} disabled={zapisuje || !nowyKod.trim()}>
              Zapisz
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
