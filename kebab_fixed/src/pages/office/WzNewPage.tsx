import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { wzApi, clientsApi, settingsApi, downloadDocPdf, containersApi, payrollApi, WzDoc } from '@/lib/api'
import { todayIso, cn } from '@/lib/utils'
import { OTHER_CARRIER_KINDS } from '@/lib/containers'
import { WzDocumentView, WzDocData } from '@/components/wz/WzDocumentView'
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

type Row = {
  stockType: 'fg' | 'raw' | 'meat' | 'byproduct'; stockId: string; name: string; unit: string
  containersStr?: string
  slaughterDate?: string | null
  expiryDate?: string | null
  productionDate?: string | null
  qtyStr: string; priceStr: string; batchNo?: string; available: number
  kgPerUnit?: number   // FG: waga 1 szt — wycena za kg
}

const isForeignNip = (nip: string) => {
  const s = (nip || '').trim().toUpperCase()
  return s.length >= 2 && /^[A-Z]{2}/.test(s) && s.slice(0, 2) !== 'PL'
}

/** "3,25" / "3.25" / "10" → liczba; śmieci → 0. */
const toNum = (s: string) => {
  const n = parseFloat((s || '').trim().replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}
/** Zostaw tylko cyfry i jeden separator dziesiętny (przecinek lub kropka). */
const sanitizeDecimal = (s: string) => {
  const cleaned = s.replace(/[^\d.,]/g, '')
  const firstSep = cleaned.search(/[.,]/)
  if (firstSep === -1) return cleaned
  return cleaned.slice(0, firstSep + 1) + cleaned.slice(firstSep + 1).replace(/[.,]/g, '')
}
const sanitizeInt = (s: string) => s.replace(/\D/g, '')

const fmtKg3 = (n: number) => Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/\.?0+$/, '')

const rowQty   = (r: Row) => toNum(r.qtyStr)
const rowPrice = (r: Row) => toNum(r.priceStr)
/** Waga pozycji w kg: FG = szt × kg/szt, surowiec = qty (jednostka kg). */
const rowKg = (r: Row) => r.kgPerUnit ? rowQty(r) * r.kgPerUnit : (r.unit === 'kg' ? rowQty(r) : 0)
/** Wartość pozycji: cena ZA KG gdy znamy wagę, inaczej za jednostkę. */
const rowValue = (r: Row) => (rowKg(r) > 0 ? rowKg(r) : rowQty(r)) * rowPrice(r)

export function WzNewPage() {
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

  const fgName = (g: any) => {
    const base = g.recipe_name || g.product_type_name || 'Wyrób'
    const kg = Number(g.kg_per_unit || 0)
    return kg > 0 ? `${base} ${fmtKg3(kg)}kg` : base
  }

  const addedIds = useMemo(() => new Set(rows.map(r => r.stockId)), [rows])
  const addFg = (g: any) => setRows(r => [...r, {
    stockType: 'fg', stockId: g.id, name: fgName(g),
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
    unit: 'kg', qtyStr: String(Number(b.kg_available || 0)), priceStr: '',
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
              <Button className="gap-1.5" onClick={() => window.open(`/office/wz/${savedDoc.id}/druk`, '_blank')}>
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
                    onClick={() => window.open(`/office/pojemniki/${contDoc.id}/druk`, '_blank')}>
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
            <div className="px-4 py-2.5 border-b flex items-center gap-3 flex-wrap">
              <span className="text-[13px] font-semibold">Odbiorca</span>
              {buyer.nip && (
                foreign
                  ? <Badge variant="warning" className="text-[10px]">Zagraniczny — wymagany CMR (SP-2c) + HDI</Badge>
                  : <Badge variant="info" className="text-[10px]">Krajowy — wymagany WZ + HDI</Badge>
              )}
              {!buyerFormOpen && (
                <Button variant="ghost" size="sm" className="h-7 text-[11px] ml-auto"
                        onClick={() => setBuyerEdit(true)}>
                  Zmień odbiorcę
                </Button>
              )}
            </div>
            {!buyerFormOpen ? (
              // Zwinięty odbiorca: wszystko, co idzie na dokument, w jednej linii.
              <CardContent className="px-4 py-2.5 flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <span className="text-[13px] font-semibold text-ink">{buyer.name}</span>
                {buyer.nip && <span className="text-[12px] font-mono text-ink-3">{buyer.nip}</span>}
                {buyer.address && <span className="text-[12px] text-ink-3">{buyer.address}</span>}
              </CardContent>
            ) : (
            <CardContent className="p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1.5 md:col-span-2">
                <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  Klient z bazy <span className="font-normal normal-case text-ink-4">(wpisz, aby wyszukać)</span>
                </Label>
                <SearchSelect
                  items={clients.map(c => ({
                    id: c.id, label: c.name || c.displayName || '', sublabel: c.city || undefined,
                    searchText: `${c.nip ?? ''} ${c.displayName ?? ''}`,
                  }))}
                  value={clientId}
                  onSelect={pickClient}
                  placeholder="Wpisz nazwę odbiorcy…"
                />
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
              {buyer.name.trim() && (
                <div className="md:col-span-2 flex justify-end">
                  <Button variant="outline" size="sm" className="h-7 text-[11px]" onClick={() => setBuyerEdit(false)}>
                    Zwiń dane odbiorcy
                  </Button>
                </div>
              )}
            </CardContent>
            )}
          </Card>

          <Card>
            <div className="px-4 py-2.5 border-b flex items-center gap-3 flex-wrap">
              <span className="text-[13px] font-semibold">Pozycje z magazynu</span>
              {clientName && tab === 'fg' && (
                <div className="flex rounded-md border overflow-hidden">
                  {([['client', `${clientName} (${fgClientCount})`], ['all', 'Wszystkie']] as const).map(([key, label]) => (
                    <button key={key}
                            className={cn('px-2.5 h-7 text-[11px] font-semibold transition-colors',
                              stockView === key ? 'bg-green-600 text-white' : 'bg-background text-muted-foreground hover:bg-muted')}
                            onClick={() => setStockView(key)}>
                      {label}
                    </button>
                  ))}
                </div>
              )}
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

              {/* Lista magazynu to główne pole pracy przy wystawianiu — rośnie
                  z ekranem (dawne sztywne max-h-72 = 288 px zmuszało do
                  ciągłego przewijania przy 7 partiach kości i 3 grzbietów). */}
              <div className="border rounded-md min-h-[320px] max-h-[52vh] overflow-y-auto divide-y">
                {tab === 'fg' && fgFiltered.map(g => {
                  const added = addedIds.has(g.id)
                  return (
                    <div key={g.id} className="px-3 py-2 flex items-center gap-3 hover:bg-muted/50">
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-medium truncate">
                          {fgName(g)}
                          {g.client_name && (
                            <span className="ml-2 text-[10px] font-semibold text-blue-700 bg-blue-50 border border-blue-200 rounded px-1 py-px">
                              {g.client_name}
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-muted-foreground flex items-center gap-2 mt-0.5">
                          <span className="font-mono text-green-700 bg-green-50 border border-green-200 rounded px-1">{g.batch_no}</span>
                          <span>{g.qty_available} szt · {fmtKg3(Number(g.qty_available || 0) * Number(g.kg_per_unit || 0))} kg dostępne</span>
                        </div>
                      </div>
                      <Button variant="outline" size="sm" className="h-7 text-[11px] gap-1 shrink-0"
                              disabled={added} onClick={() => addFg(g)}>
                        {added ? 'Dodano' : <><Plus size={12} /> Dodaj</>}
                      </Button>
                    </div>
                  )
                })}
                {tab === 'raw' && (() => {
                  // Grupy per rodzaj — kości nie mieszają się z grzbietami i ćwiartką.
                  const GROUPS: { key: string; label: string; chip: string; match: (b: any) => boolean }[] = [
                    { key: 'raw',    label: 'Ćwiartka',   chip: 'bg-blue-50 text-blue-700 border-blue-200',       match: b => (b.stock_type || 'raw') === 'raw' },
                    { key: 'meat',   label: 'Mięso z/s',  chip: 'bg-emerald-50 text-emerald-700 border-emerald-200', match: b => b.stock_type === 'meat' },
                    { key: 'backs',  label: 'Grzbiety',   chip: 'bg-amber-50 text-amber-700 border-amber-200',    match: b => b.stock_type === 'byproduct' && b.name === 'Grzbiety' },
                    { key: 'bones',  label: 'Kości',      chip: 'bg-gray-100 text-gray-700 border-gray-300',      match: b => b.stock_type === 'byproduct' && b.name !== 'Grzbiety' },
                  ]
                  return GROUPS.map(g => {
                    const items = rawFiltered.filter(g.match)
                    if (!items.length) return null
                    const sumKg = items.reduce((a, b) => a + Number(b.kg_available || 0), 0)
                    return (
                      <div key={g.key}>
                        <div className="px-3 py-1.5 bg-surface-2 border-y border-surface-3 flex items-center gap-2 sticky top-0 z-10">
                          <span className={cn('text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border', g.chip)}>{g.label}</span>
                          <span className="text-[11px] text-muted-foreground">{items.length} poz. · {fmtKg3(sumKg)} kg</span>
                          {(() => {
                            const left = items.filter(b => !addedIds.has(b.id))
                            if (!left.length) return null
                            return (
                              <Button variant="outline" size="sm" className="h-6 ml-auto text-[11px] gap-1 shrink-0"
                                      onClick={() => addRawMany(items)}>
                                <Plus size={11} /> Dodaj wszystkie ({left.length})
                              </Button>
                            )
                          })()}
                        </div>
                        {items.map(b => {
                          const added = addedIds.has(b.id)
                          return (
                            <div key={b.id} className="px-3 py-2.5 flex items-center gap-3 hover:bg-muted/50 border-b border-surface-3 last:border-b-0">
                              <div className="flex-1 min-w-0">
                                <div className="text-[14px] font-medium truncate flex items-center gap-2">
                                  <span className="font-mono font-bold text-green-700 bg-green-50 border border-green-200 rounded px-1.5">{b.internal_batch_no}</span>
                                  <span className="truncate">{b.name || 'Surowiec'}</span>
                                </div>
                                <div className="text-[12px] text-muted-foreground flex items-center gap-2 mt-0.5">
                                  <span className="font-semibold text-ink-2">{fmtKg3(Number(b.kg_available || 0))} kg dostępne</span>
                                  {b.containers ? <span>· {b.containers} poj.</span> : null}
                                  {b.supplier_name && <span className="truncate">· {b.supplier_name}</span>}
                                </div>
                              </div>
                              <Button variant="outline" size="sm" className="h-8 text-[12px] gap-1 shrink-0"
                                      disabled={added} onClick={() => addRaw(b)}>
                                {added ? 'Dodano' : <><Plus size={13} /> Dodaj</>}
                              </Button>
                            </div>
                          )
                        })}
                      </div>
                    )
                  })
                })()}
                {((tab === 'fg' && !fgFiltered.length) || (tab === 'raw' && !rawFiltered.length)) && (
                  <div className="px-3 py-6 text-center text-[12px] text-muted-foreground">
                    {q ? 'Brak wyników wyszukiwania'
                      : tab === 'fg' && stockView === 'client'
                        ? `Brak wyrobów przypisanych do klienta ${clientName} — przełącz na „Wszystkie"`
                        : 'Brak dostępnego stanu magazynowego'}
                  </div>
                )}
              </div>

              {rows.length > 0 && (
                <Table className="text-[12px]">
                  <TableHeader>
                    <TableRow>
                      {['Towar', 'Partia', 'Ilość', 'Pojemniki', 'Waga', ...(valued ? [`Cena/kg [${sym}]`, `Wartość [${sym}]`] : []), ''].map((h, i) => (
                        <TableHead key={i} className="text-[9px] uppercase tracking-wider h-7 px-2">
                          {h}
                          {valued && h.startsWith('Cena') && (
                            <Input
                              type="text" inputMode="decimal" placeholder="wszystkim"
                              title="Wpisz jedną cenę — trafi do wszystkich pozycji; każdą można potem poprawić"
                              className="h-6 w-20 mt-1 font-mono text-[11px] normal-case"
                              onFocus={e => e.target.select()}
                              onChange={e => applyPriceToAll(sanitizeDecimal(e.target.value))} />
                          )}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r, i) => {
                      const over = rowQty(r) > r.available
                      return (
                        <TableRow key={i}>
                          <TableCell className="py-1.5 px-2 font-medium">{r.name}</TableCell>
                          <TableCell className="py-1.5 px-2 font-mono text-green-700">{r.batchNo || '—'}</TableCell>
                          <TableCell className="py-1.5 px-2">
                            <div className="flex items-center gap-1.5">
                              <Input type="text" inputMode={r.unit === 'szt' ? 'numeric' : 'decimal'}
                                     value={r.qtyStr}
                                     className={cn('h-8 w-20 font-mono', over && 'border-red-400 focus-visible:ring-red-400')}
                                     onFocus={e => e.target.select()}
                                     onChange={e => upd(i, 'qtyStr', r.unit === 'szt' ? sanitizeInt(e.target.value) : sanitizeDecimal(e.target.value))} />
                              <span className="text-[11px] text-muted-foreground">{r.unit}</span>
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
                          <TableCell className="py-1.5 px-2">
                            {r.stockType === 'fg' ? (
                              <span className="text-muted-foreground">—</span>
                            ) : (
                              <Input type="text" inputMode="numeric" placeholder="—"
                                     value={r.containersStr ?? ''}
                                     className="h-8 w-16 font-mono"
                                     onFocus={e => e.target.select()}
                                     onChange={e => upd(i, 'containersStr', sanitizeInt(e.target.value))} />
                            )}
                          </TableCell>
                          <TableCell className="py-1.5 px-2 font-mono font-semibold whitespace-nowrap">
                            {rowKg(r) > 0 ? `${fmtKg3(rowKg(r))} kg` : '—'}
                            {r.kgPerUnit ? <div className="text-[10px] font-normal text-muted-foreground">{fmtKg3(r.kgPerUnit)} kg/szt</div> : null}
                          </TableCell>
                          {valued && (
                            <TableCell className="py-1.5 px-2">
                              <Input type="text" inputMode="decimal" placeholder="0,00"
                                     value={r.priceStr}
                                     className="h-8 w-24 font-mono"
                                     onFocus={e => e.target.select()}
                                     onChange={e => upd(i, 'priceStr', sanitizeDecimal(e.target.value))} />
                            </TableCell>
                          )}
                          {valued && (
                            <TableCell className="py-1.5 px-2 text-right font-mono font-semibold whitespace-nowrap">
                              {rowValue(r).toFixed(2)} {sym}
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
              {valued && (
                <div className="space-y-1.5">
                  <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Waluta</Label>
                  <div className="grid grid-cols-2 rounded-md border overflow-hidden">
                    {(['PLN', 'EUR'] as const).map(c => (
                      <button key={c}
                              className={cn('h-8 text-[11px] font-semibold transition-colors',
                                currency === c ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground hover:bg-muted')}
                              onClick={() => setCurrency(c)}>
                        {c}
                      </button>
                    ))}
                  </div>
                  {currency === 'EUR' && (
                    <div className="flex items-center gap-1.5">
                      <Input type="text" inputMode="decimal" value={eurRateStr}
                             placeholder="kurs EUR"
                             className="h-8 font-mono text-[12px]"
                             onFocus={e => e.target.select()}
                             onChange={e => { setEurRateStr(sanitizeDecimal(e.target.value)); setEurRateDate('') }} />
                      <Button variant="outline" size="icon" className="h-8 w-8 shrink-0" title="Pobierz kurs z NBP"
                              disabled={rateLoading} onClick={fetchNbpRate}>
                        <RefreshCw size={13} className={rateLoading ? 'animate-spin' : ''} />
                      </Button>
                    </div>
                  )}
                  {currency === 'EUR' && (
                    <div className="text-[10px] text-muted-foreground">
                      {eurRateStr && eurRateDate
                        ? <>Kurs średni NBP (tab. A) z {eurRateDate}</>
                        : eurRateStr
                          ? 'Kurs wpisany ręcznie'
                          : rateLoading ? 'Pobieranie kursu z NBP…' : 'Pobierz kurs z NBP lub wpisz ręcznie'}
                    </div>
                  )}
                </div>
              )}
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
              {/* Nośniki na druk pojemnikowy. Pojemniki podpowiadamy z ważeń
                  (suma z pozycji WZ), palety wpisuje operator — tylko on widzi
                  samochód. Wszystko do poprawienia przed wystawieniem druku. */}
              <div className="space-y-1.5">
                <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  Pojemniki na saldo i druk
                  <span className="normal-case"> (z ważeń: {totalContainers}; wpisz 0, żeby nie ruszać salda)</span>
                </Label>
                <Input type="text" inputMode="numeric" className="h-9 font-mono"
                       placeholder={String(totalContainers)}
                       value={contOverride}
                       onFocus={e => e.target.select()}
                       onChange={e => setContOverride(sanitizeInt(e.target.value))} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Palety H1</Label>
                  <Input type="text" inputMode="numeric" className="h-9 font-mono"
                         value={String(palletsH1)}
                         onFocus={e => e.target.select()}
                         onChange={e => {
                           setPalletsH1(parseInt(sanitizeInt(e.target.value) || '0') || 0)
                         }} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                    Inne opakowania
                  </Label>
                  <div className="flex gap-1">
                    {/* Rodzaj ma własne saldo — siatek E1 nie zwraca się europaletą. */}
                    <select value={palletsOtherKind}
                            onChange={e => setPalletsOtherKind(e.target.value)}
                            className="h-9 flex-1 rounded border border-surface-4 bg-surface px-1 text-[11px]">
                      {OTHER_CARRIER_KINDS.map(k => (
                        <option key={k.value} value={k.value}>{k.label}</option>
                      ))}
                    </select>
                    <Input type="text" inputMode="numeric" className="h-9 w-14 font-mono"
                           value={String(palletsOther)}
                           onFocus={e => e.target.select()}
                           onChange={e => {
                             setPalletsOther(parseInt(sanitizeInt(e.target.value) || '0') || 0)
                           }} />
                  </div>
                </div>
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
              <div className="flex justify-between text-[12px]">
                <span className="text-muted-foreground">Razem waga</span>
                <span className="font-mono font-semibold">{fmtKg3(totalKg)} kg</span>
              </div>
              {valued && (
                <div className="flex justify-between items-baseline border-t pt-2">
                  <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Razem</span>
                  <span className="font-mono font-bold text-xl">{totalValue.toFixed(2)} <span className="text-[12px] font-medium text-muted-foreground">{sym}</span></span>
                </div>
              )}
              {valued && currency === 'EUR' && eurRate > 0 && totalValue > 0 && (
                <div className="text-right text-[11px] text-muted-foreground -mt-2">
                  ≈ {(totalValue * eurRate).toFixed(2)} zł (kurs {eurRate.toFixed(4)})
                </div>
              )}
              {/* Odbiorca rozpoznany jako pracownik: WZ zdejmuje towar ze
                  stanu, a potrącenie idzie prosto do jego rozliczenia. */}
              {empMatch && (
                <div className={cn('rounded-md border px-3 py-2.5 text-[12px]',
                  deductionDefault > 0
                    ? 'border-primary/40 bg-primary/5'
                    : 'border-amber-300 bg-amber-50 text-amber-900')}>
                  {deductionDefault > 0 ? (
                    <div className="flex items-center gap-2">
                      <input type="checkbox" className="w-4 h-4 rounded cursor-pointer"
                        checked={empDeduct} onChange={e => setEmpDeduct(e.target.checked)} />
                      <span className="flex-1">
                        Odbiorca to pracownik <strong>{empMatch.name}</strong> — dopisz potrącenie
                      </span>
                      <Input className="w-24 h-8 text-right" type="number" step="0.01" min="0"
                        value={empAmount} onChange={e => setEmpAmount(e.target.value)}
                        disabled={!empDeduct} />
                      <span className="text-muted-foreground">zł</span>
                    </div>
                  ) : (
                    <>Odbiorca to pracownik <strong>{empMatch.name}</strong>, ale WZ jest bez
                    wyceny — uzupełnij ceny, żeby powstało potrącenie.</>
                  )}
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
