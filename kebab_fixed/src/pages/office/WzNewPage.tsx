import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { wzApi, clientsApi, settingsApi, WzDoc } from '@/lib/api'
import { todayIso, cn } from '@/lib/utils'
import { WzDocumentView, WzDocData } from '@/components/wz/WzDocumentView'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  ArrowLeft, Plus, Trash2, Search, Eye, Printer, FileText,
  FileCheck2, CheckCircle2, Package, Beef, AlertTriangle,
} from 'lucide-react'

type Row = {
  stockType: 'fg' | 'raw'; stockId: string; name: string; unit: string
  qty: number; price: number; batchNo?: string; available: number
}

const isForeignNip = (nip: string) => {
  const s = (nip || '').trim().toUpperCase()
  return s.length >= 2 && /^[A-Z]{2}/.test(s) && s.slice(0, 2) !== 'PL'
}

export function WzNewPage() {
  const nav = useNavigate()
  const [clients, setClients] = useState<any[]>([])
  const [fg, setFg]   = useState<any[]>([])
  const [raw, setRaw] = useState<any[]>([])
  const [seller, setSeller] = useState<{ name?: string; address?: string; nip?: string }>({})

  const [buyer, setBuyer] = useState({ name: '', address: '', nip: '' })
  const [rows, setRows]   = useState<Row[]>([])
  const [tab, setTab]     = useState<'fg' | 'raw'>('fg')
  const [query, setQuery] = useState('')

  const [valued, setValued]           = useState(true)
  const [issuedDate, setIssuedDate]   = useState(todayIso())
  const [releaseDate, setReleaseDate] = useState(todayIso())
  const [place, setPlace]             = useState('')
  const [notes, setNotes]             = useState('')

  const [preview, setPreview] = useState(false)
  const [saving, setSaving]   = useState(false)
  const [err, setErr]         = useState('')
  const [savedDoc, setSavedDoc] = useState<WzDoc | null>(null)

  useEffect(() => {
    clientsApi.list().then(setClients)
    wzApi.stockFg().then(setFg)
    wzApi.stockRaw().then(setRaw)
    settingsApi.getCompany().then(c => {
      setSeller({
        name: c.name,
        address: [c.address, [c.postalCode, c.city].filter(Boolean).join(' ')].filter(Boolean).join(', '),
        nip: c.nip,
      })
      setPlace(p => p || c.city || '')
    }).catch(() => {})
  }, [])

  const foreign = useMemo(() => isForeignNip(buyer.nip), [buyer.nip])
  const total = rows.reduce((s, r) => s + r.qty * r.price, 0)
  const overdrawn = rows.filter(r => r.qty > r.available)

  const pickClient = (id: string) => {
    const c = clients.find(x => x.id === id)
    if (c) setBuyer({
      name: c.name || c.displayName || '',
      address: `${c.address || ''} ${c.city || ''}`.trim(),
      nip: c.nip || '',
    })
  }

  const addedIds = useMemo(() => new Set(rows.map(r => r.stockId)), [rows])
  const addFg = (g: any) => setRows(r => [...r, {
    stockType: 'fg', stockId: g.id, name: g.recipe_name || g.product_type_name || 'Wyrób',
    unit: 'szt', qty: 1, price: 0, batchNo: g.batch_no, available: Number(g.qty_available || 0),
  }])
  const addRaw = (b: any) => setRows(r => [...r, {
    stockType: 'raw', stockId: b.id, name: `Surowiec ${b.internal_batch_no}`,
    unit: 'kg', qty: 1, price: 0, batchNo: b.internal_batch_no, available: Number(b.kg_available || 0),
  }])
  const upd = (i: number, k: 'qty' | 'price', v: number) =>
    setRows(r => r.map((x, j) => j === i ? { ...x, [k]: v } : x))
  const del = (i: number) => setRows(r => r.filter((_, j) => j !== i))

  const q = query.trim().toLowerCase()
  const fgFiltered = fg.filter(g =>
    !q || `${g.recipe_name || ''} ${g.product_type_name || ''} ${g.batch_no || ''}`.toLowerCase().includes(q))
  const rawFiltered = raw.filter(b =>
    !q || `${b.internal_batch_no || ''} ${b.supplier_name || ''}`.toLowerCase().includes(q))

  const draftDoc: WzDocData = {
    number: savedDoc?.number,
    place, issued_date: issuedDate, release_date: releaseDate,
    seller,
    buyer_name: buyer.name, buyer_address: buyer.address, buyer_nip: buyer.nip,
    valued,
    lines: rows.map(r => ({
      name: r.name, qty: r.qty, unit: r.unit, batch_no: r.batchNo ?? null,
      price: valued ? r.price : null, value: valued ? r.qty * r.price : null,
    })),
    total_value: valued ? total : undefined,
  }

  const validate = (): string => {
    if (!buyer.name.trim()) return 'Wybierz klienta lub wpisz nazwę odbiorcy'
    if (!rows.length)       return 'Dodaj co najmniej jedną pozycję z magazynu'
    if (rows.some(r => r.qty <= 0)) return 'Ilość każdej pozycji musi być większa od zera'
    if (overdrawn.length)   return `Ilość przekracza stan magazynowy: ${overdrawn.map(r => r.name).join(', ')}`
    return ''
  }

  const submit = async () => {
    const v = validate()
    if (v) { setErr(v); return }
    setErr(''); setSaving(true)
    try {
      const doc = await wzApi.createManual({
        buyer, items: rows, valued,
        place: place || undefined,
        issuedDate: issuedDate || undefined,
        releaseDate: releaseDate || undefined,
        notes: notes || undefined,
      })
      setSavedDoc(doc)
    } catch (e: any) {
      setErr(e?.message || 'Błąd wystawiania WZ')
    } finally { setSaving(false) }
  }

  const resetForm = () => {
    setSavedDoc(null); setRows([]); setErr(''); setNotes('')
    setBuyer({ name: '', address: '', nip: '' })
    setIssuedDate(todayIso()); setReleaseDate(todayIso())
    wzApi.stockFg().then(setFg)
    wzApi.stockRaw().then(setRaw)
  }

  // ── Ekran sukcesu po wystawieniu ──────────────────────────────
  if (savedDoc) {
    return (
      <div className="max-w-2xl mx-auto animate-fade-in">
        <Card>
          <CardContent className="p-8 flex flex-col items-center text-center gap-3">
            <CheckCircle2 size={44} className="text-green-600" />
            <div>
              <div className="text-lg font-bold">Dokument WZ wystawiony</div>
              <div className="font-mono font-bold text-primary text-xl mt-1">{savedDoc.number}</div>
              <div className="text-sm text-muted-foreground mt-1">
                {savedDoc.buyer_name} · {rows.length} poz.
                {savedDoc.valued ? ` · ${(savedDoc.total_value ?? 0).toFixed(2)} zł` : ' · bez cen'}
              </div>
            </div>
            <div className="flex flex-wrap justify-center gap-2 mt-3">
              <Button className="gap-1.5" onClick={() => window.open(`/office/wz/${savedDoc.id}/druk`, '_blank')}>
                <Printer size={14} /> Drukuj
              </Button>
              <Button variant="outline" className="gap-1.5" onClick={() => window.open(wzApi.pdfUrl(savedDoc.id), '_blank')}>
                <FileText size={14} /> PDF
              </Button>
              <Button variant="outline" className="gap-1.5" onClick={() => setPreview(true)}>
                <Eye size={14} /> Podgląd
              </Button>
            </div>
            <div className="flex gap-2 mt-1">
              <Button variant="ghost" size="sm" onClick={resetForm} className="gap-1.5">
                <Plus size={13} /> Wystaw kolejny
              </Button>
              <Button variant="ghost" size="sm" onClick={() => nav('/office/wz')}>
                Lista dokumentów WZ
              </Button>
            </div>
          </CardContent>
        </Card>
        <Dialog open={preview} onOpenChange={setPreview}>
          <DialogContent className="max-w-[880px] max-h-[85vh] overflow-y-auto bg-surface-3 p-6">
            <DialogHeader><DialogTitle>Podgląd dokumentu {savedDoc.number}</DialogTitle></DialogHeader>
            <div className="shadow-lg border border-surface-4 w-fit mx-auto">
              <WzDocumentView doc={savedDoc} />
            </div>
          </DialogContent>
        </Dialog>
      </div>
    )
  }

  // ── Formularz ────────────────────────────────────────────────
  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => nav('/office/wz')}>
          <ArrowLeft size={16} />
        </Button>
        <div>
          <h1 className="text-lg font-bold leading-tight">Nowy dokument WZ</h1>
          <div className="text-[11px] text-muted-foreground">Wydanie zewnętrzne — sprzedaż z magazynu (rozchód ze stanu)</div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_310px] gap-4 items-start">
        {/* ── Lewa kolumna: odbiorca + pozycje ── */}
        <div className="space-y-4 min-w-0">
          <Card>
            <div className="px-4 py-2.5 border-b flex items-center justify-between">
              <span className="text-[13px] font-semibold">Odbiorca</span>
              {buyer.nip && (
                foreign
                  ? <Badge variant="warning" className="text-[10px]">Zagraniczny — wymagany CMR (SP-2c) + HDI</Badge>
                  : <Badge variant="info" className="text-[10px]">Krajowy — wymagany WZ + HDI</Badge>
              )}
            </div>
            <CardContent className="p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1.5 md:col-span-2">
                <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Klient z bazy</Label>
                <Select onValueChange={pickClient}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="Wybierz klienta..." /></SelectTrigger>
                  <SelectContent>
                    {clients.map(c => (
                      <SelectItem key={c.id} value={c.id}>{c.name || c.displayName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Nazwa</Label>
                <Input className="h-9" placeholder="Nazwa odbiorcy" value={buyer.name}
                       onChange={e => setBuyer({ ...buyer, name: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">NIP</Label>
                <Input className="h-9 font-mono" placeholder="np. PL1234567890" value={buyer.nip}
                       onChange={e => setBuyer({ ...buyer, nip: e.target.value })} />
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Adres</Label>
                <Input className="h-9" placeholder="Ulica, kod, miasto" value={buyer.address}
                       onChange={e => setBuyer({ ...buyer, address: e.target.value })} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <div className="px-4 py-2.5 border-b flex items-center gap-3">
              <span className="text-[13px] font-semibold">Pozycje z magazynu</span>
              <div className="flex rounded-md border overflow-hidden ml-auto">
                {([['fg', 'Wyroby gotowe', Package], ['raw', 'Surowce', Beef]] as const).map(([key, label, Icon]) => (
                  <button key={key}
                          className={cn('px-3 h-7 text-[11px] font-semibold inline-flex items-center gap-1.5 transition-colors',
                            tab === key ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground hover:bg-muted')}
                          onClick={() => setTab(key)}>
                    <Icon size={12} /> {label}
                  </button>
                ))}
              </div>
            </div>
            <CardContent className="p-4 space-y-3">
              <div className="relative">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input className="h-9 pl-8" placeholder={tab === 'fg' ? 'Szukaj wyrobu lub partii...' : 'Szukaj partii lub dostawcy...'}
                       value={query} onChange={e => setQuery(e.target.value)} />
              </div>

              <div className="border rounded-md divide-y max-h-56 overflow-y-auto">
                {tab === 'fg' && fgFiltered.map(g => {
                  const added = addedIds.has(g.id)
                  return (
                    <div key={g.id} className="px-3 py-2 flex items-center gap-3 hover:bg-muted/50">
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-medium truncate">{g.recipe_name || g.product_type_name || 'Wyrób'}</div>
                        <div className="text-[11px] text-muted-foreground flex items-center gap-2 mt-0.5">
                          <span className="font-mono text-green-700 bg-green-50 border border-green-200 rounded px-1">{g.batch_no}</span>
                          <span>{g.qty_available} szt dostępne</span>
                        </div>
                      </div>
                      <Button variant="outline" size="sm" className="h-7 text-[11px] gap-1 shrink-0"
                              disabled={added} onClick={() => addFg(g)}>
                        {added ? 'Dodano' : <><Plus size={12} /> Dodaj</>}
                      </Button>
                    </div>
                  )
                })}
                {tab === 'raw' && rawFiltered.map(b => {
                  const added = addedIds.has(b.id)
                  return (
                    <div key={b.id} className="px-3 py-2 flex items-center gap-3 hover:bg-muted/50">
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-medium truncate">{b.supplier_name || 'Surowiec'}</div>
                        <div className="text-[11px] text-muted-foreground flex items-center gap-2 mt-0.5">
                          <span className="font-mono text-green-700 bg-green-50 border border-green-200 rounded px-1">{b.internal_batch_no}</span>
                          <span>{b.kg_available} kg dostępne</span>
                        </div>
                      </div>
                      <Button variant="outline" size="sm" className="h-7 text-[11px] gap-1 shrink-0"
                              disabled={added} onClick={() => addRaw(b)}>
                        {added ? 'Dodano' : <><Plus size={12} /> Dodaj</>}
                      </Button>
                    </div>
                  )
                })}
                {((tab === 'fg' && !fgFiltered.length) || (tab === 'raw' && !rawFiltered.length)) && (
                  <div className="px-3 py-6 text-center text-[12px] text-muted-foreground">
                    {q ? 'Brak wyników wyszukiwania' : 'Brak dostępnego stanu magazynowego'}
                  </div>
                )}
              </div>

              {rows.length > 0 && (
                <Table className="text-[12px]">
                  <TableHeader>
                    <TableRow>
                      {['Towar', 'Partia', 'Ilość', 'j.m.', ...(valued ? ['Cena', 'Wartość'] : []), ''].map((h, i) => (
                        <TableHead key={i} className="text-[9px] uppercase tracking-wider h-7 px-2">{h}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r, i) => {
                      const over = r.qty > r.available
                      return (
                        <TableRow key={i}>
                          <TableCell className="py-1.5 px-2 font-medium">{r.name}</TableCell>
                          <TableCell className="py-1.5 px-2 font-mono text-green-700">{r.batchNo || '—'}</TableCell>
                          <TableCell className="py-1.5 px-2">
                            <div className="flex items-center gap-1.5">
                              <Input type="number" min={0} max={r.available} value={r.qty}
                                     className={cn('h-8 w-20 font-mono', over && 'border-red-400 focus-visible:ring-red-400')}
                                     onChange={e => upd(i, 'qty', Number(e.target.value))} />
                              {over && (
                                <span title={`Dostępne tylko ${r.available} ${r.unit}`}>
                                  <AlertTriangle size={14} className="text-red-600" />
                                </span>
                              )}
                            </div>
                            <div className={cn('text-[10px] mt-0.5', over ? 'text-red-600 font-semibold' : 'text-muted-foreground')}>
                              dostępne {r.available} {r.unit}
                            </div>
                          </TableCell>
                          <TableCell className="py-1.5 px-2 text-muted-foreground">{r.unit}</TableCell>
                          {valued && (
                            <TableCell className="py-1.5 px-2">
                              <Input type="number" min={0} step="0.01" value={r.price}
                                     className="h-8 w-24 font-mono"
                                     onChange={e => upd(i, 'price', Number(e.target.value))} />
                            </TableCell>
                          )}
                          {valued && (
                            <TableCell className="py-1.5 px-2 text-right font-mono font-semibold">
                              {(r.qty * r.price).toFixed(2)}
                            </TableCell>
                          )}
                          <TableCell className="py-1.5 px-2 w-9">
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-red-600"
                                    onClick={() => del(i)}>
                              <Trash2 size={13} />
                            </Button>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>

        {/* ── Prawa kolumna: dokument + akcje ── */}
        <div className="space-y-4 lg:sticky lg:top-4">
          <Card>
            <div className="px-4 py-2.5 border-b">
              <span className="text-[13px] font-semibold">Dokument</span>
            </div>
            <CardContent className="p-4 space-y-3">
              <div className="space-y-1.5">
                <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Rodzaj</Label>
                <div className="grid grid-cols-2 rounded-md border overflow-hidden">
                  {([[true, 'Z cenami'], [false, 'Bez cen']] as const).map(([v, label]) => (
                    <button key={label}
                            className={cn('h-8 text-[11px] font-semibold transition-colors',
                              valued === v ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground hover:bg-muted')}
                            onClick={() => setValued(v)}>
                      {label}
                    </button>
                  ))}
                </div>
                {!valued && (
                  <div className="text-[11px] text-amber-700">
                    WZ wstępny — ceny uzupełnisz później na liście dokumentów.
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Data wystawienia</Label>
                  <Input type="date" className="h-9" value={issuedDate} onChange={e => setIssuedDate(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Data wydania</Label>
                  <Input type="date" className="h-9" value={releaseDate} onChange={e => setReleaseDate(e.target.value)} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Miejsce wystawienia</Label>
                <Input className="h-9" placeholder="Miejscowość" value={place} onChange={e => setPlace(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Uwagi</Label>
                <textarea
                  className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 min-h-[60px] resize-y"
                  placeholder="Opcjonalne uwagi do dokumentu"
                  value={notes} onChange={e => setNotes(e.target.value)} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="flex justify-between text-[12px]">
                <span className="text-muted-foreground">Pozycje</span>
                <span className="font-semibold">{rows.length}</span>
              </div>
              {valued && (
                <div className="flex justify-between items-baseline border-t pt-2">
                  <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Razem</span>
                  <span className="font-mono font-bold text-xl">{total.toFixed(2)} <span className="text-[12px] font-medium text-muted-foreground">zł</span></span>
                </div>
              )}
              {err && (
                <div className="text-[12px] text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
                  {err}
                </div>
              )}
              <div className="space-y-2">
                <Button variant="outline" className="w-full gap-1.5" disabled={!rows.length} onClick={() => setPreview(true)}>
                  <Eye size={14} /> Podgląd dokumentu
                </Button>
                <Button className="w-full gap-1.5" disabled={saving} onClick={submit}>
                  <FileCheck2 size={14} />
                  {saving ? 'Wystawianie…' : 'Wystaw i zapisz WZ'}
                </Button>
                <div className="text-[10px] text-muted-foreground text-center">
                  Wystawienie zdejmuje pozycje ze stanu magazynowego.
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={preview} onOpenChange={setPreview}>
        <DialogContent className="max-w-[880px] max-h-[85vh] overflow-y-auto bg-surface-3 p-6">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              Podgląd dokumentu
              <Badge variant="secondary" className="text-[10px]">szkic — numer zostanie nadany przy wystawieniu</Badge>
            </DialogTitle>
          </DialogHeader>
          <div className="shadow-lg border border-surface-4 w-fit mx-auto">
            <WzDocumentView doc={draftDoc} draft />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
