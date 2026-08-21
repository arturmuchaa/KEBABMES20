import { useOtworzDokument } from '@/lib/otworzDokument'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { wzApi, clientsApi, settingsApi, downloadDocPdf, containersApi, payrollApi, WzDoc } from '@/lib/api'
import { todayIso, cn } from '@/lib/utils'
import { OTHER_CARRIER_KINDS } from '@/lib/containers'
import { WzDocumentView, WzDocData } from '@/components/wz/WzDocumentView'
import { WzLinesGrid } from '@/features/wz/components/WzLinesGrid'
import { StockPickerDialog, fgLabel } from '@/features/wz/components/StockPickerDialog'
import {
  fmtKg3, fmtKgPl, fmtMoneyPl, rowKg, rowPrice, rowQty, rowValue,
  sanitizeDecimal, sanitizeInt, toNum, type WzRow as Row,
} from '@/features/wz/rowMath'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { SearchSelect } from '@/components/ui/search-select'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  ArrowLeft, Plus, Trash2, Search, Eye, Printer, FileText,
  FileCheck2, CheckCircle2, Package, Beef, AlertTriangle, RefreshCw,
} from 'lucide-react'

const isForeignNip = (nip: string) => {
  const s = (nip || '').trim().toUpperCase()
  return s.length >= 2 && /^[A-Z]{2}/.test(s) && s.slice(0, 2) !== 'PL'
}

export function WzNewPage() {
  const otworz = useOtworzDokument()
  const nav = useNavigate()
  const [clients, setClients] = useState<any[]>([])
  const [fg, setFg]   = useState<any[]>([])
  const [raw, setRaw] = useState<any[]>([])
  const [seller, setSeller] = useState<{ name?: string; address?: string; nip?: string }>({})

  const [clientId, setClientId] = useState('')
  const [stockView, setStockView] = useState<'client' | 'all'>('all')
  const [buyer, setBuyer] = useState({ name: '', address: '', nip: '' })
  const [rows, setRows]   = useState<Row[]>([])
  const [tab, setTab]     = useState<'fg' | 'raw'>('fg')
  const [query, setQuery] = useState('')

  const [valued, setValued]           = useState(true)
  const [currency, setCurrency]       = useState<'PLN' | 'EUR'>('PLN')
  const [eurRateStr, setEurRateStr]   = useState('')
  const [eurRateDate, setEurRateDate] = useState('')
  const [rateLoading, setRateLoading] = useState(false)
  const [issuedDate, setIssuedDate]   = useState(todayIso())
  const [releaseDate, setReleaseDate] = useState(todayIso())
  const [place, setPlace]             = useState('')
  const [notes, setNotes]             = useState('')
  // Palety są na POZIOMIE DOKUMENTU — transport wiezie N palet łącznie,
  // nie N palet na każdą partię (pojemniki zostają na pozycjach).
  // Pojemniki na dokumencie: podpowiedź = suma z ważeń (pozycje WZ), ale
  // operator może ją poprawić — i ta liczba rządzi SALDEM, nie tylko drukiem.
  // Pusto = weź sumę z pozycji. Wpisane 0 to świadome zero (prod 2026-07-30:
  // operator wpisał 0, a saldo i tak zeszło o 1741, bo liczyła się suma).
  const [contOverride, setContOverride] = useState<string>('')
  const [palletsH1, setPalletsH1]         = useState(0)
  const [palletsOther, setPalletsOther]   = useState(0)
  const [palletsOtherKind, setPalletsOtherKind] = useState<string>('net_e1')

  // Odbiorca zajmował pół ekranu przez cały czas wystawiania, a wypełnia się
  // raz — po wybraniu klienta zwija się do jednej linii, żeby lista magazynu
  // (w niej się pracuje) dostała tę wysokość.
  const [buyerEdit, setBuyerEdit] = useState(false)
  // Numer widoczny od razu w nagłówku — jak w programach do fakturowania.
  // Po anulowaniu numery wracają do puli, więc podpowiedź czyta tę samą
  // kolejkę co zapis (backend: next_wz_number).
  const [nextNo, setNextNo] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [preview, setPreview] = useState(false)
  const [saving, setSaving]   = useState(false)
  // Druk na pojemniki wystawiany po WZ — kolumna „Zwrot" wychodzi PUSTA,
  // odbiorca wpisuje ją długopisem, biuro uzupełnia po powrocie kierowcy.
  const [contDoc, setContDoc] = useState<any>(null)
  const [contBusy, setContBusy] = useState(false)
  const [contErr, setContErr] = useState('')
  // Pracownicy kupują ćwiartkę/mięso na własny użytek; WZ zdejmuje to ze
  // stanów, a potrącenie ma trafić prosto do ich rozliczenia. Dopasowanie
  // robi backend: tylko pusty NIP i DOKŁADNA nazwa aktywnego pracownika.
  const [empMatch, setEmpMatch]   = useState<{ workerId: string; name: string } | null>(null)
  const [empDeduct, setEmpDeduct] = useState(true)
  const [empAmount, setEmpAmount] = useState('')
  const [err, setErr]         = useState('')
  const [savedDoc, setSavedDoc] = useState<WzDoc | null>(null)

  useEffect(() => {
    clientsApi.list().then(setClients)
    wzApi.stockFg().then(setFg)
    wzApi.stockRaw().then(list => {
      setRaw(list)
      // Pozycje zaznaczone checkboxami w Magazynie surowca („Wystaw WZ
      // z zaznaczonych") przyjeżdżają w ?stock=id1,id2 — dokument otwiera się
      // od razu z nimi, bez przeklikiwania pickera.
      const ids = new URLSearchParams(window.location.search).get('stock')
      if (!ids) return
      const want = new Set(ids.split(',').filter(Boolean))
      const picked = (list as any[]).filter(b => want.has(b.id))
      if (picked.length) {
        addRawMany(picked)   // dedupe w środku — efekt może odpalić dwa razy
        setTab('raw')
      }
    })
    wzApi.nextNumber().then(n => setNextNo(n.number)).catch(() => setNextNo(''))
    settingsApi.getCompany().then(c => {
      setSeller({
        name: c.name,
        address: [c.address, [c.postalCode, c.city].filter(Boolean).join(' ')].filter(Boolean).join(', '),
        nip: c.nip,
      })
      setPlace(p => p || c.city || '')
    }).catch(() => {})
  }, [])

  const eurRate = toNum(eurRateStr)
  const fetchNbpRate = () => {
    setRateLoading(true)
    fetch('https://api.nbp.pl/api/exchangerates/rates/a/eur/?format=json')
      .then(r => r.json())
      .then(d => {
        const rate = d?.rates?.[0]
        if (rate?.mid) { setEurRateStr(String(rate.mid)); setEurRateDate(rate.effectiveDate || '') }
      })
      .catch(() => { /* brak internetu/NBP — kurs można wpisać ręcznie */ })
      .finally(() => setRateLoading(false))
  }
  useEffect(() => { if (currency === 'EUR' && !eurRateStr) fetchNbpRate() }, [currency])  // eslint-disable-line react-hooks/exhaustive-deps

  // Formularz odbiorcy widoczny, dopóki nie ma nazwy (nowy dokument) albo gdy
  // użytkownik świadomie go rozwinął.
  const buyerFormOpen = buyerEdit || !buyer.name.trim()
  const selectedClient = useMemo(() => clients.find(c => c.id === clientId), [clients, clientId])
  const clientName = (selectedClient?.name || selectedClient?.displayName || '').trim()

  const foreign = useMemo(() => isForeignNip(buyer.nip), [buyer.nip])
  const totalValue = rows.reduce((s, r) => s + rowValue(r), 0)
  const totalKg = rows.reduce((s, r) => s + rowKg(r), 0)
  const overdrawn = rows.filter(r => rowQty(r) > r.available)

  // Wykrycie pracownika po nazwie odbiorcy — tylko przy pustym NIP.
  useEffect(() => {
    const name = buyer.name.trim()
    if (!name || buyer.nip.trim()) { setEmpMatch(null); return }
    const t = setTimeout(() => {
      payrollApi.matchWorker(name, buyer.nip)
        .then(m => setEmpMatch(m ?? null))
        .catch(() => setEmpMatch(null))
    }, 400)
    return () => clearTimeout(t)
  }, [buyer.name, buyer.nip])

  // Kwota potrącenia = wartość dokumentu; przy EUR przeliczona kursem NBP,
  // bo pracownikowi potrąca się złotówki.
  const deductionDefault = useMemo(() => {
    if (!valued) return 0
    const v = currency === 'EUR' && eurRate > 0 ? totalValue * eurRate : totalValue
    return Math.round(v * 100) / 100
  }, [valued, currency, eurRate, totalValue])

  useEffect(() => {
    setEmpAmount(deductionDefault ? deductionDefault.toFixed(2) : '')
  }, [deductionDefault])
  const sym = currency === 'EUR' ? '€' : 'zł'

  const pickClient = (id: string) => {
    setClientId(id)
    setStockView('client')
    const c = clients.find(x => x.id === id)
    if (c) {
      setBuyer({
        name: c.name || c.displayName || '',
        address: `${c.address || ''} ${c.city || ''}`.trim(),
        nip: c.nip || '',
      })
      setBuyerEdit(false)   // dane kompletne → zwiń, miejsce idzie na magazyn
    }
  }

  const addedIds = useMemo(() => new Set(rows.map(r => r.stockId)), [rows])
  const addFg = (g: any) => setRows(r => [...r, {
    stockType: 'fg', stockId: g.id, name: fgLabel(g),
    unit: 'szt', qtyStr: '1', priceStr: '', batchNo: g.batch_no,
    available: Number(g.qty_available || 0),
    kgPerUnit: Number(g.kg_per_unit || 0) || undefined,
  }])
  // Domyślnie CAŁA partia (typowy przypadek); częściowe wydanie = edycja kg
  // w tabeli (np. „600 z 406, reszta nie weszła na samochód").
  const mkRawRow = (b: any): Row => ({
    stockType: b.stock_type || 'raw', stockId: b.id,
    // Pełna nazwa na dokument (doc_name); krótka zostaje w HMI/MES.
    name: b.doc_name || b.name || `Surowiec ${b.internal_batch_no}`,
    // Przecinek, nie kropka: pole ma wyglądać jak reszta liczb w biurze.
    unit: 'kg', qtyStr: fmtKgPl(Number(b.kg_available || 0)), priceStr: '',
    // Pojemniki ZAPAMIĘTANE z ważenia na HMI — podpowiedź, można poprawić.
    containersStr: b.containers ? String(b.containers) : '',
    batchNo: b.internal_batch_no,
    slaughterDate: b.slaughter_date ?? null,
    expiryDate: b.expiry_date ?? null,
    productionDate: b.production_date ?? null,
    available: Number(b.kg_available || 0),
  })
  const addRaw = (b: any) => setRows(r => [...r, mkRawRow(b)])
  /** „Dodaj wszystkie" z grupy (kości/grzbiety/ćwiartka…) — typowe wydanie
   *  ubocznych bierze CAŁY stan frakcji, klikanie partia po partii to strata
   *  czasu. Filtr „już dodane" liczony WEWNĄTRZ aktualizacji stanu, więc ani
   *  podwójny klik, ani dwukrotne wywołanie efektu (StrictMode) nie zdublują
   *  pozycji na dokumencie. */
  const addRawMany = (items: any[]) => setRows(r => {
    const have = new Set(r.map(x => x.stockId))
    const fresh = items.filter(b => !have.has(b.id))
    return fresh.length ? [...r, ...fresh.map(mkRawRow)] : r
  })
  const upd = (i: number, k: 'qtyStr' | 'priceStr' | 'containersStr', v: string) =>
    setRows(r => r.map((x, j) => j === i ? { ...x, [k]: v } : x))
  /** Jedna cena wpisana u góry trafia do WSZYSTKICH pozycji (kości idą po
   *  tej samej stawce). Każdy wiersz da się potem poprawić osobno. */
  const applyPriceToAll = (v: string) =>
    setRows(rs => rs.map(r => ({ ...r, priceStr: v })))
  const del = (i: number) => setRows(r => r.filter((_, j) => j !== i))

  const q = query.trim().toLowerCase()
  // Magazyn stempluje klienta raz pełną nazwą, raz skróconą ("SAS ISSA
  // DISTRIB" vs "ISSA DISTRIB") — filtr łapie OBIE, inaczej "Brak wyrobów
  // przypisanych do klienta" mimo towaru na stanie (prod 2026-07-17).
  const clientAliases = useMemo(() => new Set(
    [selectedClient?.name, selectedClient?.displayName]
      .filter(Boolean).map(s => String(s).trim().toLowerCase())
  ), [selectedClient])
  const matchesClient = (g: any) =>
    stockView === 'all' || clientAliases.size === 0 ||
    clientAliases.has((g.client_name || '').trim().toLowerCase())
  const fgFiltered = fg.filter(g =>
    matchesClient(g) &&
    (!q || `${g.recipe_name || ''} ${g.product_type_name || ''} ${g.batch_no || ''}`.toLowerCase().includes(q)))
  const fgClientCount = clientAliases.size
    ? fg.filter(g => clientAliases.has((g.client_name || '').trim().toLowerCase())).length
    : 0
  const rawFiltered = raw.filter(b =>
    !q || `${b.internal_batch_no || ''} ${b.supplier_name || ''} ${b.name || ''}`.toLowerCase().includes(q))

  // Palety wpisuje operator — jako jedyny widzi samochód. Liczba palet
  // WAŻENIA ubocznych (kreator HMI) to co innego niż palety w transporcie,
  // więc świadomie nic tu nie podpowiadamy.
  const totalContainers = useMemo(
    () => rows.reduce((s, r) => s + (parseInt(r.containersStr || '') || 0), 0), [rows])
  // '' → null (auto z pozycji). '0' → 0, a NIE fallback na sumę.
  const containersTotal = contOverride.trim() === '' ? null : (parseInt(contOverride) || 0)
  const effectiveContainers = containersTotal ?? totalContainers

  const draftDoc: WzDocData = {
    number: savedDoc?.number,
    place, issued_date: issuedDate, release_date: releaseDate,
    seller,
    buyer_name: buyer.name, buyer_address: buyer.address, buyer_nip: buyer.nip,
    valued,
    currency,
    eur_rate: currency === 'EUR' && eurRate > 0 ? eurRate : null,
    lines: rows.map(r => ({
      name: r.name, qty: rowQty(r), unit: r.unit, batch_no: r.batchNo ?? null,
      containers: parseInt(r.containersStr || '') || null,
      stock_type: r.stockType,
      slaughter_date: r.slaughterDate ?? null,
      expiry_date: r.expiryDate ?? null,
      production_date: r.productionDate ?? null,
      kg_per_unit: r.kgPerUnit ?? null,
      total_kg: r.kgPerUnit ? Math.round(rowQty(r) * r.kgPerUnit * 1000) / 1000 : null,
      price: valued ? rowPrice(r) : null, value: valued ? Math.round(rowValue(r) * 100) / 100 : null,
    })),
    total_value: valued ? Math.round(totalValue * 100) / 100 : undefined,
  }

  const validate = (): string => {
    if (!buyer.name.trim()) return 'Wybierz klienta lub wpisz nazwę odbiorcy'
    if (!rows.length)       return 'Dodaj co najmniej jedną pozycję z magazynu'
    if (rows.some(r => rowQty(r) <= 0)) return 'Ilość każdej pozycji musi być większa od zera'
    if (overdrawn.length)   return `Ilość przekracza stan magazynowy: ${overdrawn.map(r => r.name).join(', ')}`
    if (valued && currency === 'EUR' && !(eurRate > 0))
      return 'Brak kursu EUR — pobierz z NBP lub wpisz ręcznie'
    return ''
  }

  const submit = async () => {
    const v = validate()
    if (v) { setErr(v); return }
    setErr(''); setSaving(true)
    try {
      const doc = await wzApi.createManual({
        buyer,
        items: rows.map(r => ({
          stockType: r.stockType, stockId: r.stockId, name: r.name, unit: r.unit,
          qty: rowQty(r), price: rowPrice(r), batchNo: r.batchNo, kgPerUnit: r.kgPerUnit,
          containers: parseInt(r.containersStr || '') || undefined,
          productionDate: r.productionDate ?? undefined,
        })),
        valued,
        currency,
        eurRate: currency === 'EUR' && eurRate > 0 ? eurRate : null,
        payrollDeduction: empMatch && empDeduct && (parseFloat(empAmount) || 0) > 0
          ? { workerId: empMatch.workerId, amount: parseFloat(empAmount) }
          : null,
        place: place || undefined,
        issuedDate: issuedDate || undefined,
        releaseDate: releaseDate || undefined,
        notes: notes || undefined,
        palletsH1,
        palletsOther,
        palletsOtherKind,
        containersTotal,
      })
      setSavedDoc(doc)
    } catch (e: any) {
      setErr(e?.message || 'Błąd wystawiania WZ')
    } finally { setSaving(false) }
  }

  const resetForm = () => {
    setSavedDoc(null); setRows([]); setErr(''); setNotes('')
    setBuyer({ name: '', address: '', nip: '' })
    setClientId(''); setStockView('all')
    setIssuedDate(todayIso()); setReleaseDate(todayIso())
    wzApi.stockFg().then(setFg)
    wzApi.stockRaw().then(setRaw)
    wzApi.nextNumber().then(n => setNextNo(n.number)).catch(() => {})
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
                {savedDoc.valued
                  ? ` · ${(savedDoc.total_value ?? 0).toFixed(2)} ${(savedDoc.currency || 'PLN') === 'EUR' ? '€' : 'zł'}`
                  : ' · bez cen'}
              </div>
            </div>
            <div className="flex flex-wrap justify-center gap-2 mt-3">
              <Button className="gap-1.5" onClick={() => otworz(`/office/wz/${savedDoc.id}/druk`)}>
                <Printer size={14} /> Drukuj
              </Button>
              <Button variant="outline" className="gap-1.5" onClick={() => void downloadDocPdf(wzApi.pdfUrl(savedDoc.id)).catch(e => alert(e?.message || 'Nie udało się pobrać PDF'))}>
                <FileText size={14} /> PDF
              </Button>
              <Button variant="outline" className="gap-1.5" onClick={() => setPreview(true)}>
                <Eye size={14} /> Podgląd
              </Button>
            </div>
            {/* Druk na pojemniki — osobny papier, który kierowca wozi
                do odbiorcy po wpisanie faktycznego zwrotu. */}
            <div className="w-full mt-4 rounded border border-surface-4 bg-surface-2 p-3 text-left">
              {contDoc ? (
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[12.5px]">
                    Druk na pojemniki <b className="font-mono">{contDoc.number}</b> wystawiony —
                    kolumna „Zwrot" jest pusta, wypełnia ją odbiorca.
                  </div>
                  <Button size="sm" className="gap-1.5"
                    onClick={() => otworz(`/office/pojemniki/${contDoc.id}/druk`)}>
                    <Printer size={13} /> Drukuj
                  </Button>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <div className="text-[12.5px] text-ink-2">
                    Wystawić <b>druk na pojemniki</b> do tego WZ?
                    <span className="block text-[11px] text-ink-4">
                      {effectiveContainers} poj. · {palletsH1} pal. H1 · {palletsOther} pal. inne —
                      zwrot wpiszesz po powrocie kierowcy.
                    </span>
                  </div>
                  <Button size="sm" variant="outline" className="gap-1.5" disabled={contBusy}
                    onClick={async () => {
                      setContBusy(true); setContErr('')
                      try {
                        setContDoc(await containersApi.docFromWz({
                          wzId: savedDoc.id, palletsH1, palletsOther,
                          containers: effectiveContainers,
                        }))
                      } catch (e: any) {
                        setContErr(e?.message || 'Nie udało się wystawić druku')
                      } finally { setContBusy(false) }
                    }}>
                    <Package size={13} /> {contBusy ? 'Wystawianie…' : 'Wystaw druk'}
                  </Button>
                </div>
              )}
              {contErr && <div className="mt-2 text-[12px] text-red-600">{contErr}</div>}
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
  // Układ jak w programach do fakturowania: nagłówek dokumentu ściśnięty
  // w jeden pas u góry, a całą resztę ekranu zajmuje SIATKA POZYCJI. Magazyn
  // przeniósł się do okna pod klawiszem Insert — wcześniej ekran trzymał dwie
  // listy naraz (magazyn i pozycje) i przy kilku partiach ubocznych nie dało
  // się ogarnąć wzrokiem, co właściwie jedzie na dokument.
  return (
    <div className="space-y-3 animate-fade-in pb-20">
      <div className="flex items-center gap-3 flex-wrap">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => nav('/office/wz')}>
          <ArrowLeft size={16} />
        </Button>
        <div className="min-w-0">
          <h1 className="text-lg font-bold leading-tight">Nowy dokument WZ</h1>
          <div className="text-[11px] text-ink-4">Wydanie zewnętrzne — sprzedaż z magazynu (rozchód ze stanu)</div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-wider text-ink-4">Numer</span>
          <code className="font-mono font-bold text-primary text-[15px]" aria-label="Numer dokumentu">
            {nextNo || '—'}
          </code>
        </div>
      </div>

      {/* ── Nagłówek dokumentu: wszystko, co nie jest pozycją ── */}
      <Card>
        <CardContent className="p-3 grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
          {/* Odbiorca */}
          <div className="space-y-1.5 min-w-0">
            <Label className="text-[10px] uppercase tracking-wider text-ink-4">Odbiorca</Label>
            {!buyerFormOpen ? (
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-semibold text-ink truncate">{buyer.name}</div>
                  <div className="text-[11px] text-ink-4 truncate">
                    {[buyer.address, buyer.nip && `NIP ${buyer.nip}`].filter(Boolean).join(' · ') || '—'}
                  </div>
                </div>
                <Button variant="outline" size="sm" className="h-7 text-[11px] shrink-0"
                        onClick={() => setBuyerEdit(true)}>Zmień</Button>
              </div>
            ) : (
              <div className="space-y-2">
                <SearchSelect
                  items={clients.map(c => ({
                    id: c.id, label: c.name || c.displayName || '', sublabel: c.city || undefined,
                    searchText: `${c.nip ?? ''} ${c.displayName ?? ''}`,
                  }))}
                  value={clientId}
                  onSelect={pickClient}
                  placeholder="Wpisz nazwę odbiorcy…"
                />
                <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-2">
                  <Input className="h-8 text-[12px]" placeholder="Nazwa odbiorcy" value={buyer.name}
                         onChange={e => setBuyer(b => ({ ...b, name: e.target.value }))} />
                  <Input className="h-8 text-[12px] font-mono" placeholder="NIP" value={buyer.nip}
                         onChange={e => setBuyer(b => ({ ...b, nip: e.target.value }))} />
                </div>
                <Input className="h-8 text-[12px]" placeholder="Ulica, kod, miasto" value={buyer.address}
                       onChange={e => setBuyer(b => ({ ...b, address: e.target.value }))} />
                {foreign && (
                  <div className="text-[11px] text-ink-3">
                    NIP zagraniczny — dokument bez VAT (wewnątrzwspólnotowa dostawa).
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Daty i miejsce */}
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase tracking-wider text-ink-4">Daty</Label>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <div className="text-[10px] text-ink-4 mb-0.5">wystawienia</div>
                <Input type="date" className="h-8 text-[12px]" value={issuedDate}
                       onChange={e => setIssuedDate(e.target.value)} />
              </div>
              <div>
                <div className="text-[10px] text-ink-4 mb-0.5">wydania</div>
                <Input type="date" className="h-8 text-[12px]" value={releaseDate}
                       onChange={e => setReleaseDate(e.target.value)} />
              </div>
            </div>
            <Input className="h-8 text-[12px]" placeholder="Miejsce wystawienia" value={place}
                   onChange={e => setPlace(e.target.value)} />
          </div>

          {/* Rodzaj i waluta */}
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase tracking-wider text-ink-4">Rodzaj dokumentu</Label>
            <div className="grid grid-cols-2 rounded-md border border-surface-4 overflow-hidden">
              {([[true, 'Z cenami'], [false, 'Bez cen']] as const).map(([v, label]) => (
                <button key={label}
                        className={cn('h-8 text-[11px] font-semibold transition-colors',
                          valued === v ? 'bg-primary text-primary-foreground' : 'bg-background text-ink-3 hover:bg-surface-2')}
                        onClick={() => setValued(v)}>
                  {label}
                </button>
              ))}
            </div>
            {valued ? (
              <>
                <div className="grid grid-cols-2 rounded-md border border-surface-4 overflow-hidden">
                  {(['PLN', 'EUR'] as const).map(c => (
                    <button key={c}
                            className={cn('h-8 text-[11px] font-semibold transition-colors',
                              currency === c ? 'bg-primary text-primary-foreground' : 'bg-background text-ink-3 hover:bg-surface-2')}
                            onClick={() => setCurrency(c)}>
                      {c}
                    </button>
                  ))}
                </div>
                {currency === 'EUR' && (
                  <>
                    <div className="flex items-center gap-1.5">
                      <Input type="text" inputMode="decimal" value={eurRateStr} placeholder="kurs EUR"
                             className="h-8 font-mono text-[12px]"
                             onFocus={e => e.target.select()}
                             onChange={e => { setEurRateStr(sanitizeDecimal(e.target.value)); setEurRateDate('') }} />
                      <Button variant="outline" size="icon" className="h-8 w-8 shrink-0" title="Pobierz kurs z NBP"
                              disabled={rateLoading} onClick={fetchNbpRate}>
                        <RefreshCw size={13} className={rateLoading ? 'animate-spin' : ''} />
                      </Button>
                    </div>
                    <div className="text-[10px] text-ink-4">
                      {eurRateStr && eurRateDate
                        ? <>Kurs średni NBP (tab. A) z {eurRateDate}</>
                        : eurRateStr ? 'Kurs wpisany ręcznie'
                        : rateLoading ? 'Pobieranie kursu z NBP…' : 'Pobierz kurs z NBP lub wpisz ręcznie'}
                    </div>
                  </>
                )}
              </>
            ) : (
              <div className="text-[11px] text-amber-700">
                WZ wstępny — ceny uzupełnisz później na liście dokumentów.
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ── Pozycje: główne pole pracy ── */}
      <WzLinesGrid
        rows={rows}
        valued={valued}
        sym={sym}
        onChange={upd}
        onDelete={del}
        onAdd={() => setPickerOpen(true)}
      />

      {/* ── Transport, nośniki i uwagi — pod siatką, jeden pas ── */}
      <Card>
        <CardContent className="p-3 grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          {valued && (
            <div className="space-y-1">
              <Label className="text-[10px] uppercase tracking-wider text-ink-4">Cena dla wszystkich pozycji</Label>
              <Input type="text" inputMode="decimal" placeholder="np. 1,20"
                     title="Jedna cena trafia do wszystkich pozycji; każdą można potem poprawić w siatce"
                     className="h-8 font-mono text-[12px]"
                     onFocus={e => e.target.select()}
                     onChange={e => applyPriceToAll(sanitizeDecimal(e.target.value))} />
            </div>
          )}
          <div className="space-y-1">
            <Label className="text-[10px] uppercase tracking-wider text-ink-4">
              Pojemniki na saldo i druk
            </Label>
            <Input type="text" inputMode="numeric" className="h-8 font-mono text-[12px]"
                   placeholder={String(totalContainers)}
                   value={contOverride}
                   onFocus={e => e.target.select()}
                   onChange={e => setContOverride(sanitizeInt(e.target.value))} />
            <div className="text-[10px] text-ink-4">
              z ważeń: {totalContainers}; wpisz 0, żeby nie ruszać salda
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] uppercase tracking-wider text-ink-4">Palety H1</Label>
            <Input type="text" inputMode="numeric" className="h-8 font-mono text-[12px]"
                   value={String(palletsH1)}
                   onFocus={e => e.target.select()}
                   onChange={e => setPalletsH1(parseInt(sanitizeInt(e.target.value) || '0') || 0)} />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] uppercase tracking-wider text-ink-4">Inne opakowania</Label>
            <div className="flex gap-1">
              {/* Rodzaj ma własne saldo — siatek E1 nie zwraca się europaletą. */}
              <select value={palletsOtherKind}
                      onChange={e => setPalletsOtherKind(e.target.value)}
                      className="h-8 flex-1 rounded border border-surface-4 bg-surface px-1 text-[11px]">
                {OTHER_CARRIER_KINDS.map(k => (
                  <option key={k.value} value={k.value}>{k.label}</option>
                ))}
              </select>
              <Input type="text" inputMode="numeric" className="h-8 w-14 font-mono text-[12px]"
                     value={String(palletsOther)}
                     onFocus={e => e.target.select()}
                     onChange={e => setPalletsOther(parseInt(sanitizeInt(e.target.value) || '0') || 0)} />
            </div>
          </div>
          <div className="space-y-1 md:col-span-2 lg:col-span-4">
            <Label className="text-[10px] uppercase tracking-wider text-ink-4">Uwagi</Label>
            <textarea
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-[12px] ring-offset-background placeholder:text-ink-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[48px] resize-y"
              placeholder="Opcjonalne uwagi do dokumentu"
              value={notes} onChange={e => setNotes(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      {/* Odbiorca rozpoznany jako pracownik: WZ zdejmuje towar ze stanu,
          a potrącenie idzie prosto do jego rozliczenia. */}
      {empMatch && (
        <div className={cn('rounded-md border px-3 py-2.5 text-[12px]',
          deductionDefault > 0 ? 'border-primary/40 bg-primary/5' : 'border-amber-300 bg-amber-50 text-amber-900')}>
          {deductionDefault > 0 ? (
            <div className="flex items-center gap-2 flex-wrap">
              <input type="checkbox" className="w-4 h-4 rounded cursor-pointer"
                     checked={empDeduct} onChange={e => setEmpDeduct(e.target.checked)} />
              <span className="flex-1 min-w-[220px]">
                Odbiorca to pracownik <strong>{empMatch.name}</strong> — dopisz potrącenie
              </span>
              <Input className="w-24 h-8 text-right" type="number" step="0.01" min="0"
                     value={empAmount} onChange={e => setEmpAmount(e.target.value)} disabled={!empDeduct} />
              <span className="text-ink-4">zł</span>
            </div>
          ) : (
            <>Odbiorca to pracownik <strong>{empMatch.name}</strong>, ale WZ jest bez wyceny —
            uzupełnij ceny, żeby powstało potrącenie.</>
          )}
        </div>
      )}

      {err && (
        <div className="text-[12px] text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
          {err}
        </div>
      )}

      {/* Pasek akcji przyklejony do dołu — przy długiej siatce „Wystaw"
          nie może uciekać pod ekran. */}
      <div className="sticky bottom-0 -mx-1 px-1 py-2 bg-surface-1/95 backdrop-blur border-t border-surface-4
                      flex items-center gap-3 flex-wrap">
        <div className="text-[12px] text-ink-3">
          {rows.length} poz. · <span className="font-mono font-semibold text-ink">{fmtKgPl(totalKg)} kg</span>
          {valued && (
            <>
              {' · '}RAZEM{' '}
              <span className="font-mono font-bold text-ink text-[15px]">{fmtMoneyPl(totalValue)}</span> {sym}
              {currency === 'EUR' && eurRate > 0 && totalValue > 0 && (
                <span className="text-ink-4"> ≈ {fmtMoneyPl(totalValue * eurRate)} zł</span>
              )}
            </>
          )}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" className="gap-1.5" disabled={!rows.length} onClick={() => setPreview(true)}>
            <Eye size={14} /> Podgląd
          </Button>
          <Button className="gap-1.5" disabled={saving} onClick={submit}>
            <FileCheck2 size={14} />
            {saving ? 'Wystawianie…' : 'Wystaw i zapisz WZ'}
          </Button>
        </div>
      </div>

      <StockPickerDialog
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        fg={fg}
        raw={raw}
        addedIds={addedIds}
        clientName={clientName}
        clientAliases={clientAliases}
        onAddFg={addFg}
        onAddRaw={addRaw}
        onAddRawMany={addRawMany}
      />

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
