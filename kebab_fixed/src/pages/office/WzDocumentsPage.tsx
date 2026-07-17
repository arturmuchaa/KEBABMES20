import { Fragment, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { wzApi, downloadDocPdf, WzDoc, WzLine, QuantityChain } from '@/lib/api'
import { cn, fmtDatePl } from '@/lib/utils'
import { WzDocumentView } from '@/components/wz/WzDocumentView'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  Plus, Printer, FileText, Eye, FileSpreadsheet, Pencil, ChevronUp, ChevronDown,
  ChevronsUpDown, AlertTriangle, CheckCircle2, Truck, Search, X, Ban, Loader2,
} from 'lucide-react'

/** Raport rozjazdu: różnice dokument↔załadunek + łańcuch ilości per etap. */
function LoadingReportDialog({ doc, onClose }: { doc: WzDoc; onClose: () => void }) {
  const [chain, setChain] = useState<QuantityChain | null>(null)
  const [chainErr, setChainErr] = useState('')
  const orderId = doc.source_id || doc.sourceId
  useEffect(() => {
    if (!orderId) { setChainErr('Dokument bez powiązanego zamówienia'); return }
    wzApi.quantityChain(orderId)
      .then(setChain)
      .catch(e => setChainErr(e instanceof Error ? e.message : 'Błąd raportu'))
  }, [orderId])

  const diffs = (doc.loading_diff || []).filter(d => d.diff !== 0)
  const STAGES: { key: keyof QuantityChain['lines'][number]; label: string }[] = [
    { key: 'ordered',    label: 'Zamówiono' },
    { key: 'planned',    label: 'Zaplanowano' },
    { key: 'reported',   label: 'Tablet' },
    { key: 'scanned',    label: 'Skan prod.' },
    { key: 'packed',     label: 'W kartonach' },
    { key: 'shipped',    label: 'Wyjechało' },
    { key: 'documented', label: 'Na WZ' },
  ]
  return (
    <Dialog open onOpenChange={open => { if (!open) onClose() }}>
      <DialogContent className="max-w-3xl max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Raport załadunku — {doc.number}
            {doc.loading_status === 'rozjazd'
              ? <Badge variant="danger" className="text-[10px] gap-1"><AlertTriangle size={11} /> ROZJAZD</Badge>
              : <Badge variant="success" className="text-[10px] gap-1"><CheckCircle2 size={11} /> Potwierdzony</Badge>}
            {doc.vehicle_plate && (
              <span className="text-[11px] font-normal text-muted-foreground inline-flex items-center gap-1">
                <Truck size={12} /> {doc.vehicle_plate}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        {doc.loading_status === 'rozjazd' && (
          <div className="text-[12px] bg-red-50 border border-red-200 text-red-800 rounded-md px-3 py-2">
            Faktyczny załadunek różni się od dokumentu — <b>skoryguj WZ przed wystawieniem faktury</b>,
            inaczej klient dostanie fakturę na inną ilość, niż pojechała.
          </div>
        )}

        {diffs.length > 0 && (
          <div>
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">
              Różnice dokument ↔ auto
            </div>
            <Table className="text-[12px]">
              <TableHeader>
                <TableRow>
                  {['Towar', 'Partia', 'Na WZ', 'Na aucie', 'Różnica'].map((h, i) => (
                    <TableHead key={i} className="text-[9px] uppercase tracking-wider h-7 px-2">{h}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {diffs.map((d, i) => (
                  <TableRow key={i}>
                    <TableCell className="py-1.5 px-2 font-medium">{d.name}</TableCell>
                    <TableCell className="py-1.5 px-2 font-mono text-green-700">{d.batch_no || '—'}</TableCell>
                    <TableCell className="py-1.5 px-2 font-mono">{d.doc_qty}</TableCell>
                    <TableCell className="py-1.5 px-2 font-mono">{d.loaded_qty}</TableCell>
                    <TableCell className={cn('py-1.5 px-2 font-mono font-bold', d.diff < 0 ? 'text-red-600' : 'text-amber-600')}>
                      {d.diff > 0 ? `+${d.diff}` : d.diff}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <div>
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">
            Łańcuch ilości — gdzie powstała różnica
          </div>
          {chainErr && <div className="text-[12px] text-muted-foreground">{chainErr}</div>}
          {!chain && !chainErr && <div className="text-[12px] text-muted-foreground">Ładowanie…</div>}
          {chain && (
            <Table className="text-[12px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="text-[9px] uppercase tracking-wider h-7 px-2">Pozycja</TableHead>
                  {STAGES.map(s => (
                    <TableHead key={s.key} className="text-[9px] uppercase tracking-wider h-7 px-2 text-right">{s.label}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {chain.lines.map((l, i) => {
                  const vals = STAGES.map(s => Number(l[s.key] ?? 0))
                  return (
                    <TableRow key={i}>
                      <TableCell className="py-1.5 px-2 font-medium whitespace-nowrap">{l.name}</TableCell>
                      {vals.map((v, j) => {
                        const drop = j > 0 && v < vals[j - 1]
                        return (
                          <TableCell key={j} className={cn('py-1.5 px-2 text-right font-mono',
                            drop && 'bg-red-50 text-red-700 font-bold')}>
                            {v}
                          </TableCell>
                        )
                      })}
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
          <div className="text-[10px] text-muted-foreground mt-1.5">
            Czerwone pole = etap, na którym ubyły sztuki względem poprzedniego. Tak znajdziesz miejsce błędu
            (np. tablet 20 → kartony 19 = zgubiono przy pakowaniu).
          </div>
        </div>

        <div className="flex justify-end">
          <Button variant="outline" onClick={onClose}>Zamknij</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

type SortCol = 'number' | 'date' | 'buyer' | 'value' | 'status'

export function WzDocumentsPage() {
  const nav = useNavigate()
  const [docs, setDocs]       = useState<WzDoc[] | null>(null)
  const [editId, setEditId]   = useState<string | null>(null)
  const [editLines, setEditLines] = useState<WzLine[]>([])
  const [priceStrs, setPriceStrs] = useState<string[]>([])
  const [qtyStrs, setQtyStrs]     = useState<string[]>([])
  const [contStrs, setContStrs]   = useState<string[]>([])
  /** 'prices' = uzupełnianie cen (WZ z zamówień); 'full' = pełna edycja ręcznego WZ. */
  const [editMode, setEditMode]   = useState<'prices' | 'full'>('prices')
  const [editErr, setEditErr] = useState('')
  const [saving, setSaving]   = useState(false)
  const [cancellingId, setCancellingId] = useState<string | null>(null)
  const [previewDoc, setPreviewDoc] = useState<WzDoc | null>(null)
  const [reportDoc, setReportDoc]   = useState<WzDoc | null>(null)
  const [query,   setQuery]   = useState('')
  const [sortCol, setSortCol] = useState<SortCol>('date')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const reload = () => wzApi.list().then(setDocs)
  useEffect(() => { reload() }, [])

  // "3,25" / "3.25" → liczba; pusty/śmieci → 0
  const toNum = (s: string) => {
    const n = parseFloat((s || '').trim().replace(',', '.'))
    return Number.isFinite(n) ? n : 0
  }
  const sanitizeDecimal = (s: string) => {
    const cleaned = s.replace(/[^\d.,]/g, '')
    const firstSep = cleaned.search(/[.,]/)
    if (firstSep === -1) return cleaned
    return cleaned.slice(0, firstSep + 1) + cleaned.slice(firstSep + 1).replace(/[.,]/g, '')
  }

  const openEditor = async (id: string, mode: 'prices' | 'full' = 'prices') => {
    setEditErr('')
    try {
      const doc = await wzApi.byId(id)
      setEditLines(doc.lines || [])
      setPriceStrs((doc.lines || []).map(l => l.price != null ? String(l.price) : ''))
      setQtyStrs((doc.lines || []).map(l => String(l.qty ?? '')))
      setContStrs((doc.lines || []).map(l => (l as any).containers ? String((l as any).containers) : ''))
      setEditMode(mode)
      setEditId(id)
    } catch (e: any) { alert(e?.message || 'Błąd pobierania WZ') }
  }
  const openPreview = async (id: string) => {
    try { setPreviewDoc(await wzApi.byId(id)) }
    catch (e: any) { alert(e?.message || 'Błąd pobierania WZ') }
  }
  const setPriceStr = (i: number, v: string) =>
    setPriceStrs(ps => ps.map((p, j) => j === i ? sanitizeDecimal(v) : p))
  // Pozycje z wagą (total_kg) wyceniane za kg — jak w apply_wz_prices na backendzie
  const lineTotal = (l: WzLine, i: number) => {
    const kg = Number(l.total_kg ?? 0)
    return (kg > 0 ? kg : l.qty) * toNum(priceStrs[i] ?? '')
  }
  const editTotal = editLines.reduce((s, l, i) => s + lineTotal(l, i), 0)

  const savePrices = async () => {
    if (!editId) return
    setEditErr(''); setSaving(true)
    try {
      const prices = editLines.map((_, index) => ({ index, price: toNum(priceStrs[index] ?? '') }))
      await wzApi.updatePrices(editId, prices)
      setEditId(null)
      await reload()
    } catch (e: any) { setEditErr(e?.message || 'Błąd zapisu cen') }
    finally { setSaving(false) }
  }

  // Pełna edycja ręcznego WZ: ilości korygują stan magazynowy o różnicę.
  const saveEdits = async () => {
    if (!editId) return
    setEditErr(''); setSaving(true)
    try {
      const edits = editLines.map((l, index) => ({
        index,
        qty: toNum(qtyStrs[index] ?? '') || undefined,
        price: (priceStrs[index] ?? '').trim() !== '' ? toNum(priceStrs[index]) : undefined,
        ...((l as any).stock_type && (l as any).stock_type !== 'fg'
          ? { containers: parseInt(contStrs[index] || '') || 0 }
          : {}),
      }))
      await wzApi.updateLines(editId, edits)
      setEditId(null)
      await reload()
    } catch (e: any) { setEditErr(e?.message || 'Błąd zapisu zmian') }
    finally { setSaving(false) }
  }

  const cancelWz = async (d: WzDoc) => {
    if (!window.confirm(
      `Anulować WZ ${d.number} (${d.buyer_name || 'brak odbiorcy'})?\n\nWszystkie pozycje wrócą na magazyn w całości (kg/szt i pojemniki). Dokument NIE zostanie usunięty — zmieni tylko status na „Anulowany".`
    )) return
    setCancellingId(d.id)
    try {
      await wzApi.cancel(d.id)
      if (editId === d.id) setEditId(null)
      await reload()
    } catch (e: any) {
      alert(e?.message || 'Błąd anulowania WZ')
    } finally {
      setCancellingId(null)
    }
  }

  const toggleSort = (col: SortCol) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir(col === 'date' ? 'desc' : 'asc') }
  }
  const SortIcon = ({ col }: { col: SortCol }) =>
    sortCol === col
      ? (sortDir === 'asc' ? <ChevronUp size={11} /> : <ChevronDown size={11} />)
      : <ChevronsUpDown size={11} className="opacity-30 group-hover:opacity-60" />

  // Wyszukiwanie: numer, odbiorca, NIP. Sortowanie: klik nagłówka (Subiekt).
  const visibleDocs = (docs ?? [])
    .filter(d => {
      const q = query.toLowerCase().trim()
      if (!q) return true
      return `${d.number} ${d.buyer_name ?? ''} ${d.buyer_nip ?? ''}`.toLowerCase().includes(q)
    })
    .sort((a, b) => {
      let cmp = 0
      if (sortCol === 'number') cmp = (a.number || '').localeCompare(b.number || '', 'pl', { numeric: true })
      if (sortCol === 'date')   cmp = (a.issued_date || '').localeCompare(b.issued_date || '')
      if (sortCol === 'buyer')  cmp = (a.buyer_name || '').localeCompare(b.buyer_name || '', 'pl')
      if (sortCol === 'value')  cmp = (a.total_value ?? 0) - (b.total_value ?? 0)
      if (sortCol === 'status') cmp = (a.status || '').localeCompare(b.status || '')
      return sortDir === 'asc' ? cmp : -cmp
    })

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold leading-tight">Dokumenty WZ</h1>
          <div className="text-[11px] text-muted-foreground">Wydania zewnętrzne — sprzedaż z magazynu</div>
        </div>
        <Button className="gap-1.5" onClick={() => nav('/office/wz/nowy')}>
          <Plus size={14} /> Nowy WZ
        </Button>
      </div>

      <Card>
        <div className="px-4 py-2.5 border-b flex items-center gap-3 flex-wrap">
          <span className="text-[13px] font-semibold whitespace-nowrap">
            {visibleDocs.length}{docs && visibleDocs.length !== docs.length ? `/${docs.length}` : ''} dokumentów
          </span>
          <div className="relative flex-1 max-w-xs ml-auto">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="h-8 pl-8 pr-7 text-[12px]"
              placeholder="Szukaj: numer, odbiorca, NIP…"
              value={query}
              onChange={e => setQuery(e.target.value)}
            />
            {query && (
              <button onClick={() => setQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-ink">
                <X size={12} />
              </button>
            )}
          </div>
        </div>
        {!docs ? (
          <div className="p-4 space-y-2">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-10 w-full" />)}
          </div>
        ) : !docs.length ? (
          <div className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
            <FileSpreadsheet size={32} />
            <div className="font-semibold">Brak dokumentów WZ</div>
            <div className="text-sm">Wystaw pierwszy dokument przyciskiem „Nowy WZ"</div>
          </div>
        ) : visibleDocs.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
            <Search size={28} className="opacity-40" />
            <div className="text-sm">Brak wyników dla „{query}"</div>
          </div>
        ) : (
          <Table className="text-[12px]">
            <TableHeader>
              <TableRow>
                {([
                  { col: 'number' as SortCol, label: 'Numer' },
                  { col: 'date'   as SortCol, label: 'Data' },
                  { col: 'buyer'  as SortCol, label: 'Odbiorca' },
                  { col: 'value'  as SortCol, label: 'Wartość', right: true },
                  { col: 'status' as SortCol, label: 'Status' },
                ]).map(h => (
                  <TableHead key={h.col}
                    onClick={() => toggleSort(h.col)}
                    className={cn(
                      'group cursor-pointer select-none text-[9px] uppercase tracking-wider h-8 px-3 hover:text-ink',
                      h.right && 'text-right',
                    )}>
                    <span className={cn('inline-flex items-center gap-1', h.right && 'flex-row-reverse')}>
                      {h.label}<SortIcon col={h.col} />
                    </span>
                  </TableHead>
                ))}
                <TableHead className="text-[9px] uppercase tracking-wider h-8 px-3">Załadunek</TableHead>
                <TableHead className="text-[9px] uppercase tracking-wider h-8 px-3" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleDocs.map(d => {
                const cancelled = d.status === 'anulowany'
                return (
                <Fragment key={d.id}>
                  <TableRow className={cn('hover:bg-muted/50', cancelled && 'opacity-50')}>
                    <TableCell className="py-2 px-3 font-mono font-bold text-primary">{d.number}</TableCell>
                    <TableCell className="py-2 px-3">{fmtDatePl(d.issued_date)}</TableCell>
                    <TableCell className="py-2 px-3 font-medium">{d.buyer_name}</TableCell>
                    <TableCell className="py-2 px-3 text-right font-mono">
                      {d.valued
                        ? `${(d.total_value ?? 0).toFixed(2)} ${(d.currency || 'PLN').toUpperCase() === 'EUR' ? '€' : 'zł'}`
                        : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="py-2 px-3">
                      {cancelled
                        ? <Badge variant="danger" className="text-[10px] gap-1"><Ban size={10} /> Anulowany</Badge>
                        : d.valued
                        ? <Badge variant="success" className="text-[10px]">Wyceniony</Badge>
                        : <Badge variant="warning" className="text-[10px]">Do wyceny</Badge>}
                    </TableCell>
                    <TableCell className="py-2 px-3">
                      {d.loading_status === 'rozjazd' ? (
                        <button onClick={() => setReportDoc(d)} title="Raport rozjazdu">
                          <Badge variant="danger" className="text-[10px] gap-1 cursor-pointer hover:bg-red-200">
                            <AlertTriangle size={10} /> ROZJAZD
                          </Badge>
                        </button>
                      ) : d.loading_status === 'potwierdzony' ? (
                        <button onClick={() => setReportDoc(d)} title="Raport załadunku">
                          <Badge variant="success" className="text-[10px] gap-1 cursor-pointer hover:bg-green-200">
                            <CheckCircle2 size={10} /> Potwierdzony
                          </Badge>
                        </button>
                      ) : (
                        <span className="text-muted-foreground text-[11px]">—</span>
                      )}
                    </TableCell>
                    <TableCell className="py-1.5 px-3">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-primary"
                                title="Podgląd" onClick={() => openPreview(d.id)}>
                          <Eye size={13} />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-primary"
                                title="Drukuj" onClick={() => window.open(`/office/wz/${d.id}/druk`, '_blank')}>
                          <Printer size={13} />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-primary"
                                title="PDF" onClick={() => void downloadDocPdf(wzApi.pdfUrl(d.id)).catch(e => alert(e?.message || 'Nie udało się pobrać PDF'))}>
                          <FileText size={13} />
                        </Button>
                        {!cancelled && ((d as any).source_type === 'manual' ? (
                          <Button variant="outline" size="sm"
                                  className="h-7 text-[11px] gap-1 text-amber-700 border-amber-200 hover:bg-amber-50"
                                  onClick={() => editId === d.id ? setEditId(null) : openEditor(d.id, 'full')}>
                            {editId === d.id ? <><ChevronUp size={12} /> Zwiń</> : <><Pencil size={12} /> Edytuj</>}
                          </Button>
                        ) : !d.valued && d.status === 'wstepny' && (
                          <Button variant="outline" size="sm"
                                  className="h-7 text-[11px] gap-1 text-amber-700 border-amber-200 hover:bg-amber-50"
                                  onClick={() => editId === d.id ? setEditId(null) : openEditor(d.id, 'prices')}>
                            {editId === d.id ? <><ChevronUp size={12} /> Zwiń</> : <><Pencil size={12} /> Uzupełnij ceny</>}
                          </Button>
                        ))}
                        {!cancelled && (d as any).source_type === 'manual' && (
                          <Button variant="outline" size="sm"
                                  className="h-7 text-[11px] gap-1 text-red-700 border-red-200 hover:bg-red-50"
                                  disabled={cancellingId === d.id}
                                  onClick={() => cancelWz(d)}>
                            {cancellingId === d.id ? <Loader2 size={12} className="animate-spin" /> : <Ban size={12} />}
                            Anuluj
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                  {editId === d.id && (
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={7} className="bg-muted/30 p-4">
                        <div className="max-w-2xl">
                          <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">
                            {editMode === 'full' ? 'Edycja dokumentu' : 'Uzupełnij ceny'} — {d.number}
                          </div>
                          {editMode === 'full' && (
                            <div className="flex items-start gap-2 text-[12px] text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 mb-2">
                              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                              <span>
                                Zmiana <b>ilości</b> koryguje stany magazynowe o różnicę, ale dokument mógł już
                                trafić do odbiorcy — korekty mogą zaburzyć spójność traceability (HDI, raporty partii).
                                Wpisuj stan faktyczny z załadunku.
                              </span>
                            </div>
                          )}
                          <Table className="text-[12px] bg-background rounded-md border">
                            <TableHeader>
                              <TableRow>
                                {['Towar', 'Partia', 'Ilość', 'j.m.', ...(editMode === 'full' ? ['Pojemniki'] : ['Waga']), 'Cena/kg', 'Wartość'].map((h, i) => (
                                  <TableHead key={i} className="text-[9px] uppercase tracking-wider h-7 px-2">{h}</TableHead>
                                ))}
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {editLines.map((l, i) => {
                                const kg = Number(l.total_kg ?? 0)
                                return (
                                  <TableRow key={i}>
                                    <TableCell className="py-1.5 px-2 font-medium">{l.name}</TableCell>
                                    <TableCell className="py-1.5 px-2 font-mono text-green-700">{l.batch_no || '—'}</TableCell>
                                    <TableCell className="py-1.5 px-2 font-mono">
                                      {editMode === 'full' ? (
                                        <Input type="text" inputMode="decimal"
                                               value={qtyStrs[i] ?? ''}
                                               className="h-8 w-24 font-mono"
                                               onFocus={e => e.target.select()}
                                               onChange={e => setQtyStrs(qs => qs.map((q, j) => j === i ? sanitizeDecimal(e.target.value) : q))} />
                                      ) : l.qty}
                                    </TableCell>
                                    <TableCell className="py-1.5 px-2 text-muted-foreground">{l.unit}</TableCell>
                                    {editMode === 'full' ? (
                                      <TableCell className="py-1.5 px-2">
                                        {(l as any).stock_type && (l as any).stock_type !== 'fg' ? (
                                          <Input type="text" inputMode="numeric" placeholder="—"
                                                 value={contStrs[i] ?? ''}
                                                 className="h-8 w-16 font-mono"
                                                 onFocus={e => e.target.select()}
                                                 onChange={e => setContStrs(cs => cs.map((c, j) => j === i ? e.target.value.replace(/\D/g, '') : c))} />
                                        ) : <span className="text-muted-foreground">—</span>}
                                      </TableCell>
                                    ) : (
                                      <TableCell className="py-1.5 px-2 font-mono">{kg > 0 ? `${kg} kg` : '—'}</TableCell>
                                    )}
                                    <TableCell className="py-1.5 px-2">
                                      <Input type="text" inputMode="decimal" placeholder="0,00"
                                             value={priceStrs[i] ?? ''}
                                             className="h-8 w-24 font-mono"
                                             onFocus={e => e.target.select()}
                                             onChange={e => setPriceStr(i, e.target.value)} />
                                    </TableCell>
                                    <TableCell className="py-1.5 px-2 text-right font-mono font-semibold">
                                      {(editMode === 'full'
                                        ? (Number(l.total_kg ?? 0) > 0 || l.unit === 'kg' ? toNum(qtyStrs[i] ?? '') : toNum(qtyStrs[i] ?? '')) * toNum(priceStrs[i] ?? '')
                                        : lineTotal(l, i)
                                      ).toFixed(2)}
                                    </TableCell>
                                  </TableRow>
                                )
                              })}
                            </TableBody>
                          </Table>
                          <div className="flex items-center justify-between mt-3">
                            <div className="text-[12px]">
                              <span className="text-muted-foreground uppercase tracking-wider text-[10px] mr-2">Razem</span>
                              <span className="font-mono font-bold text-base">
                                {(editMode === 'full'
                                  ? editLines.reduce((sum, l, i) => sum + toNum(qtyStrs[i] ?? '') * toNum(priceStrs[i] ?? ''), 0)
                                  : editTotal
                                ).toFixed(2)} zł
                              </span>
                            </div>
                            <Button size="sm" disabled={saving} onClick={editMode === 'full' ? saveEdits : savePrices} className="gap-1.5">
                              {saving ? 'Zapisywanie…' : editMode === 'full' ? 'Zapisz zmiany' : 'Zapisz ceny'}
                            </Button>
                          </div>
                          {editErr && (
                            <div className="text-[12px] text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2 mt-2">
                              {editErr}
                            </div>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              )})}
            </TableBody>
          </Table>
        )}
      </Card>

      <Dialog open={!!previewDoc} onOpenChange={open => { if (!open) setPreviewDoc(null) }}>
        <DialogContent className="max-w-[880px] max-h-[85vh] overflow-y-auto bg-surface-3 p-6">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3">
              Podgląd dokumentu {previewDoc?.number}
              {previewDoc && (
                <span className="flex gap-1.5">
                  <Button variant="outline" size="sm" className="h-7 text-[11px] gap-1"
                          onClick={() => window.open(`/office/wz/${previewDoc.id}/druk`, '_blank')}>
                    <Printer size={12} /> Drukuj
                  </Button>
                  <Button variant="outline" size="sm" className="h-7 text-[11px] gap-1"
                          onClick={() => void downloadDocPdf(wzApi.pdfUrl(previewDoc.id)).catch(e => alert(e?.message || 'Nie udało się pobrać PDF'))}>
                    <FileText size={12} /> PDF
                  </Button>
                </span>
              )}
            </DialogTitle>
          </DialogHeader>
          {previewDoc && (
            <div className="shadow-lg border border-surface-4 w-fit mx-auto">
              <WzDocumentView doc={previewDoc} />
            </div>
          )}
        </DialogContent>
      </Dialog>

      {reportDoc && <LoadingReportDialog doc={reportDoc} onClose={() => setReportDoc(null)} />}
    </div>
  )
}
