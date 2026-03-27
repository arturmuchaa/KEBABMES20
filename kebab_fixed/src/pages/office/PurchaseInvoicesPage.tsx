/**
 * PurchaseInvoicesPage v2
 * + kategoria OPAKOWANIA_TULEJE z WZ do magazynu
 * + PRZYPRAWY — powiązanie WZ (przypisanie do konkretnego przyjęcia)
 * + SUROWIEC — wiele partii z auto-sumą kg
 */
import { useState, useMemo, useCallback } from 'react'
import { useApi } from '@/hooks/useApi'
import { suppliersApi, rawBatchesApi, invoicesApi, ingredientsApi, packagingApi } from '@/lib/apiClient'
import type { PurchaseInvoice, CreatePurchaseInvoiceDto, InvoiceCategory } from '@/lib/mockApi'
import { INVOICE_CATEGORY_LABELS as CAT_LABELS } from '@/lib/mockApi'
import { Spinner, EmptyState, Modal , PageHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { fmtPln, fmtDatePl, fmtKg, todayIso } from '@/lib/utils'
import { Plus, FileText, Pencil, Trash2, Receipt, Search, X, AlertTriangle, Package, FlaskConical, Zap, Tag, Archive } from 'lucide-react'

const CATEGORY_ICON: Record<InvoiceCategory, React.ReactNode> = {
  SUROWIEC:            <Package size={13} />,
  PRZYPRAWY_I_DODATKI: <FlaskConical size={13} />,
  OPAKOWANIA_TULEJE:   <Archive size={13} />,
  MEDIA:               <Zap size={13} />,
  INNE:                <Tag size={13} />,
}
const CATEGORY_COLOR: Record<InvoiceCategory, string> = {
  SUROWIEC:            'bg-blue-50 text-blue-700',
  PRZYPRAWY_I_DODATKI: 'bg-green-500/15 text-green-400',
  OPAKOWANIA_TULEJE:   'bg-purple-50 text-purple-700',
  MEDIA:               'bg-amber-500/15 text-amber-400',
  INNE:                'bg-slate-50 text-slate-900-3',
}

const ALL_CATS: InvoiceCategory[] = ['SUROWIEC','PRZYPRAWY_I_DODATKI','OPAKOWANIA_TULEJE','MEDIA','INNE']

interface FormState {
  invoiceNo:    string
  supplierId:   string
  category:     InvoiceCategory
  invoiceDate:  string
  dueDate:      string
  qty:          string
  unitPrice:    string
  vatRate:      string
  notes:        string
  rawBatchIds:  string[]
  lineName:     string
  ingredientId: string
  expiryDate:   string
  batchNo:      string
  packagingId:  string
  createWZ:     boolean
  currency:     'PLN' | 'EUR'
  exchangeRate: string
}

function emptyForm(cat: InvoiceCategory = 'SUROWIEC'): FormState {
  return {
    invoiceNo:'', supplierId:'', category:cat,
    invoiceDate:todayIso(), dueDate:'',
    qty:'', unitPrice:'', vatRate:'5', notes:'',
    rawBatchIds:[], lineName:'',
    ingredientId:'', expiryDate:'', batchNo:'',
    packagingId:'', createWZ:true,
    currency:'PLN', exchangeRate:'',
  }
}

function fromExisting(inv: PurchaseInvoice): FormState {
  return {
    invoiceNo:    inv.invoiceNo,
    supplierId:   inv.supplierId,
    category:     inv.category ?? 'SUROWIEC',
    invoiceDate:  inv.invoiceDate,
    dueDate:      inv.dueDate ?? '',
    qty:          String(inv.qty),
    unitPrice:    String(inv.unitPrice),
    vatRate:      String(Math.round((inv.vatRate ?? 0.05)*100)),
    notes:        inv.notes ?? '',
    rawBatchIds:  (inv as any).rawBatchIds ?? (inv.rawBatchId ? [inv.rawBatchId] : []),
    lineName:     inv.lines?.[0]?.lineName ?? '',
    ingredientId: (inv as any).ingredientId ?? '',
    expiryDate:   (inv as any).expiryDate ?? '',
    batchNo:      '',
    packagingId:  (inv as any).packagingId ?? '',
    createWZ:     false,
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

  const [form, setForm] = useState<FormState>(initial ? fromExisting(initial) : emptyForm())
  const [nbpLoading, setNbpLoading] = useState(false)
  const [nbpError,   setNbpError]   = useState('')

  // Pobierz kurs EUR/PLN z NBP
  async function fetchNbpRate() {
    setNbpLoading(true); setNbpError('')
    try {
      const res = await fetch('https://api.nbp.pl/api/exchangerates/rates/a/eur/?format=json')
      if (!res.ok) throw new Error('Błąd NBP')
      const data = await res.json()
      const rate = data?.rates?.[0]?.mid
      if (rate) set('exchangeRate', String(rate))
      else throw new Error('Brak danych')
    } catch(e) {
      setNbpError('Nie udało się pobrać kursu NBP. Wpisz ręcznie.')
    } finally { setNbpLoading(false) }
  }
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const set = useCallback(<K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm(p => ({ ...p, [k]: v })), [])

  const supplierOptions = (suppData ?? []).map(s => ({ value:s.id, label:s.name }))
  const batchOptions    = (batchData?.data ?? []).map((b: any) => ({
    value:b.id, label:`${b.internalBatchNo} · ${fmtKg(b.kgReceived,0)} kg · ${fmtDatePl(b.receivedDate)}`,
    kg:b.kgReceived, price:b.pricePerKg??0, supplierId:b.supplierId, status:b.status,
  }))
  const ingredientOptions = (ingData ?? []).map((i: any) => ({ value:i.id, label:i.name, unit:i.unit }))
  const packagingOptions  = (pkgData ?? []).map((p: any) => ({
    value:p.id, label:`${p.name} (${p.kgAvailable} ${p.unit} na stanie)`,
    price:0, supplierId:p.supplierId,
  }))

  const cat = form.category

  function handleBatchToggle(id: string) {
    setForm(p => {
      const existing = p.rawBatchIds ?? []
      const newIds = existing.includes(id)
        ? existing.filter(x=>x!==id)
        : [...existing, id]
      const first = newIds.length>0 ? batchOptions.find(x=>x.value===newIds[0]) : null
      const totalKg = newIds.reduce((s,bid) => {
        const b = batchOptions.find(x=>x.value===bid)
        return s+(b?.kg??0)
      }, 0)
      return {
        ...p, rawBatchIds:newIds,
        supplierId: first?.supplierId ?? p.supplierId,
        qty: totalKg>0 ? String(totalKg) : p.qty,
        unitPrice: first&&first.price>0 ? String(first.price) : p.unitPrice,
      }
    })
  }

  function handlePackagingChange(id: string) {
    set('packagingId', id)
    const pkg = packagingOptions.find(x=>x.value===id)
    if (pkg?.supplierId) set('supplierId', pkg.supplierId)
  }

  function handleCategoryChange(c: InvoiceCategory) {
    setForm(p => ({ ...p, category:c, rawBatchIds:[], ingredientId:'', expiryDate:'', batchNo:'', packagingId:'' }))
  }

  const qty       = parseFloat(form.qty)       || 0
  const unitPrice = parseFloat(form.unitPrice) || 0
  const vatPct    = parseFloat(form.vatRate)   || 5
  const vatRate   = vatPct/100
  const { net, vat, gross } = calcAmounts(qty, unitPrice, vatRate)

  const isValid = form.invoiceNo.trim() && form.supplierId && qty>0 && unitPrice>0
    && (cat!=='PRZYPRAWY_I_DODATKI' || (form.ingredientId && form.expiryDate))

  async function handleSubmit() {
    if (!isValid) { setError('Uzupełnij wymagane pola'); return }
    setSaving(true)
    try {
      const exchRate = parseFloat(form.exchangeRate) || undefined
      const grossPln = form.currency==='EUR' && exchRate
        ? Math.round(gross * exchRate * 100)/100 : gross
      await onSave({
        invoiceNo: form.invoiceNo.trim(), supplierId: form.supplierId,
        category: cat, invoiceDate: form.invoiceDate,
        dueDate: form.dueDate||undefined,
        qty,
        unitPrice: form.currency==='EUR' && exchRate ? Math.round(unitPrice * exchRate * 100)/100 : unitPrice,
        vatRate,
        notes: form.notes||undefined,
        rawBatchId:   form.rawBatchIds?.[0]||undefined,
        rawBatchIds:  form.rawBatchIds?.length>0 ? form.rawBatchIds : undefined,
        lineName:     form.lineName||undefined,
        ingredientId: form.ingredientId||undefined,
        expiryDate:   form.expiryDate||undefined,
        batchNo:      form.batchNo||undefined,
        packagingId:  form.packagingId||undefined,
        createWZ:     form.createWZ,
        currency:     form.currency,
        exchangeRate: exchRate,
        amountEur:    form.currency==='EUR' ? gross : undefined,
      })
      onClose()
    } catch(e) { setError(e instanceof Error ? e.message : 'Błąd zapisu') }
    finally { setSaving(false) }
  }

  const selectedBatches = batchOptions.filter(b => form.rawBatchIds.includes(b.value))
  const totalSelectedKg = selectedBatches.reduce((s,b)=>s+b.kg,0)

  return (
    <div className="space-y-4">
      {/* Kategoria */}
      <div>
        <label className="block text-[10px] font-bold text-slate-900-3 uppercase tracking-wide mb-1">Kategoria *</label>
        <div className="grid grid-cols-5 gap-1.5">
          {ALL_CATS.map(c => (
            <button key={c} onClick={() => handleCategoryChange(c)}
              className={`flex flex-col items-center gap-1 py-2 rounded-lg border-2 text-[10px] font-semibold transition-all ${
                cat===c ? 'border-brand bg-slate-900-light text-blue-600' : 'border-slate-200 text-slate-900-3 hover:border-brand/40'
              }`}>
              {CATEGORY_ICON[c]}
              <span className="text-center leading-tight">{CAT_LABELS[c]}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Podstawowe */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-[10px] font-bold text-slate-900-3 uppercase tracking-wide mb-1">Nr faktury *</label>
          <input value={form.invoiceNo} onChange={e=>set('invoiceNo',e.target.value)}
            className="w-full h-9 px-3 text-sm border border-slate-200 focus:outline-none focus:border-brand bg-slate-50" placeholder="FV/2026/001" />
        </div>
        <div>
          <label className="block text-[10px] font-bold text-slate-900-3 uppercase tracking-wide mb-1">Dostawca *</label>
          <select value={form.supplierId} onChange={e=>set('supplierId',e.target.value)}
            className="w-full h-9 px-3 text-sm border border-slate-200 focus:outline-none focus:border-brand bg-slate-50">
            <option value="">Wybierz...</option>
            {supplierOptions.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[10px] font-bold text-slate-900-3 uppercase tracking-wide mb-1">Data faktury *</label>
          <input type="date" value={form.invoiceDate} onChange={e=>set('invoiceDate',e.target.value)}
            className="w-full h-9 px-3 text-sm border border-slate-200 focus:outline-none focus:border-brand bg-slate-50" />
        </div>
        <div>
          <label className="block text-[10px] font-bold text-slate-900-3 uppercase tracking-wide mb-1">Termin płatności</label>
          <input type="date" value={form.dueDate} onChange={e=>set('dueDate',e.target.value)}
            className="w-full h-9 px-3 text-sm border border-slate-200 focus:outline-none focus:border-brand bg-slate-50" />
        </div>
      </div>

      {/* SUROWIEC */}
      {cat==='SUROWIEC' && (
        <div className="border border-blue-200 bg-blue-50/50 p-3 space-y-3">
          <div className="text-[10px] font-bold text-blue-700 uppercase tracking-wide flex items-center gap-1.5">
            <Package size={11} /> Powiązane partie surowca (można zaznaczyć wiele)
          </div>
          <div className="max-h-44 overflow-y-auto border border-blue-200 bg-white divide-y divide-slate-100 rounded">
            {batchOptions.length===0
              ? <div className="px-3 py-2 text-[11px] text-slate-900-3">Brak partii</div>
              : batchOptions.map(o=>{
                  const sel = form.rawBatchIds.includes(o.value)
                  return (
                    <label key={o.value} className={`flex items-center gap-2 px-3 py-2 cursor-pointer text-[12px] hover:bg-blue-50 ${sel?'bg-blue-50':''}`}>
                      <input type="checkbox" checked={sel} onChange={()=>handleBatchToggle(o.value)} className="w-4 h-4 accent-brand" />
                      <span className={sel?'font-bold text-blue-600':o.status==='used'?'text-slate-900-3':'text-slate-900'}>{o.label}</span>
                      {o.status==='used'&&<span className="ml-auto text-[10px] text-slate-900-4">zużyta</span>}
                    </label>
                  )
                })
            }
          </div>
          {selectedBatches.length>0 && (
            <div className="bg-white border border-blue-200 rounded p-2 text-[11px]">
              <span className="font-bold text-blue-700">{selectedBatches.length} partii · </span>
              <span>Suma: <strong>{fmtKg(totalSelectedKg)} kg</strong> → ilość na FV ustawiona automatycznie</span>
            </div>
          )}
          <div>
            <label className="block text-[10px] font-bold text-slate-900-3 uppercase tracking-wide mb-1">Nazwa pozycji</label>
            <input type="text" placeholder="ĆWIARTKA Z KURCZAKA KL. A SCHŁODZONA"
              value={form.lineName} onChange={e=>set('lineName',e.target.value)}
              className="w-full h-9 px-3 text-sm border border-slate-200 focus:outline-none focus:border-brand bg-slate-50" />
          </div>
        </div>
      )}

      {/* PRZYPRAWY */}
      {cat==='PRZYPRAWY_I_DODATKI' && (
        <div className="border border-green-200 bg-green-50/50 p-3 space-y-3">
          <div className="text-[10px] font-bold text-green-700 uppercase tracking-wide flex items-center gap-1.5">
            <FlaskConical size={11} /> Zasilenie magazynu przypraw
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-bold text-slate-900-3 uppercase tracking-wide mb-1">Składnik *</label>
              <select value={form.ingredientId} onChange={e=>set('ingredientId',e.target.value)}
                className="w-full h-9 px-3 text-sm border border-slate-200 focus:outline-none focus:border-brand bg-slate-50">
                <option value="">Wybierz składnik...</option>
                {ingredientOptions.map(o=><option key={o.value} value={o.value}>{o.label} [{o.unit}]</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-900-3 uppercase tracking-wide mb-1">Data ważności *</label>
              <input type="date" value={form.expiryDate} onChange={e=>set('expiryDate',e.target.value)}
                className="w-full h-9 px-3 text-sm border border-slate-200 focus:outline-none focus:border-brand bg-slate-50" />
            </div>
          </div>
          <div>
            <label className="block text-[10px] font-bold text-slate-900-3 uppercase tracking-wide mb-1">Nr partii dostawcy</label>
            <input type="text" placeholder="np. LOT 2026-001" value={form.batchNo} onChange={e=>set('batchNo',e.target.value)}
              className="w-full h-9 px-3 text-sm border border-slate-200 focus:outline-none focus:border-brand bg-slate-50" />
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={form.createWZ} onChange={e=>set('createWZ',e.target.checked)} className="w-4 h-4 accent-brand" />
            <span className="text-[11px] text-green-700 font-semibold">Utwórz WZ — zasil magazyn przypraw</span>
          </label>
          {form.createWZ && (
            <div className="text-[11px] text-green-700 bg-white border border-green-200 px-3 py-2">
              ✓ Faktura powiązana z WZ — składnik zostanie dodany do magazynu
            </div>
          )}
        </div>
      )}

      {/* OPAKOWANIA / TULEJE */}
      {cat==='OPAKOWANIA_TULEJE' && (
        <div className="border border-purple-200 bg-purple-50/50 p-3 space-y-3">
          <div className="text-[10px] font-bold text-purple-700 uppercase tracking-wide flex items-center gap-1.5">
            <Archive size={11} /> Powiązanie z magazynem opakowań / tulei
          </div>
          <div>
            <label className="block text-[10px] font-bold text-slate-900-3 uppercase tracking-wide mb-1">Opakowanie / Tuleja</label>
            <select value={form.packagingId} onChange={e=>handlePackagingChange(e.target.value)}
              className="w-full h-9 px-3 text-sm border border-slate-200 focus:outline-none focus:border-brand bg-slate-50">
              <option value="">— bez powiązania —</option>
              {packagingOptions.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={form.createWZ} onChange={e=>set('createWZ',e.target.checked)} className="w-4 h-4 accent-brand" />
            <span className="text-[11px] text-purple-700 font-semibold">Utwórz WZ — zasil magazyn opakowań</span>
          </label>
          {form.createWZ && form.packagingId && (
            <div className="text-[11px] text-purple-700 bg-white border border-purple-200 px-3 py-2">
              ✓ Po zapisaniu faktura doda <strong>{qty} szt</strong> do wybranego opakowania/tulei
            </div>
          )}
          {form.createWZ && !form.packagingId && (
            <div className="text-[11px] text-amber-600">⚠ Wybierz opakowanie/tuleję żeby WZ zasilił magazyn</div>
          )}
        </div>
      )}

      {/* MEDIA/INNE */}
      {(cat==='MEDIA'||cat==='INNE') && (
        <div className="border border-amber-500/30 bg-amber-500/10/50 p-3">
          <div className="text-[11px] text-amber-700 flex items-center gap-1.5">
            {CATEGORY_ICON[cat]} Zapis wyłącznie księgowy — bez zasilenia magazynu
          </div>
        </div>
      )}

      {/* Waluta */}
      <div className="flex items-center gap-3 p-2.5 bg-slate-50 border border-slate-200 rounded-lg">
        <span className="text-[10px] font-bold text-slate-900-3 uppercase tracking-wide flex-shrink-0">Waluta:</span>
        <div className="flex gap-2">
          {(['PLN','EUR'] as const).map(c=>(
            <button key={c} onClick={()=>{ set('currency',c); if(c==='EUR'&&!form.exchangeRate) fetchNbpRate() }}
              className={`px-3 py-1 rounded text-[12px] font-bold border-2 transition-all ${form.currency===c?'border-brand bg-slate-900 text-white':'border-slate-200 text-slate-900-3 hover:border-brand/40'}`}>
              {c}
            </button>
          ))}
        </div>
        {form.currency==='EUR' && (
          <div className="flex items-center gap-2 flex-1">
            <span className="text-[10px] text-slate-900-3 flex-shrink-0">Kurs EUR/PLN:</span>
            <input type="number" min="0" step="0.0001" placeholder="np. 4.2731"
              value={form.exchangeRate} onChange={e=>set('exchangeRate',e.target.value)}
              className="w-28 h-7 px-2 text-sm border border-slate-200 focus:outline-none focus:border-brand bg-slate-50" />
            <button onClick={fetchNbpRate} disabled={nbpLoading}
              className="px-2 h-7 text-[11px] font-semibold border border-brand text-blue-600 rounded hover:bg-blue-50 disabled:opacity-50 flex-shrink-0">
              {nbpLoading ? '...' : '↻ NBP'}
            </button>
            {form.exchangeRate && <span className="text-[10px] text-green-700 font-semibold flex-shrink-0">kurs: {form.exchangeRate}</span>}
            {nbpError && <span className="text-[10px] text-red-600">{nbpError}</span>}
          </div>
        )}
      </div>

      {/* Ilość i cena */}
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="block text-[10px] font-bold text-slate-900-3 uppercase tracking-wide mb-1">
            Ilość ({cat==='SUROWIEC'||cat==='PRZYPRAWY_I_DODATKI'?'kg':'szt'}) *
          </label>
          <input type="number" min="0" step="0.01" value={form.qty} onChange={e=>set('qty',e.target.value)}
            className="w-full h-9 px-3 text-sm border border-slate-200 focus:outline-none focus:border-brand bg-slate-50" />
        </div>
        <div>
          <label className="block text-[10px] font-bold text-slate-900-3 uppercase tracking-wide mb-1">
            Cena jedn. ({form.currency}) *
          </label>
          <input type="number" min="0" step="0.01" value={form.unitPrice} onChange={e=>set('unitPrice',e.target.value)}
            className="w-full h-9 px-3 text-sm border border-slate-200 focus:outline-none focus:border-brand bg-slate-50" />
        </div>
        <div>
          <label className="block text-[10px] font-bold text-slate-900-3 uppercase tracking-wide mb-1">VAT %</label>
          <select value={form.vatRate} onChange={e=>set('vatRate',e.target.value)}
            className="w-full h-9 px-3 text-sm border border-slate-200 focus:outline-none focus:border-brand bg-slate-50">
            {['0','5','8','23'].map(v=><option key={v} value={v}>{v}%</option>)}
          </select>
        </div>
      </div>

      {qty>0 && unitPrice>0 && (() => {
        const exchRate = parseFloat(form.exchangeRate) || 1
        const netPln   = form.currency==='EUR' ? Math.round(net * exchRate * 100)/100 : net
        const vatPln   = form.currency==='EUR' ? Math.round(vat * exchRate * 100)/100 : vat
        const grossPln = form.currency==='EUR' ? Math.round(gross * exchRate * 100)/100 : gross
        return (
          <div className="bg-slate-50 border border-slate-200 p-3 space-y-2">
            <div className="grid grid-cols-3 gap-2 text-center">
              {[
                {label:'Netto',    val:form.currency==='EUR'?`${net.toFixed(2)} EUR`:fmtPln(netPln)},
                {label:`VAT ${vatPct}%`, val:form.currency==='EUR'?`${vat.toFixed(2)} EUR`:fmtPln(vatPln)},
                {label:'Brutto',   val:form.currency==='EUR'?`${gross.toFixed(2)} EUR`:fmtPln(grossPln)},
              ].map(r=>(
                <div key={r.label}><div className="text-[10px] text-slate-900-3 uppercase">{r.label}</div><div className="font-bold">{r.val}</div></div>
              ))}
            </div>
            {form.currency==='EUR' && form.exchangeRate && (
              <div className="text-center text-[11px] text-slate-900-3 border-t border-slate-200 pt-2">
                = <span className="font-bold text-slate-900">{fmtPln(grossPln)}</span> PLN (kurs {parseFloat(form.exchangeRate).toFixed(4)})
              </div>
            )}
          </div>
        )
      })()}

      <div>
        <label className="block text-[10px] font-bold text-slate-900-3 uppercase tracking-wide mb-1">Uwagi</label>
        <textarea rows={2} value={form.notes} onChange={e=>set('notes',e.target.value)}
          className="w-full px-3 py-2 text-sm border border-slate-200 focus:outline-none focus:border-brand bg-slate-50 resize-none" />
      </div>

      {error && (
        <div className="flex items-center gap-2 text-[12px] text-danger bg-danger-light border border-danger-border px-3 py-2">
          <AlertTriangle size={13}/> {error}
        </div>
      )}

      <div className="flex gap-2">
        <Button variant="secondary" onClick={onClose} className="flex-1">Anuluj</Button>
        <Button onClick={handleSubmit} loading={saving} disabled={!isValid} className="flex-1">
          {initial?'Zapisz zmiany':'Dodaj fakturę'}
        </Button>
      </div>
    </div>
  )
}

function InvoiceRow({ inv, onEdit, onDelete }: {
  inv: PurchaseInvoice; onEdit:(i:PurchaseInvoice)=>void; onDelete:(i:PurchaseInvoice)=>void
}) {
  const cat = inv.category ?? 'SUROWIEC'
  return (
    <tr className="hover:bg-slate-50/60">
      <td className="px-3 py-2.5">
        <div className="font-mono font-bold text-slate-900">{inv.invoiceNo}</div>
        <div className="text-[10px] text-slate-900-3">{fmtDatePl(inv.invoiceDate)}</div>
      </td>
      <td className="px-3 py-2.5 text-sm">{inv.supplierName}</td>
      <td className="px-3 py-2.5">
        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded flex items-center gap-1 w-fit ${CATEGORY_COLOR[cat]}`}>
          {CATEGORY_ICON[cat]} {CAT_LABELS[cat]}
        </span>
        {inv.rawBatchNo && <div className="text-[10px] font-mono text-slate-900-3 mt-0.5">{inv.rawBatchNo}</div>}
        {(inv as any).packagingName && <div className="text-[10px] text-purple-700 mt-0.5">{(inv as any).packagingName}</div>}
      </td>
      <td className="px-3 py-2.5 text-right">
        <div className="font-semibold">{inv.qty} {cat==='OPAKOWANIA_TULEJE'?'szt':'kg'}</div>
        <div className="text-[10px] text-slate-900-3">{fmtPln(inv.unitPrice)}/kg</div>
      </td>
      <td className="px-3 py-2.5 text-right">
        <div className="font-bold">{fmtPln((inv as any).totalGross ?? inv.grossTotal ?? 0)}</div>
        {(inv as any).currency==='EUR' && (inv as any).amountEur && (
          <div className="text-[10px] text-blue-600 font-semibold">
            {Number((inv as any).amountEur).toFixed(2)} EUR
          </div>
        )}
      </td>
      <td className="px-3 py-2.5">
        <div className="flex gap-1">
          <button onClick={()=>onEdit(inv)} className="p-1.5 rounded border border-slate-200 text-slate-900-3 hover:border-warn hover:text-warn"><Pencil size={13}/></button>
          <button onClick={()=>onDelete(inv)} className="p-1.5 rounded border border-slate-200 text-slate-900-3 hover:border-danger hover:text-danger"><Trash2 size={13}/></button>
        </div>
      </td>
    </tr>
  )
}

export function PurchaseInvoicesPage() {
  const { data: invData, loading, refetch } = useApi(() => invoicesApi.list())
  const [modalOpen,    setModalOpen]    = useState(false)
  const [editInvoice,  setEditInvoice]  = useState<PurchaseInvoice|null>(null)
  const [deleteTarget, setDeleteTarget] = useState<PurchaseInvoice|null>(null)
  const [filterCat,    setFilterCat]    = useState<InvoiceCategory|''>('')
  const [search,       setSearch]       = useState('')
  const [mutLoading,   setMutLoading]   = useState(false)

  const invoices = useMemo(() => {
    let list = invData ?? []
    if (filterCat) list = list.filter(i=>i.category===filterCat)
    if (search)    list = list.filter(i=>i.invoiceNo.toLowerCase().includes(search.toLowerCase())||i.supplierName?.toLowerCase().includes(search.toLowerCase()))
    return list.sort((a,b)=>b.invoiceDate>a.invoiceDate?1:-1)
  }, [invData, filterCat, search])

  const totalGross = invoices.reduce((s,i)=>s+((i as any).totalGross ?? i.grossTotal ?? 0),0)

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

      <PageHeader title="Faktury zakupowe" subtitle="Dokumenty WZ i faktury" />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[16px] font-bold text-slate-900">Faktury zakupowe</h1>
          <p className="text-[11px] text-slate-900-3 mt-0.5">Ewidencja faktur — surowiec, przyprawy, opakowania, media</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[180px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-900-4"/>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Szukaj faktury..."
            className="w-full h-9 pl-9 pr-8 text-sm border border-slate-200 focus:outline-none focus:border-brand bg-slate-50"/>
          {search&&<button onClick={()=>setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-900-4"><X size={14}/></button>}
        </div>
        <select value={filterCat} onChange={e=>setFilterCat(e.target.value as any)}
          className="h-9 px-3 text-sm border border-slate-200 focus:outline-none focus:border-brand bg-slate-50">
          <option value="">Wszystkie</option>
          {ALL_CATS.map(c=><option key={c} value={c}>{CAT_LABELS[c]}</option>)}
        </select>
        <Button icon={<Plus size={14}/>} onClick={()=>{setEditInvoice(null);setModalOpen(true)}}>Dodaj fakturę</Button>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl">
        <div className="px-4 py-2.5 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Receipt size={13} className="text-slate-900-3"/>
            <span className="text-[13px] font-semibold text-slate-900">{invoices.length} faktur</span>
          </div>
          {invoices.length>0&&<span className="text-[12px] font-bold text-slate-900">Razem: {fmtPln(totalGross)}</span>}
        </div>
        {loading?<div className="flex justify-center py-10"><Spinner size={20}/></div>
        :invoices.length===0?<EmptyState icon={<FileText size={32}/>} title="Brak faktur" message="Dodaj pierwszą fakturę"/>
        :(
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                {['Nr faktury','Dostawca','Kategoria','Ilość','Brutto',''].map(h=>(
                  <th key={h} className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-900-4">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {invoices.map(inv=><InvoiceRow key={inv.id} inv={inv} onEdit={i=>{setEditInvoice(i);setModalOpen(true)}} onDelete={setDeleteTarget}/>)}
            </tbody>
          </table>
        )}
      </div>

      {modalOpen&&(
        <Modal open title={editInvoice?'Edytuj fakturę':'Dodaj fakturę'} onClose={()=>{setModalOpen(false);setEditInvoice(null)}} size="lg">
          <InvoiceForm initial={editInvoice} onSave={handleSave} onClose={()=>{setModalOpen(false);setEditInvoice(null)}}/>
        </Modal>
      )}
      {deleteTarget&&(
        <Modal open title="Usuń fakturę" onClose={()=>setDeleteTarget(null)}>
          <p className="text-sm text-slate-900-3 mb-5">Usunąć fakturę <strong>{deleteTarget.invoiceNo}</strong>?</p>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={()=>setDeleteTarget(null)} className="flex-1">Anuluj</Button>
            <Button variant="danger" onClick={handleDelete} loading={mutLoading} className="flex-1">Usuń</Button>
          </div>
        </Modal>
      )}
    </div>
  )
}
