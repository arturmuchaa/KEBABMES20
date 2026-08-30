/**
 * IngredientReceptionPage — Przyjęcie DDFiP (przyprawy, dodatki, opakowania).
 *
 * Odpowiednik „Przyjęcia surowca" dla artykułów pomocniczych. Księga prowadzi
 * je OSOBNO: własna instrukcja 1.3 oPRP, własna karta 1.3.1 i własna seria
 * numerów „DF/1/08" (litera odróżnia je od numeru przyjęcia mięsa „1/08").
 *
 * Dotąd MES miał tu tylko okno „Przyjęcie PZ" — składnik, ilość, cena. Nie
 * pytało ani o dostawcę, ani o partię dostawcy, ani o ocenę dostawy, więc
 * karty 1.3.1 biuro nie miało z czego wypełnić.
 *
 * Ocena N (odmowa) zapisuje się tak samo jak K, tyle że NIC nie wchodzi na
 * magazyn — instrukcja 1.3 każe rejestrować także dostawy odrzucone, „gdyż
 * posłużyć ono może w przyszłości do oceny dostawców".
 */
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import {
  ArrowLeft, Check, FileSpreadsheet, Plus, Printer, Trash2, X,
} from 'lucide-react'

import { useApi } from '@/hooks/useApi'
import { ingredientReceptionsApi, ingredientsApi, suppliersApi } from '@/lib/apiClient'
import type { IngredientReception } from '@/lib/api'
import { fmtDatePl, todayIso, cn } from '@/lib/utils'
import { useIngredients } from '@/features/ingredients/hooks'
import { IngredientPicker } from '@/features/ingredients/components/IngredientPicker'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardTitle } from '@/components/ui/card'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'

/** Jedna pozycja formularza — jeden składnik z jednej partii dostawcy. */
interface Pozycja {
  ingredientId: string
  qty:          string
  batchNo:      string
  expiryDate:   string
  pricePerUnit: string
}

const pustaPozycja = (): Pozycja => ({
  ingredientId: '', qty: '', batchNo: '', expiryDate: '', pricePerUnit: '',
})

/** Ocena cząstkowa wg instrukcji 1.3: bz albo N. */
function OcenaPrzelacznik({ value, onChange, label, hint }: {
  value: string; onChange: (v: string) => void; label: string; hint: string
}) {
  return (
    <div>
      <Label className="text-xs mb-1 block">{label}</Label>
      <div className="flex gap-1">
        {(['bz', 'N'] as const).map(v => (
          <button
            key={v} type="button" onClick={() => onChange(v)}
            className={cn(
              'px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors',
              value === v
                ? (v === 'bz' ? 'bg-emerald-600 text-white border-emerald-600'
                              : 'bg-red-600 text-white border-red-600')
                : 'bg-white text-ink-2 border-surface-4 hover:border-primary/50',
            )}>
            {v === 'bz' ? 'b/z' : 'N'}
          </button>
        ))}
      </div>
      <CardDescription className="text-[11px] mt-1">{hint}</CardDescription>
    </div>
  )
}

export function IngredientReceptionPage() {
  const navigate = useNavigate()
  const [tryb, setTryb] = useState<'lista' | 'nowe'>('lista')

  const { data: dokumenty, loading, refetch } = useApi<IngredientReception[]>(
    () => ingredientReceptionsApi.list())
  const { data: dostawcy } = useApi(() => suppliersApi.list())
  const { ingredients, stock, refetch: refetchIng } = useIngredients()

  const stockMap = useMemo(
    () => new Map(((stock as any[]) ?? []).map(s => [s.ingredientId ?? s.id, s])),
    [stock])

  // ── Formularz ──
  const [numer, setNumer]       = useState('')
  const [data, setData]         = useState(todayIso())
  const [dostawca, setDostawca] = useState('')
  const [dokument, setDokument] = useState('')
  const [wizualna, setWizualna] = useState('bz')
  const [zgodnosc, setZgodnosc] = useState('bz')
  const [uwagi, setUwagi]       = useState('')
  const [ocena, setOcena]       = useState<'K' | 'N'>('K')
  const [wykonal, setWykonal]   = useState('')
  const [sprawdzil, setSprawdzil] = useState('')
  const [pozycje, setPozycje]   = useState<Pozycja[]>([pustaPozycja()])
  const [zapisuje, setZapisuje] = useState(false)

  const { data: podpowiedz } = useApi(
    () => tryb === 'nowe' ? ingredientReceptionsApi.nextNumber(data) : Promise.resolve(null),
    [tryb, data])

  function otworzFormularz() {
    setNumer(''); setData(todayIso()); setDostawca(''); setDokument('')
    setWizualna('bz'); setZgodnosc('bz'); setUwagi(''); setOcena('K')
    setWykonal(''); setSprawdzil(''); setPozycje([pustaPozycja()])
    setTryb('nowe')
  }

  const zmienPozycje = (i: number, patch: Partial<Pozycja>) =>
    setPozycje(p => p.map((x, j) => (j === i ? { ...x, ...patch } : x)))

  const wypelnione = pozycje.filter(p => p.ingredientId && Number(p.qty) > 0)

  async function zapisz() {
    if (!dostawca) { toast.error('Wybierz dostawcę z kartoteki'); return }
    if (wypelnione.length === 0) {
      toast.error('Dodaj przynajmniej jedną pozycję — także przy odmowie przyjęcia')
      return
    }
    setZapisuje(true)
    try {
      const zapisany = await ingredientReceptionsApi.create({
        receptionNo: numer.trim(),
        receivedDate: data,
        supplierId: dostawca,
        documentNo: dokument.trim(),
        visualCheck: wizualna,
        complianceCheck: zgodnosc,
        notes: uwagi.trim(),
        decision: ocena,
        doneBy: wykonal.trim(),
        checkedBy: sprawdzil.trim(),
        lines: wypelnione.map(p => ({
          ingredientId: p.ingredientId,
          qty: Number(p.qty),
          batchNo: p.batchNo.trim(),
          expiryDate: p.expiryDate,
          pricePerUnit: Number(p.pricePerUnit) || 0,
        })),
      })
      toast.success(ocena === 'K'
        ? `Przyjęcie ${zapisany.receptionNo} zapisane — ${wypelnione.length} poz. na magazynie`
        : `Odmowa ${zapisany.receptionNo} zarejestrowana — magazyn bez zmian`)
      refetch(); refetchIng()
      // Etykiety tylko dla towaru, który fizycznie wjechał.
      if (ocena === 'K') navigate(`/office/przyjecie-ddfip/${zapisany.id}/etykiety`)
      else setTryb('lista')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Błąd zapisu')
    } finally {
      setZapisuje(false)
    }
  }

  // ── Lista dokumentów ──
  if (tryb === 'lista') {
    const lista = (dokumenty ?? []) as IngredientReception[]
    return (
      <div className="space-y-3 animate-fade-in">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base">Przyjęcie DDFiP</CardTitle>
            <CardDescription className="mt-0.5">
              Przyprawy, dodatki, osłonki, folie i opakowania · instrukcja 1.3 oPRP,
              karta 1.3.1 · osobna seria numerów DF
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => navigate('/office/rejestr-ddfip/druk?dane=1')}>
              <FileSpreadsheet size={15} className="mr-1.5" /> Karta 1.3.1
            </Button>
            <Button onClick={otworzFormularz}>
              <Plus size={15} className="mr-1.5" /> Nowe przyjęcie
            </Button>
          </div>
        </div>

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  {['Numer', 'Data', 'Dostawca', 'Asortyment', 'Faktura / atest', 'Ocena', 'Pozycje']
                    .map(h => <TableHead key={h}>{h}</TableHead>)}
                </TableRow>
              </TableHeader>
              <TableBody>
                {lista.map(d => (
                  <TableRow key={d.id} className={d.decision === 'N' ? 'bg-red-50/60' : ''}>
                    <TableCell>
                      <code className="font-mono font-bold text-primary">{d.receptionNo}</code>
                    </TableCell>
                    <TableCell className="text-ink-2">{fmtDatePl(d.receivedDate)}</TableCell>
                    <TableCell className="text-ink-2">{d.supplierName || '—'}</TableCell>
                    <TableCell className="font-semibold text-ink">{d.assortment || '—'}</TableCell>
                    <TableCell className="text-ink-2">{d.documentNo || '—'}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={d.decision === 'N'
                        ? 'bg-red-50 text-red-700 border-red-200'
                        : 'bg-emerald-50 text-emerald-700 border-emerald-200'}>
                        {d.decision === 'N' ? 'N — odmowa' : 'K'}
                      </Badge>
                    </TableCell>
                    <TableCell className="tabular-nums text-ink-2">
                      {d.decision === 'N' ? '—' : d.lines.length}
                    </TableCell>
                  </TableRow>
                ))}
                {!loading && lista.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-sm text-ink-4">
                      Brak przyjęć — pierwsza zarejestrowana dostawa pojawi się tutaj.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    )
  }

  // ── Formularz nowego przyjęcia ──
  return (
    <div className="space-y-4 animate-fade-in">
      <div>
        <button type="button" onClick={() => setTryb('lista')}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-2">
          <ArrowLeft size={15} /> Wróć do rejestru
        </button>
        <CardTitle className="text-xl">Przyjęcie DDFiP</CardTitle>
        <CardDescription>
          Przyprawy, dodatki, osłonki, folie i opakowania — jeden dokument na jedno auto.
        </CardDescription>
      </div>

      {/* Nagłówek dokumentu */}
      <Card>
        <CardContent className="p-3 grid grid-cols-[150px_150px_minmax(0,1fr)_minmax(0,1fr)] gap-4">
          <div>
            <Label className="text-[10px] font-bold text-primary uppercase tracking-wide mb-1 block">
              Numer przyjęcia
            </Label>
            <Input value={numer} onChange={e => setNumer(e.target.value)}
              placeholder={(podpowiedz as any)?.nextNo ?? 'DF/1/08'} />
            <CardDescription className="text-[11px] mt-1">
              Puste = {(podpowiedz as any)?.nextNo ?? 'kolejny w miesiącu'}
            </CardDescription>
          </div>
          <div>
            <Label className="text-xs mb-1 block">Data przyjęcia</Label>
            <Input type="date" value={data} onChange={e => setData(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs mb-1 block">Dostawca</Label>
            <Select value={dostawca} onValueChange={setDostawca}>
              <SelectTrigger><SelectValue placeholder="Wybierz z kartoteki" /></SelectTrigger>
              <SelectContent>
                {((dostawcy as any[]) ?? []).map(s => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <CardDescription className="text-[11px] mt-1">
              Tylko podmiot z listy zakwalifikowanych (instrukcja 1.3)
            </CardDescription>
          </div>
          <div>
            <Label className="text-xs mb-1 block">Faktura / atest</Label>
            <Input value={dokument} onChange={e => setDokument(e.target.value)}
              placeholder="np. FV 123/2026" />
          </div>
        </CardContent>
      </Card>

      {/* Pozycje */}
      <Card>
        <CardContent className="p-3 space-y-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-xs uppercase tracking-[0.08em] text-ink-2">
              Pozycje dostawy
            </CardTitle>
            <Button size="sm" variant="outline"
              onClick={() => setPozycje(p => [...p, pustaPozycja()])}>
              <Plus size={13} className="mr-1" /> Dodaj pozycję
            </Button>
          </div>

          <div className="grid grid-cols-[minmax(0,2fr)_110px_minmax(0,1fr)_150px_110px_36px] gap-2 text-[11px] font-bold uppercase tracking-wide text-ink-3">
            <span>Składnik</span><span>Ilość</span><span>Partia dostawcy</span>
            <span>Termin przydatności</span><span>Cena / jedn.</span><span />
          </div>

          {pozycje.map((p, i) => (
            <div key={i} className="grid grid-cols-[minmax(0,2fr)_110px_minmax(0,1fr)_150px_110px_36px] gap-2 items-start">
              <IngredientPicker
                ingredients={(ingredients as any[]) ?? []}
                stockMap={stockMap}
                value={p.ingredientId}
                onSelect={id => zmienPozycje(i, { ingredientId: id })}
                onCreateNew={async nazwa => {
                  const utworzony = await (ingredientsApi as any).create({
                    name: nazwa, category: 'other', unit: 'kg', isUnlimited: false,
                  })
                  refetchIng()
                  zmienPozycje(i, { ingredientId: utworzony.id })
                  toast.success(`„${nazwa}" dodany do kartoteki`)
                }}
              />
              <Input type="number" step="0.001" value={p.qty}
                onChange={e => zmienPozycje(i, { qty: e.target.value })} />
              <Input value={p.batchNo} placeholder="z opakowania"
                onChange={e => zmienPozycje(i, { batchNo: e.target.value })} />
              <Input type="date" value={p.expiryDate}
                onChange={e => zmienPozycje(i, { expiryDate: e.target.value })} />
              <Input type="number" step="0.01" value={p.pricePerUnit}
                onChange={e => zmienPozycje(i, { pricePerUnit: e.target.value })} />
              <Button size="icon" variant="ghost" disabled={pozycje.length <= 1}
                onClick={() => setPozycje(p2 => p2.filter((_, j) => j !== i))}>
                <Trash2 size={14} />
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Oceny — kolumny f, g, h, i karty 1.3.1 */}
      <Card>
        <CardContent className="p-3 grid grid-cols-[180px_220px_minmax(0,1fr)] gap-4">
          <OcenaPrzelacznik label="Ocena wizualna dostawy" value={wizualna} onChange={setWizualna}
            hint="Auto, kierowca, komora, stan opakowań" />
          <OcenaPrzelacznik label="Zgodność z zamówieniem i termin" value={zgodnosc} onChange={setZgodnosc}
            hint="Ilość zgodna z dokumentem, termin pod moc przerobową" />
          <div>
            <Label className="text-xs mb-1 block">Uwagi</Label>
            <Input value={uwagi} onChange={e => setUwagi(e.target.value)}
              placeholder="np. rozerwane worki, brak atestu" />
          </div>
        </CardContent>
      </Card>

      {/* Kwalifikacja — kolumna i */}
      <Card className={ocena === 'N' ? 'border-red-300 bg-red-50' : ''}>
        <CardContent className="p-3 grid grid-cols-[minmax(0,1fr)_180px_180px] gap-4 items-end">
          <div>
            <Label className="text-xs mb-1 block">Kwalifikacja całej dostawy</Label>
            <div className="flex gap-2">
              <button type="button" onClick={() => setOcena('K')}
                className={cn('px-4 py-2 rounded-lg text-sm font-bold border transition-colors flex items-center gap-1.5',
                  ocena === 'K' ? 'bg-emerald-600 text-white border-emerald-600'
                                : 'bg-white text-ink-2 border-surface-4')}>
                <Check size={15} /> K — przyjmuję
              </button>
              <button type="button" onClick={() => setOcena('N')}
                className={cn('px-4 py-2 rounded-lg text-sm font-bold border transition-colors flex items-center gap-1.5',
                  ocena === 'N' ? 'bg-red-600 text-white border-red-600'
                                : 'bg-white text-ink-2 border-surface-4')}>
                <X size={15} /> N — odmawiam
              </button>
            </div>
            <CardDescription className="text-[11px] mt-1.5">
              {ocena === 'N'
                ? 'Odmowa zostaje w rejestrze do oceny dostawcy — nic nie wejdzie na magazyn.'
                : 'Pozycje wejdą na magazyn przypraw pod tym numerem dokumentu.'}
            </CardDescription>
          </div>
          <div>
            <Label className="text-xs mb-1 block">Wykonał</Label>
            <Input value={wykonal} onChange={e => setWykonal(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs mb-1 block">Sprawdził</Label>
            <Input value={sprawdzil} onChange={e => setSprawdzil(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => setTryb('lista')}>Anuluj</Button>
        <Button onClick={zapisz} disabled={zapisuje}>
          {ocena === 'K' ? <Printer size={15} className="mr-1.5" /> : null}
          {zapisuje ? 'Zapisuję…' : ocena === 'K' ? 'Zapisz i drukuj etykiety' : 'Zarejestruj odmowę'}
        </Button>
      </div>
    </div>
  )
}
