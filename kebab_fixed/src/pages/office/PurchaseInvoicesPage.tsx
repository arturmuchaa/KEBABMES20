/**
 * PurchaseInvoicesPage v2
 */
import { useState, useMemo, useCallback } from 'react'
import { useApi } from '@/hooks/useApi'
import { suppliersApi, rawBatchesApi, invoicesApi, ingredientsApi, packagingApi } from '@/lib/apiClient'
import type { PurchaseInvoice, InvoiceCategory } from '@/lib/mockApi'
import { INVOICE_CATEGORY_LABELS as CAT_LABELS } from '@/lib/mockApi'
import { fmtPln, fmtDatePl, fmtKg, todayIso } from '@/lib/utils'
import { Plus, FileText, Pencil, Trash2, Receipt, Search, X, AlertTriangle, Package, FlaskConical, Zap, Tag, Archive } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'

const CATEGORY_ICON: Record<InvoiceCategory, React.ReactNode> = {
  SUROWIEC:            <Package size={13} />,
  PRZYPRAWY_I_DODATKI: <FlaskConical size={13} />,
  OPAKOWANIA_TULEJE:   <Archive size={13} />,
  MEDIA:               <Zap size={13} />,
  INNE:                <Tag size={13} />,
}
const CATEGORY_VARIANT: Record<InvoiceCategory, 'info'|'success'|'secondary'|'warning'|'outline'> = {
  SUROWIEC:            'info',
  PRZYPRAWY_I_DODATKI: 'success',
  OPAKOWANIA_TULEJE:   'secondary',
  MEDIA:               'warning',
  INNE:                'outline',
}

const ALL_CATS: InvoiceCategory[] = ['SUROWIEC','PRZYPRAWY_I_DODATKI','OPAKOWANIA_TULEJE','MEDIA','INNE']

interface FormState {
  invoiceNo: string; supplierId: string; category: InvoiceCategory
  invoiceDate: string; dueDate: string; qty: string
  unitPrice: string; vatRate: string; notes: string
  rawBatchIds: string[]; lineName: string; ingredientId: string
  expiryDate: string; batchNo: string; packagingId: string
  createWZ: boolean; currency: 'PLN'|'EUR'; exchangeRate: string
}

function emptyForm(cat: InvoiceCategory = 'SUROWIEC'): FormState {
  return {
    invoiceNo:'', supplierId:'', category:cat,
    invoiceDate:todayIso(), dueDate:'', qty:'', unitPrice:'', vatRate:'5', notes:'',
    rawBatchIds:[], lineName:'', ingredientId:'', expiryDate:'', batchNo:'',
    packagingId:'', createWZ:true, currency:'PLN', exchangeRate:'',
  }
}

function fromExisting(inv: PurchaseInvoice): FormState {
  return {
    invoiceNo: inv.invoiceNo, supplierId: inv.supplierId,
    category: inv.category ?? 'SUROWIEC',
    invoiceDate: inv.invoiceDate, dueDate: inv.dueDate ?? '',
    qty: String(inv.qty), unitPrice: String(inv.unitPrice),
    vatRate: String(Math.round((inv.vatRate ?? 0.05)*100)),
    notes: inv.notes ?? '',
    rawBatchIds: (inv as any).rawBatchIds ?? (inv.rawBatchId ? [inv.rawBatchId] : []),
    lineName: inv.lines?.[0]?.lineName ?? '',
    ingredientId: (inv as any).ingredientId ?? '',
    expiryDate: (inv as any).expiryDate ?? '',
    batchNo: '',
    packagingId: (inv as any).packagingId ?? '',
    createWZ: false, currency: (inv as any).currency ?? 'PLN',
    exchangeRate: (inv as any).exchangeRate ? String((inv as any).exchangeRate) : '',
  }
}

function calcAmounts(qty: number, unitPrice: number, vatRate: number) {
  const net   = Math.round(qty*unitPrice*100)/100
  const vat   = Math.round(net*vatRate*100)/100
  const gross = Math.round((net+vat)*100)/100
  return { net, vat, gross }
}

function InvoiceForm({ initial, onSave, onClose }: {
  initial?: PurchaseInvoice | null
  onSave: (dto: any) => Promise<void>
  onClose: () => void
}) {
  const { data: suppData }  = useApi(() => suppliersApi.list())
  const { data: batchData } = useApi(() => (rawBatchesApi as any).all())
  const { data: ingData }   = useApi(() => ingredientsApi.list())
  const { data: pkgData }   = useApi(() => packagingApi.all())

  const [form,       setForm]       = useState<FormState>(initial ? fromExisting(initial) : emptyForm())
  const [nbpLoading, setNbpLoading] = useState(false)
  const [nbpError,   setNbpError]   = useState('')
  const [error,      setError]      = useState('')
  const [saving,     setSaving]     = useState(false)

  const set = useCallback(<K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm(p => ({ ...p, [k]: v })), [])

  async function fetchNbpRate() {
    setNbpLoading(true); setNbpError('')
    try {
      const res  = await fetch('https://api.nbp.pl/api/exchangerates/rates/a/eur/?format=json')
      if (!res.ok) throw new Error('Błąd NBP')
      const data = await res.json()
      const rate = data?.rates?.[0]?.mid
      if (rate) set('exchangeRate', String(rate))
      else throw new Error('Brak danych')
    } catch { setNbpError('Nie udało się pobrać kursu NBP. Wpisz ręcznie.') }
    finally { setNbpLoading(false) }
  }

  const supplierOptions   = (suppData ?? []).map(s => ({ value: s.id, label: s.name }))
  // Filtruj wyfakturowane partie — pokaż tylko bez faktury LUB te już wybrane w edytowanej fakturze
  const existingBatchIds = initial
    ? ((initial as any).rawBatchIds ?? (initial.rawBatchId ? [(initial as any).rawBatchId] : []))
    : []
  const batchOptions = (batchData?.data ?? [])
    .filter((b: any) => {
      const alreadyInvoiced = !!(b.invoice_no ?? b.invoiceNo)
      return !alreadyInvoiced || existingBatchIds.includes(b.id)
    })
    .map((b: any) => ({
      value: b.id,
      label: `${b.internalBatchNo} · ${fmtKg(b.kgReceived,0)} kg · ${fmtDatePl(b.receivedDate)}`,
      kg: b.kgReceived, price: b.pricePerKg ?? 0, supplierId: b.supplierId, status: b.status,
    }))
  const ingredientOptions = (ingData ?? []).map((i: any) => ({ value: i.id, label: i.name, unit: i.unit }))
  const packagingOptions  = (pkgData ?? []).map((p: any) => ({
    value: p.id, label: `${p.name} (${p.kgAvailable} ${p.unit} na stanie)`, supplierId: p.supplierId,
  }))

  const cat = form.category

  function handleBatchToggle(id: string) {
    setForm(p => {
      const newIds  = p.rawBatchIds.includes(id) ? p.rawBatchIds.filter(x => x !== id) : [...p.rawBatchIds, id]
      const first   = newIds.length > 0 ? batchOptions.find(x => x.value === newIds[0]) : null
      const totalKg = newIds.reduce((s, bid) => s + (batchOptions.find(x => x.value === bid)?.kg ?? 0), 0)
      return {
        ...p, rawBatchIds: newIds,
        supplierId: first?.supplierId ?? p.supplierId,
        qty:        totalKg > 0 ? String(totalKg) : p.qty,
        unitPrice:  first && first.price > 0 ? String(first.price) : p.unitPrice,
      }
    })
  }

  function handlePackagingChange(id: string) {
    set('packagingId', id)
    const pkg = packagingOptions.find(x => x.value === id)
    if (pkg?.supplierId) set('supplierId', pkg.supplierId)
  }

  function handleCategoryChange(c: InvoiceCategory) {
    setForm(p => ({ ...p, category: c, rawBatchIds: [], ingredientId: '', expiryDate: '', batchNo: '', packagingId: '' }))
  }

  const qty       = parseFloat(form.qty)       || 0
  const unitPrice = parseFloat(form.unitPrice) || 0
  const vatPct    = parseFloat(form.vatRate)   || 5
  const vatRate   = vatPct / 100
  const { net, vat, gross } = calcAmounts(qty, unitPrice, vatRate)

  const selectedBatches = batchOptions.filter(b => form.rawBatchIds.includes(b.value))
  const totalSelectedKg = selectedBatches.reduce((s, b) => s + b.kg, 0)

  const isValid = form.invoiceNo.trim() && form.supplierId && qty > 0 && unitPrice > 0
    && (cat !== 'PRZYPRAWY_I_DODATKI' || (form.ingredientId && form.expiryDate))

  async function handleSubmit() {
    if (!isValid) { setError('Uzupełnij wymagane pola'); return }
    setSaving(true)
    try {
      const exchRate = parseFloat(form.exchangeRate) || undefined
      await onSave({
        invoiceNo:    form.invoiceNo.trim(),   supplierId: form.supplierId,
        category:     cat,                    invoiceDate: form.invoiceDate,
        dueDate:      form.dueDate || undefined,
        qty,
        unitPrice:    form.currency === 'EUR' && exchRate ? Math.round(unitPrice * exchRate * 100)/100 : unitPrice,
        vatRate,
        notes:        form.notes || undefined,
        rawBatchId:   form.rawBatchIds?.[0] || undefined,
        rawBatchIds:  form.rawBatchIds?.length > 0 ? form.rawBatchIds : undefined,
        lineName:     form.lineName || undefined,
        ingredientId: form.ingredientId || undefined,
        expiryDate:   form.expiryDate || undefined,
        batchNo:      form.batchNo || undefined,
        packagingId:  form.packagingId || undefined,
        createWZ:     form.createWZ,
        currency:     form.currency,
        exchangeRate: exchRate,
        amountEur:    form.currency === 'EUR' ? gross : undefined,
      })
      onClose()
    } catch (e) { setError(e instanceof Error ? e.message : 'Błąd zapisu') }
    finally { setSaving(false) }
  }

  return (
    <div className="space-y-4 max-h-[75vh] overflow-y-auto pr-1">
      {/* Kategoria */}
      <div className="space-y-2">
        <Label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Kategoria *</Label>
        <div className="grid grid-cols-5 gap-1.5">
          {ALL_CATS.map(c => (
            <button
              key={c}
              onClick={() => handleCategoryChange(c)}
              className={`flex flex-col items-center gap-1 py-2 px-1 rounded-xl border-2 text-[10px] font-semibold transition-all ${
                cat === c ? 'border-primary bg-primary/5 text-primary' : 'border-border text-muted-foreground hover:border-primary/40'
              }`}
            >
              {CATEGORY_ICON[c]}
              <span className="text-center leading-tight">{CAT_LABELS[c]}</span>
            </button>
          ))}
        </div>
      </div>

      <Separator />

      {/* Podstawowe */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Nr faktury *</Label>
          <Input value={form.invoiceNo} onChange={e => set('invoiceNo', e.target.value)} placeholder="FV/2026/001" />
        </div>
        <div className="space-y-1.5">
          <Label>Dostawca *</Label>
          <Select value={form.supplierId || '__none'} onValueChange={v => set('supplierId', v === '__none' ? '' : v)}>
            <SelectTrigger><SelectValue placeholder="Wybierz..." /></SelectTrigger>
            <SelectContent>
              {supplierOptions.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Data faktury *</Label>
          <Input type="date" value={form.invoiceDate} onChange={e => set('invoiceDate', e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Termin płatności</Label>
          <Input type="date" value={form.dueDate} onChange={e => set('dueDate', e.target.value)} />
        </div>
      </div>

      {/* SUROWIEC */}
      {cat === 'SUROWIEC' && (
        <Card className="border-blue-200 bg-blue-50/50">
          <CardContent className="p-3 space-y-3">
            <CardDescription className="text-[10px] font-bold text-blue-700 uppercase tracking-wide flex items-center gap-1.5">
              <Package size={11} /> Powiązane partie surowca (można zaznaczyć wiele)
            </CardDescription>
            <div className="max-h-44 overflow-y-auto border border-blue-200 bg-white divide-y rounded-lg">
              {batchOptions.length === 0
                ? <CardDescription className="px-3 py-2 text-xs">Brak partii</CardDescription>
                : batchOptions.map(o => {
                    const sel = form.rawBatchIds.includes(o.value)
                    return (
                      <label key={o.value} className={`flex items-center gap-2 px-3 py-2 cursor-pointer text-xs hover:bg-blue-50 ${sel ? 'bg-blue-50' : ''}`}>
                        <input type="checkbox" checked={sel} onChange={() => handleBatchToggle(o.value)} className="w-4 h-4 accent-blue-600" />
                        <span className={sel ? 'font-bold text-primary' : o.status === 'used' ? 'text-muted-foreground' : ''}>{o.label}</span>
                        {o.status === 'used' && <CardDescription className="ml-auto text-[10px]">zużyta</CardDescription>}
                      </label>
                    )
                  })
              }
            </div>
            {selectedBatches.length > 0 && (
              <CardDescription className="text-xs bg-white border border-blue-200 rounded px-3 py-2">
                <span className="font-bold text-blue-700">{selectedBatches.length} partii · </span>
                Suma: <strong>{fmtKg(totalSelectedKg)} kg</strong> → ilość na FV ustawiona automatycznie
              </CardDescription>
            )}
            <div className="space-y-1.5">
              <Label>Nazwa pozycji</Label>
              <Input placeholder="ĆWIARTKA Z KURCZAKA KL. A SCHŁODZONA" value={form.lineName} onChange={e => set('lineName', e.target.value)} />
            </div>
          </CardContent>
        </Card>
      )}

      {/* PRZYPRAWY */}
      {cat === 'PRZYPRAWY_I_DODATKI' && (
        <Card className="border-green-200 bg-green-50/50">
          <CardContent className="p-3 space-y-3">
            <CardDescription className="text-[10px] font-bold text-green-700 uppercase tracking-wide flex items-center gap-1.5">
              <FlaskConical size={11} /> Zasilenie magazynu przypraw
            </CardDescription>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Składnik *</Label>
                <Select value={form.ingredientId || '__none'} onValueChange={v => set('ingredientId', v === '__none' ? '' : v)}>
                  <SelectTrigger><SelectValue placeholder="Wybierz składnik..." /></SelectTrigger>
                  <SelectContent>
                    {ingredientOptions.map(o => <SelectItem key={o.value} value={o.value}>{o.label} [{o.unit}]</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Data ważności *</Label>
                <Input type="date" value={form.expiryDate} onChange={e => set('expiryDate', e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Nr partii dostawcy</Label>
              <Input placeholder="np. LOT 2026-001" value={form.batchNo} onChange={e => set('batchNo', e.target.value)} />
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.createWZ} onChange={e => set('createWZ', e.target.checked)} className="w-4 h-4 accent-green-600" />
              <CardDescription className="text-xs text-green-700 font-semibold">Utwórz WZ — zasil magazyn przypraw</CardDescription>
            </label>
            {form.createWZ && (
              <CardDescription className="text-xs text-green-700 bg-white border border-green-200 rounded px-3 py-2">
                ✓ Faktura powiązana z WZ — składnik zostanie dodany do magazynu
              </CardDescription>
            )}
          </CardContent>
        </Card>
      )}

      {/* OPAKOWANIA */}
      {cat === 'OPAKOWANIA_TULEJE' && (
        <Card className="border-purple-200 bg-purple-50/50">
          <CardContent className="p-3 space-y-3">
            <CardDescription className="text-[10px] font-bold text-purple-700 uppercase tracking-wide flex items-center gap-1.5">
              <Archive size={11} /> Powiązanie z magazynem opakowań / tulei
            </CardDescription>
            <div className="space-y-1.5">
              <Label>Opakowanie / Tuleja</Label>
              <Select value={form.packagingId || '__none'} onValueChange={v => handlePackagingChange(v === '__none' ? '' : v)}>
                <SelectTrigger><SelectValue placeholder="— bez powiązania —" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">— bez powiązania —</SelectItem>
                  {packagingOptions.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.createWZ} onChange={e => set('createWZ', e.target.checked)} className="w-4 h-4 accent-purple-600" />
              <CardDescription className="text-xs text-purple-700 font-semibold">Utwórz WZ — zasil magazyn opakowań</CardDescription>
            </label>
            {form.createWZ && form.packagingId && (
              <CardDescription className="text-xs text-purple-700 bg-white border border-purple-200 rounded px-3 py-2">
                ✓ Po zapisaniu faktura doda <strong>{qty} szt</strong> do wybranego opakowania/tulei
              </CardDescription>
            )}
            {form.createWZ && !form.packagingId && (
              <CardDescription className="text-xs text-amber-600">⚠ Wybierz opakowanie/tuleję żeby WZ zasilił magazyn</CardDescription>
            )}
          </CardContent>
        </Card>
      )}

      {/* MEDIA/INNE */}
      {(cat === 'MEDIA' || cat === 'INNE') && (
        <Card className="border-amber-200 bg-amber-50/50">
          <CardContent className="px-3 py-2 flex items-center gap-1.5">
            {CATEGORY_ICON[cat]}
            <CardDescription className="text-xs text-amber-700">Zapis wyłącznie księgowy — bez zasilenia magazynu</CardDescription>
          </CardContent>
        </Card>
      )}

      {/* Waluta */}
      <Card className="bg-muted/40 border-transparent">
        <CardContent className="px-4 py-3 flex items-center gap-3 flex-wrap">
          <Label className="text-xs font-bold uppercase tracking-wide flex-shrink-0">Waluta:</Label>
          <div className="flex gap-2">
            {(['PLN','EUR'] as const).map(c => (
              <Button key={c} variant={form.currency === c ? 'default' : 'outline'} size="sm" className="h-7 px-3 text-xs"
                onClick={() => { set('currency', c); if (c === 'EUR' && !form.exchangeRate) fetchNbpRate() }}>
                {c}
              </Button>
            ))}
          </div>
          {form.currency === 'EUR' && (
            <div className="flex items-center gap-2 flex-1">
              <CardDescription className="text-xs flex-shrink-0">Kurs EUR/PLN:</CardDescription>
              <Input type="number" min="0" step="0.0001" placeholder="np. 4.2731"
                value={form.exchangeRate} onChange={e => set('exchangeRate', e.target.value)} className="w-28 h-7 text-xs" />
              <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={fetchNbpRate} disabled={nbpLoading}>
                {nbpLoading ? '...' : '↻ NBP'}
              </Button>
              {form.exchangeRate && <CardDescription className="text-xs text-green-700 font-semibold">kurs: {form.exchangeRate}</CardDescription>}
              {nbpError && <CardDescription className="text-xs text-destructive">{nbpError}</CardDescription>}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Ilość i cena */}
      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-1.5">
          <Label>Ilość ({cat === 'SUROWIEC' || cat === 'PRZYPRAWY_I_DODATKI' ? 'kg' : 'szt'}) *</Label>
          <Input type="number" min="0" step="0.01" value={form.qty} onChange={e => set('qty', e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Cena jedn. ({form.currency}) *</Label>
          <Input type="number" min="0" step="0.01" value={form.unitPrice} onChange={e => set('unitPrice', e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>VAT %</Label>
          <Select value={form.vatRate} onValueChange={v => set('vatRate', v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {['0','5','8','23'].map(v => <SelectItem key={v} value={v}>{v}%</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Kalkulacja */}
      {qty > 0 && unitPrice > 0 && (() => {
        const exchRate = parseFloat(form.exchangeRate) || 1
        const netPln   = form.currency === 'EUR' ? Math.round(net   * exchRate * 100)/100 : net
        const vatPln   = form.currency === 'EUR' ? Math.round(vat   * exchRate * 100)/100 : vat
        const grossPln = form.currency === 'EUR' ? Math.round(gross * exchRate * 100)/100 : gross
        return (
          <Card className="bg-muted/40 border-transparent">
            <CardContent className="px-4 py-3">
              <div className="grid grid-cols-3 gap-2 text-center">
                {[
                  { label: 'Netto',        val: form.currency === 'EUR' ? `${net.toFixed(2)} EUR`   : fmtPln(netPln)   },
                  { label: `VAT ${vatPct}%`, val: form.currency === 'EUR' ? `${vat.toFixed(2)} EUR`   : fmtPln(vatPln)   },
                  { label: 'Brutto',       val: form.currency === 'EUR' ? `${gross.toFixed(2)} EUR` : fmtPln(grossPln) },
                ].map(r => (
                  <div key={r.label}>
                    <CardDescription className="text-[10px] uppercase">{r.label}</CardDescription>
                    <CardTitle className="text-sm font-bold">{r.val}</CardTitle>
                  </div>
                ))}
              </div>
              {form.currency === 'EUR' && form.exchangeRate && (
                <div className="text-center text-xs text-muted-foreground border-t mt-2 pt-2">
                  = <strong>{fmtPln(grossPln)}</strong> PLN (kurs {parseFloat(form.exchangeRate).toFixed(4)})
                </div>
              )}
            </CardContent>
          </Card>
        )
      })()}

      <div className="space-y-1.5">
        <Label>Uwagi</Label>
        <textarea rows={2} value={form.notes} onChange={e => set('notes', e.target.value)}
          className="w-full px-3 py-2 text-sm border border-input rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring resize-none" />
      </div>

      {error && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="px-3 py-2 flex items-center gap-2">
            <AlertTriangle size={13} className="text-destructive flex-shrink-0" />
            <CardDescription className="text-destructive font-medium">{error}</CardDescription>
          </CardContent>
        </Card>
      )}

      <DialogFooter className="gap-2">
        <Button variant="outline" onClick={onClose} disabled={saving}>Anuluj</Button>
        <Button onClick={handleSubmit} disabled={saving || !isValid} className="gap-2">
          {saving ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Plus size={14} />}
          {initial ? 'Zapisz zmiany' : 'Dodaj fakturę'}
        </Button>
      </DialogFooter>
    </div>
  )
}

export function PurchaseInvoicesPage() {
  const { data: invData, loading, refetch } = useApi(() => invoicesApi.list())
  const [modalOpen,    setModalOpen]    = useState(false)
  const [editInvoice,  setEditInvoice]  = useState<PurchaseInvoice | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<PurchaseInvoice | null>(null)
  const [filterCat,    setFilterCat]    = useState<InvoiceCategory | ''>('')
  const [search,       setSearch]       = useState('')
  const [mutLoading,   setMutLoading]   = useState(false)

  const invoices = useMemo(() => {
    let list = invData ?? []
    if (filterCat) list = list.filter(i => i.category === filterCat)
    if (search)    list = list.filter(i =>
      i.invoiceNo.toLowerCase().includes(search.toLowerCase()) ||
      i.supplierName?.toLowerCase().includes(search.toLowerCase())
    )
    return list.sort((a, b) => b.invoiceDate > a.invoiceDate ? 1 : -1)
  }, [invData, filterCat, search])

  const totalGross = invoices.reduce((s, i) => s + ((i as any).totalGross ?? i.grossTotal ?? 0), 0)

  async function handleSave(dto: any) {
    if (editInvoice) await invoicesApi.update(editInvoice.id, dto)
    else await invoicesApi.create(dto)
    refetch()
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setMutLoading(true)
    try { await invoicesApi.delete(deleteTarget.id); refetch() }
    finally { setMutLoading(false); setDeleteTarget(null) }
  }

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Filters + action */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[180px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Szukaj faktury..." className="pl-9 pr-8" />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X size={14} />
            </button>
          )}
        </div>
        <Select value={filterCat || '__all'} onValueChange={v => setFilterCat(v === '__all' ? '' : v as InvoiceCategory)}>
          <SelectTrigger className="w-48"><SelectValue placeholder="Wszystkie" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">Wszystkie kategorie</SelectItem>
            {ALL_CATS.map(c => <SelectItem key={c} value={c}>{CAT_LABELS[c]}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button onClick={() => { setEditInvoice(null); setModalOpen(true) }}>
          <Plus size={14} className="mr-1.5" /> Dodaj fakturę
        </Button>
      </div>

      {/* Table */}
      <Card>
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <div className="flex items-center gap-2">
            <Receipt size={13} className="text-muted-foreground" />
            <CardTitle className="text-sm font-semibold">{invoices.length} faktur</CardTitle>
          </div>
          {invoices.length > 0 && <CardTitle className="text-sm font-bold">Razem: {fmtPln(totalGross)}</CardTitle>}
        </div>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-4 space-y-3">{[0,1,2,3].map(i => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : invoices.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-2">
              <FileText size={36} className="text-muted-foreground opacity-20" />
              <CardTitle className="text-sm font-medium text-muted-foreground">Brak faktur</CardTitle>
              <CardDescription>Dodaj pierwszą fakturę klikając przycisk powyżej</CardDescription>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  {['Nr faktury','Dostawca','Kategoria','Ilość','Brutto',''].map(h => (
                    <TableHead key={h} className="text-xs uppercase tracking-wide">{h}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.map(inv => {
                  const cat = inv.category ?? 'SUROWIEC'
                  return (
                    <TableRow key={inv.id}>
                      <TableCell>
                        <code className="font-mono font-bold text-sm">{inv.invoiceNo}</code>
                        <CardDescription className="text-xs">{fmtDatePl(inv.invoiceDate)}</CardDescription>
                      </TableCell>
                      <TableCell><CardDescription className="text-sm">{inv.supplierName}</CardDescription></TableCell>
                      <TableCell>
                        <Badge variant={CATEGORY_VARIANT[cat]} className="gap-1 text-[10px]">
                          {CATEGORY_ICON[cat]} {CAT_LABELS[cat]}
                        </Badge>
                        {inv.rawBatchNo && <code className="block text-[10px] font-mono text-muted-foreground mt-0.5">{inv.rawBatchNo}</code>}
                        {(inv as any).packagingName && <CardDescription className="text-[10px] text-purple-700 mt-0.5">{(inv as any).packagingName}</CardDescription>}
                      </TableCell>
                      <TableCell>
                        <CardTitle className="text-sm tabular-nums">{inv.qty} {cat === 'OPAKOWANIA_TULEJE' ? 'szt' : 'kg'}</CardTitle>
                        <CardDescription className="text-xs tabular-nums">{fmtPln(inv.unitPrice)}/szt</CardDescription>
                      </TableCell>
                      <TableCell>
                        <CardTitle className="text-sm font-bold tabular-nums">{fmtPln((inv as any).totalGross ?? inv.grossTotal ?? 0)}</CardTitle>
                        {(inv as any).currency === 'EUR' && (inv as any).amountEur && (
                          <CardDescription className="text-xs text-blue-600 font-semibold tabular-nums">
                            {Number((inv as any).amountEur).toFixed(2)} EUR
                          </CardDescription>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" className="h-7 w-7 hover:text-amber-600"
                            onClick={() => { setEditInvoice(inv); setModalOpen(true) }}>
                            <Pencil size={12} />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7 hover:text-destructive"
                            onClick={() => setDeleteTarget(inv)}>
                            <Trash2 size={12} />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Invoice modal */}
      <Dialog open={modalOpen} onOpenChange={v => { if (!v) { setModalOpen(false); setEditInvoice(null) } }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editInvoice ? 'Edytuj fakturę' : 'Dodaj fakturę'}</DialogTitle>
            <DialogDescription>Ewidencja faktur zakupowych</DialogDescription>
          </DialogHeader>
          <InvoiceForm initial={editInvoice} onSave={handleSave} onClose={() => { setModalOpen(false); setEditInvoice(null) }} />
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <Dialog open={!!deleteTarget} onOpenChange={v => { if (!v) setDeleteTarget(null) }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Usuń fakturę</DialogTitle>
            <DialogDescription>
              Usunąć fakturę <strong>{deleteTarget?.invoiceNo}</strong>? Ta operacja jest nieodwracalna.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={mutLoading}>Anuluj</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={mutLoading} className="gap-2">
              {mutLoading ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Trash2 size={14} />}
              Usuń
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
