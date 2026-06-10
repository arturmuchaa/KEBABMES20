import { Fragment, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { wzApi, WzDoc, WzLine } from '@/lib/api'
import { fmtDatePl } from '@/lib/utils'
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
import { Plus, Printer, FileText, Eye, FileSpreadsheet, Pencil, ChevronUp } from 'lucide-react'

export function WzDocumentsPage() {
  const nav = useNavigate()
  const [docs, setDocs]       = useState<WzDoc[] | null>(null)
  const [editId, setEditId]   = useState<string | null>(null)
  const [editLines, setEditLines] = useState<WzLine[]>([])
  const [priceStrs, setPriceStrs] = useState<string[]>([])
  const [editErr, setEditErr] = useState('')
  const [saving, setSaving]   = useState(false)
  const [previewDoc, setPreviewDoc] = useState<WzDoc | null>(null)

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

  const openEditor = async (id: string) => {
    setEditErr('')
    try {
      const doc = await wzApi.byId(id)
      setEditLines(doc.lines || [])
      setPriceStrs((doc.lines || []).map(l => l.price != null ? String(l.price) : ''))
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
        <div className="px-4 py-2.5 border-b">
          <span className="text-[13px] font-semibold">{docs?.length ?? '…'} dokumentów</span>
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
        ) : (
          <Table className="text-[12px]">
            <TableHeader>
              <TableRow>
                {['Numer', 'Data', 'Odbiorca', 'Wartość', 'Status', ''].map((h, i) => (
                  <TableHead key={i} className={`text-[9px] uppercase tracking-wider h-8 px-3 ${h === 'Wartość' ? 'text-right' : ''}`}>{h}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {docs.map(d => (
                <Fragment key={d.id}>
                  <TableRow className="hover:bg-muted/50">
                    <TableCell className="py-2 px-3 font-mono font-bold text-primary">{d.number}</TableCell>
                    <TableCell className="py-2 px-3">{fmtDatePl(d.issued_date)}</TableCell>
                    <TableCell className="py-2 px-3 font-medium">{d.buyer_name}</TableCell>
                    <TableCell className="py-2 px-3 text-right font-mono">
                      {d.valued
                        ? `${(d.total_value ?? 0).toFixed(2)} ${(d.currency || 'PLN').toUpperCase() === 'EUR' ? '€' : 'zł'}`
                        : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="py-2 px-3">
                      {d.valued
                        ? <Badge variant="success" className="text-[10px]">Wyceniony</Badge>
                        : <Badge variant="warning" className="text-[10px]">Do wyceny</Badge>}
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
                                title="PDF" onClick={() => window.open(wzApi.pdfUrl(d.id), '_blank')}>
                          <FileText size={13} />
                        </Button>
                        {!d.valued && d.status === 'wstepny' && (
                          <Button variant="outline" size="sm"
                                  className="h-7 text-[11px] gap-1 text-amber-700 border-amber-200 hover:bg-amber-50"
                                  onClick={() => editId === d.id ? setEditId(null) : openEditor(d.id)}>
                            {editId === d.id ? <><ChevronUp size={12} /> Zwiń</> : <><Pencil size={12} /> Uzupełnij ceny</>}
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                  {editId === d.id && (
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={6} className="bg-muted/30 p-4">
                        <div className="max-w-2xl">
                          <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">
                            Uzupełnij ceny — {d.number}
                          </div>
                          <Table className="text-[12px] bg-background rounded-md border">
                            <TableHeader>
                              <TableRow>
                                {['Towar', 'Partia', 'Ilość', 'j.m.', 'Waga', 'Cena/kg', 'Wartość'].map((h, i) => (
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
                                    <TableCell className="py-1.5 px-2 font-mono">{l.qty}</TableCell>
                                    <TableCell className="py-1.5 px-2 text-muted-foreground">{l.unit}</TableCell>
                                    <TableCell className="py-1.5 px-2 font-mono">{kg > 0 ? `${kg} kg` : '—'}</TableCell>
                                    <TableCell className="py-1.5 px-2">
                                      <Input type="text" inputMode="decimal" placeholder="0,00"
                                             value={priceStrs[i] ?? ''}
                                             className="h-8 w-24 font-mono"
                                             onFocus={e => e.target.select()}
                                             onChange={e => setPriceStr(i, e.target.value)} />
                                    </TableCell>
                                    <TableCell className="py-1.5 px-2 text-right font-mono font-semibold">
                                      {lineTotal(l, i).toFixed(2)}
                                    </TableCell>
                                  </TableRow>
                                )
                              })}
                            </TableBody>
                          </Table>
                          <div className="flex items-center justify-between mt-3">
                            <div className="text-[12px]">
                              <span className="text-muted-foreground uppercase tracking-wider text-[10px] mr-2">Razem</span>
                              <span className="font-mono font-bold text-base">{editTotal.toFixed(2)} zł</span>
                            </div>
                            <Button size="sm" disabled={saving} onClick={savePrices} className="gap-1.5">
                              {saving ? 'Zapisywanie…' : 'Zapisz ceny'}
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
              ))}
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
                          onClick={() => window.open(wzApi.pdfUrl(previewDoc.id), '_blank')}>
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
    </div>
  )
}
