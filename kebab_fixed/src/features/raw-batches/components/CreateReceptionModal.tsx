/**
 * CreateReceptionModal — rejestracja CAŁEJ dostawy.
 *
 * Jedno auto = jeden numer przyjęcia („12/08/2026") i tyle numerów
 * porządkowych, na ile zakład je rozbił. Dotąd biuro wypełniało ten formularz
 * dwa albo trzy razy dla tej samej dostawy i nic nie łączyło powstałych partii.
 *
 * Pozycje HDI dostawcy wpisuje się RAZ, a przypisanie do numeru porządkowego
 * jest jednym kliknięciem w wierszu — dzięki temu widać na jednym ekranie, że
 * suma się zgadza i że żadna partia dostawcy nie została rozdzielona.
 */
import { useState, useEffect, useMemo, useRef } from 'react'
import { fmtPln, fmtKg } from '@/lib/utils'
import { Plus, Package, Edit2, Check, X, Layers, AlertTriangle, ScanLine } from 'lucide-react'
import {
  CALIBER_OPTIONS, OTHER_CARRIER_KINDS, caliberKg, caliberValue, containersForKg,
  type CaliberValue,
} from '@/lib/containers'
import {
  checkAgainstHdi, groupLines, nextSupplierBatchNo, ordinalLabels, parseKg,
  receptionIssues, receptionTotalKg, renumberAfterRemove, withContainers,
  type HdiLine, type ReceptionGroup,
} from '../receptionSplit'
import { receptionsApi } from '@/lib/apiClient'
import type { ReceptionHeader } from '../types'

import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Badge } from '@/components/ui/badge'
import {
  Card, CardContent, CardDescription, CardTitle,
} from '@/components/ui/card'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'

interface SupplierOption { value: string; label: string }

/** Usługa dotyczy WYŁĄCZNIE mięsa z/s — tylko ono bywa powierzone przez klienta. */
const SERVICE_MATERIAL_ID = 'mat-mieso-zs'

/** Siatka wiersza HDI; kolumna numeru porządkowego dochodzi dopiero przy podziale. */
const GRID = (groups: number) => groups > 1
  ? 'grid-cols-[28px_110px_1fr_130px_130px_auto_40px]'
  : 'grid-cols-[28px_110px_1fr_130px_130px_40px]'

interface CreateReceptionModalProps {
  open:                 boolean
  onClose:              () => void
  /** Oddaje gotowy podział; walidacja i zapis siedzą w hooku. */
  onSubmit:             (groups: ReceptionGroup[]) => void
  header:               ReceptionHeader
  suggestedReceptionNo: string
  suggestedBatchNo:     string
  supplierOptions:      SupplierOption[]
  loading:              boolean
  error:                string | null
  onHeaderChange:       <K extends keyof ReceptionHeader>(key: K, value: ReceptionHeader[K]) => void
}

function emptyLine(group = 0): HdiLine {
  const today = new Date().toISOString().slice(0, 10)
  const expiry = new Date()
  expiry.setDate(expiry.getDate() + 7)
  return {
    supplierBatchNo: '', kgReceived: 0, slaughterDate: today,
    expiryDate: expiry.toISOString().slice(0, 10), group,
  }
}

/**
 * nextLine — kolejny wiersz podpowiadany z poprzedniego.
 *
 * Na HDI od KOKO (90% dostaw) osiem pozycji ma te same daty i numery partii
 * idące po kolei — przepisywanie ich od zera osiem razy to osiem okazji do
 * pomyłki. Nowy wiersz dziedziczy daty i numer +1; wagę operator wpisuje
 * zawsze, bo tylko ona naprawdę różni pozycje.
 */
function nextLine(prev: HdiLine | undefined, group: number): HdiLine {
  if (!prev) return emptyLine(group)
  return {
    supplierBatchNo: nextSupplierBatchNo(prev.supplierBatchNo),
    kgReceived:      0,
    slaughterDate:   prev.slaughterDate,
    expiryDate:      prev.expiryDate,
    group,
  }
}

export function CreateReceptionModal({
  open, onClose, onSubmit, header, suggestedReceptionNo, suggestedBatchNo,
  supplierOptions, loading, error, onHeaderChange,
}: CreateReceptionModalProps) {
  const canBeService = header.materialTypeId === SERVICE_MATERIAL_ID
  const isService = header.isService && canBeService

  const [customNo, setCustomNo] = useState('')
  const [editingNo, setEditingNo] = useState(false)
  const [lines, setLines] = useState<HdiLine[]>([emptyLine()])
  const [groupCount, setGroupCount] = useState(1)
  const fileRef = useRef<HTMLInputElement>(null)
  const [scanning, setScanning] = useState(false)
  const [scanNote, setScanNote] = useState<{ ok: boolean; text: string } | null>(null)
  const [dragOver, setDragOver] = useState(false)
  /** Ręczne liczby pojemników per numer porządkowy (klucz = indeks grupy). */
  const [containerOverride, setContainerOverride] = useState<Record<number, number | null>>({})

  useEffect(() => {
    if (!open) return
    setCustomNo(suggestedReceptionNo || '')
    setEditingNo(false)
    setLines([emptyLine()])
    setGroupCount(1)
    setContainerOverride({})
    setScanNote(null)
  }, [open, suggestedReceptionNo])

  // Numer wpisany ręcznie leci do hooka tylko wtedy, gdy różni się od
  // podpowiedzi — inaczej każde otwarcie modala „rezerwowałoby" numer.
  useEffect(() => {
    const trimmed = customNo.trim()
    onHeaderChange('receptionNo', trimmed && trimmed !== suggestedReceptionNo ? trimmed : '')
  }, [customNo, suggestedReceptionNo]) // eslint-disable-line react-hooks/exhaustive-deps

  const totalKg = useMemo(() => receptionTotalKg(lines), [lines])
  const caliber = caliberValue(header.containerKg)

  // Liczba pojemników = ta, którą operator WIDZI: wyliczona z kalibru albo
  // ręcznie przeliczona. Jedno źródło dla ekranu, kontroli z HDI i zapisu.
  // Numery, które grupy dostaną przy zapisie („472", „473"). Operator dzieli
  // dostawę myśląc numerami hali, nie pozycjami listy.
  const batchNos = useMemo(
    () => ordinalLabels(suggestedBatchNo, groupCount), [suggestedBatchNo, groupCount])

  const groups: ReceptionGroup[] = useMemo(
    () => withContainers(
      groupLines(lines, groupCount), header.containerKg ?? null, containerOverride,
      (kg, cal) => containersForKg(kg, cal)).map((g, i) => ({ ...g, batchNo: batchNos[i] })),
    [lines, groupCount, containerOverride, header.containerKg, batchNos],
  )
  const issues = useMemo(
    () => receptionIssues(lines, groupCount, batchNos), [lines, groupCount, batchNos])
  const hdiCheck = useMemo(
    () => checkAgainstHdi(lines, groups, { kg: header.docKg, containers: header.docContainers }),
    [lines, groups, header.docKg, header.docContainers])
  const value = totalKg * (header.pricePerKg || 0)

  // Nowa pozycja ląduje w OSTATNIM numerze porządkowym: HDI przepisuje się
  // z góry na dół, więc kolejny wiersz najczęściej należy tam, gdzie poprzedni.
  const addLine    = () => setLines(p => [...p, nextLine(p[p.length - 1], p[p.length - 1]?.group ?? 0)])
  const removeLine = (i: number) => { if (lines.length > 1) setLines(p => p.filter((_, j) => j !== i)) }
  const updateLine = (i: number, field: keyof HdiLine, val: string | number) => {
    // Przepięcie pozycji do innego numeru zmienia kilogramy OBU grup, więc
    // ręcznie przeliczone pojemniki przestają do nich pasować — wracamy do
    // wyliczenia z kalibru zamiast nieść nieaktualną liczbę do zapisu.
    if (field === 'group') setContainerOverride({})
    setLines(p => p.map((l, j) => j === i ? { ...l, [field]: val } : l))
  }

  /**
   * loadHdi — odczyt skanu podstawia pozycje i nagłówek dokumentu.
   *
   * Wszystko ląduje w JEDNYM numerze porządkowym: podział to decyzja
   * operatora, której na dokumencie nie ma. Wpisanego już podziału nie
   * ruszamy poza wyzerowaniem — inaczej wczytanie skanu po ręcznym
   * rozbiciu zostawiłoby pozycje przypisane do nieistniejących grup.
   */
  const loadHdi = async (file: File) => {
    setScanning(true)
    setScanNote(null)
    try {
      const scan = await receptionsApi.scanHdi(file)
      if (scan.lines.length === 0) {
        setScanNote({ ok: false, text:
          'Nie rozpoznano żadnej pozycji. Sprawdź, czy to skan HDI i czy jest czytelny — pozycje można wpisać ręcznie.' })
        return
      }
      setLines(scan.lines.map(l => ({
        supplierBatchNo: l.supplierBatchNo,
        kgReceived:      l.kgReceived,
        kgRaw:           String(l.kgReceived).replace('.', ','),
        slaughterDate:   l.slaughterDate,
        expiryDate:      l.expiryDate,
        group:           0,
      })))
      setGroupCount(1)
      setContainerOverride({})
      if (scan.hdiNo)       onHeaderChange('hdiNo', scan.hdiNo)
      if (scan.documentNo)  onHeaderChange('documentNo', scan.documentNo)
      if (scan.shippedDate) onHeaderChange('receivedDate', scan.shippedDate)
      if (scan.totalKg)     onHeaderChange('docKg', scan.totalKg)
      if (scan.containers)  onHeaderChange('docContainers', scan.containers)
      if (scan.pallets)     onHeaderChange('palletsH1', scan.pallets)
      // Dostawca podstawia się tylko wtedy, gdy rozpoznanie było jednoznaczne;
      // przy dwóch pasujących backend świadomie nie wybiera żadnego.
      if (scan.supplier)    onHeaderChange('supplierId', scan.supplier.id)

      const kg = scan.lines.reduce((s, l) => s + l.kgReceived, 0)
      setScanNote(scan.sumOk === false
        ? { ok: false, text:
            `Odczytano ${scan.lines.length} pozycji na ${fmtKg(kg, 1)} kg, ale stopka HDI mówi ` +
            `${fmtKg(scan.totalKg ?? 0, 1)} kg — brakuje pozycji albo któraś waga została źle odczytana. Popraw ręcznie.` }
        : { ok: true, text:
            `Odczytano ${scan.lines.length} pozycji na ${fmtKg(kg, 1)} kg` +
            (scan.sumOk ? ' — zgodne ze stopką HDI.' : '.') +
            (scan.supplier
              ? ` Dostawca: ${scan.supplier.name} (rozpoznany po ${scan.supplier.matchedBy}).`
              : ' Dostawcy nie udało się rozpoznać — wybierz go z listy.') +
            ' Sprawdź numery partii: literówki w nich nie rozjeżdżają żadnej sumy.' })
    } catch (e) {
      setScanNote({ ok: false, text: e instanceof Error ? e.message : 'Nie udało się odczytać pliku' })
    } finally {
      setScanning(false)
    }
  }

  /**
   * Skan trafia do formularza także PRZECIĄGNIĘCIEM i przez Ctrl+V.
   *
   * Dopóki MES nie steruje bizhubem, operator i tak skanuje do folderu —
   * a wtedy przeciągnięcie pliku na okno albo wklejenie ze schowka jest
   * krótsze niż przeklikiwanie okna wyboru pliku. Działa też w przeglądarce,
   * czyli na stanowiskach bez aplikacji desktopowej.
   */
  useEffect(() => {
    if (!open) return
    const onPaste = (e: ClipboardEvent) => {
      // Wklejanie TEKSTU do pól formularza musi działać normalnie —
      // przechwytujemy tylko wtedy, gdy w schowku faktycznie jest plik.
      const file = [...(e.clipboardData?.files ?? [])][0]
      if (!file) return
      e.preventDefault()
      loadHdi(file)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file) loadHdi(file)
  }

  // Ten sam powód, co przy przepinaniu pozycji: po rozbiciu grupa ma inne
  // kilogramy niż ta, dla której operator liczył stos.
  const addGroup = () => { setContainerOverride({}); setGroupCount(n => n + 1) }
  const removeGroup = (index: number) => {
    if (groupCount <= 1) return
    setLines(p => renumberAfterRemove(p, index))
    setContainerOverride({})
    setGroupCount(n => n - 1)
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent
        className={`max-w-5xl max-h-[92vh] overflow-y-auto ${dragOver ? 'ring-2 ring-primary' : ''}`}
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}>
        <DialogHeader>
          <DialogTitle>Przyjęcie surowca</DialogTitle>
          <DialogDescription>
            Cała dostawa pod jednym numerem przyjęcia — rozbita na tyle numerów
            porządkowych, ile stosów fizycznie stanęło w chłodni.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">

          {/* Usługa — tylko mięso z/s bywa powierzone przez klienta */}
          {canBeService && (
            <Card className={isService ? 'border-amber-300 bg-amber-50' : ''}>
              <CardContent className="p-3 flex items-start gap-3">
                <input
                  id="rec-usluga" type="checkbox" className="mt-1"
                  checked={isService}
                  onChange={e => onHeaderChange('isService', e.target.checked)} />
                <label htmlFor="rec-usluga" className="cursor-pointer">
                  <div className="text-sm font-semibold">Przyjęcie na usługę</div>
                  <CardDescription className="text-[12px]">
                    Mięso powierzone przez klienta — numery porządkowe idą osobną
                    serią z literą U (48U, 49U…) i wchodzą na zwykły magazyn mięsa.
                  </CardDescription>
                </label>
              </CardContent>
            </Card>
          )}

          {/* Nagłówek dokumentu */}
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_140px] gap-4">
            <Card className="border-primary/20 bg-primary/5">
              <CardContent className="p-3">
                <Label className="text-[10px] font-bold text-primary uppercase tracking-wide mb-1 block">
                  Numer przyjęcia
                </Label>
                {editingNo ? (
                  <div className="flex items-center gap-2 mt-1">
                    <Input
                      value={customNo}
                      onChange={e => setCustomNo(e.target.value)}
                      autoFocus
                      className="font-mono font-black text-lg text-primary h-11" />
                    <Button size="icon" onClick={() => setEditingNo(false)} className="h-11 w-11">
                      <Check size={16} />
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between mt-1">
                    <CardTitle className="text-xl font-black font-mono text-primary">
                      {customNo || suggestedReceptionNo || '—'}
                    </CardTitle>
                    <Button variant="ghost" size="icon" onClick={() => setEditingNo(true)}
                      className="h-8 w-8 text-primary hover:bg-primary/10">
                      <Edit2 size={13} />
                    </Button>
                  </div>
                )}
                <CardDescription className="text-[10px] mt-0.5">
                  jeden dokument na całą dostawę
                </CardDescription>
              </CardContent>
            </Card>

            <div className="space-y-1.5">
              <Label>Dostawca *</Label>
              <Select value={header.supplierId} onValueChange={v => onHeaderChange('supplierId', v)}>
                <SelectTrigger className="h-11">
                  <SelectValue placeholder="Wybierz dostawcę..." />
                </SelectTrigger>
                <SelectContent>
                  {supplierOptions.map(o => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Data przyjęcia</Label>
              <Input
                type="date" className="h-11"
                value={header.receivedDate}
                onChange={e => onHeaderChange('receivedDate', e.target.value)} />
            </div>
          </div>

          <Separator />

          {/* Pozycje HDI */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Layers size={14} className="text-muted-foreground" />
                <Label className="text-sm font-semibold">Partie dostawcy (pozycje z HDI)</Label>
                <Badge variant="secondary">{lines.length}</Badge>
              </div>
              <div className="flex gap-2">
                {/* Skan HDI zamiast przepisywania ośmiu wierszy z papieru.
                    Odczyt trafia do tabeli DO SPRAWDZENIA — nic nie zapisuje
                    się w bazie, dopóki operator nie potwierdzi przyjęcia. */}
                <input
                  ref={fileRef} type="file" accept=".pdf,.png,.jpg,.jpeg" className="hidden"
                  onChange={e => {
                    const f = e.target.files?.[0]
                    if (f) loadHdi(f)
                    e.target.value = ''
                  }} />
                <Button variant="outline" size="sm" disabled={scanning}
                  onClick={() => fileRef.current?.click()}>
                  {scanning
                    ? <span className="w-3.5 h-3.5 mr-1.5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                    : <ScanLine size={13} className="mr-1.5" />}
                  {scanning ? 'Odczytuję…' : 'Wczytaj HDI'}
                </Button>
                <Button variant="outline" size="sm" onClick={addLine}>
                  <Plus size={13} className="mr-1.5" /> Dodaj pozycję
                </Button>
              </div>
            </div>

            {!scanNote && !scanning && (
              <CardDescription className="text-[11px] mb-2">
                Skan można też przeciągnąć na to okno albo wkleić ze schowka (Ctrl+V).
              </CardDescription>
            )}

            {scanNote && (
              <Card className={`mb-3 ${scanNote.ok ? 'border-green-200 bg-green-50' : 'border-amber-300 bg-amber-50'}`}>
                <CardContent className="px-3 py-2 flex items-start gap-2">
                  <ScanLine size={13} className={`flex-shrink-0 mt-0.5 ${scanNote.ok ? 'text-green-700' : 'text-amber-700'}`} />
                  <CardDescription className={scanNote.ok ? 'text-green-800' : 'text-amber-800'}>
                    {scanNote.text}
                  </CardDescription>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardContent className="p-0">
                {/* Kolejność kolumn DOKŁADNIE jak na HDI: Lp, masa netto,
                    nr partii, data uboju, data ważności. Operator przepisuje
                    wiersz z papieru lewo-do-prawa, bez skakania wzrokiem. */}
                <div className={`grid ${GRID(groupCount)} gap-2 px-4 py-2 border-b bg-muted/30`}>
                  {['Lp', 'Masa netto', 'Nr partii', 'Data uboju', 'Data ważności',
                    ...(groupCount > 1 ? ['Nr porządkowy'] : []), ''].map((h, i) => (
                    <CardDescription key={i}
                      className={`text-[10px] font-bold uppercase tracking-wide ${i === 1 ? 'text-right' : ''}`}>
                      {h}
                    </CardDescription>
                  ))}
                </div>
                <div className="divide-y">
                  {lines.map((line, idx) => (
                    <div key={idx} className={`grid ${GRID(groupCount)} gap-2 px-4 py-2 items-center`}>
                      <CardDescription className="text-xs font-bold tabular-nums text-center">
                        {idx + 1}
                      </CardDescription>
                      {/* Tekst, nie number: HDI drukuje „1 800,00" — spacja
                          tysięcy i przecinek, których input[type=number] nie
                          przyjmuje. Wartość rozbiera parseKg. */}
                      <Input
                        type="text" inputMode="decimal" placeholder="0,00"
                        value={line.kgRaw ?? (line.kgReceived || '')}
                        onChange={e => setLines(p => p.map((l, j) => j === idx
                          ? { ...l, kgRaw: e.target.value, kgReceived: parseKg(e.target.value) }
                          : l))}
                        className="h-9 text-right font-bold tabular-nums" />
                      <Input
                        placeholder="np. 112819"
                        value={line.supplierBatchNo}
                        onChange={e => updateLine(idx, 'supplierBatchNo', e.target.value)}
                        className="h-9 font-mono font-semibold text-sm" />
                      <Input
                        type="date"
                        value={line.slaughterDate}
                        onChange={e => {
                          const slaughter = e.target.value
                          // Termin liczy się od uboju — przesunięcie daty uboju
                          // bez przesunięcia ważności dawało partie „ważne"
                          // dłużej, niż pozwala surowiec.
                          const exp = slaughter
                            ? (() => { const d = new Date(slaughter); d.setDate(d.getDate() + 7); return d.toISOString().slice(0, 10) })()
                            : line.expiryDate
                          setLines(p => p.map((l, i) =>
                            i === idx ? { ...l, slaughterDate: slaughter, expiryDate: exp } : l))
                        }}
                        className="h-9 text-xs" />
                      <Input
                        type="date"
                        value={line.expiryDate}
                        onChange={e => updateLine(idx, 'expiryDate', e.target.value)}
                        className="h-9 text-xs" />
                      {groupCount > 1 && (
                        <div className="flex gap-1">
                          {Array.from({ length: groupCount }, (_, g) => (
                            <button key={g}
                              onClick={() => updateLine(idx, 'group', g)}
                              className={`h-9 min-w-10 px-2 rounded-md text-xs font-bold border transition-colors tabular-nums ${
                                line.group === g
                                  ? 'bg-primary text-white border-primary'
                                  : 'bg-white text-ink-2 border-surface-4 hover:border-primary/50'
                              }`}>
                              {batchNos[g]}
                            </button>
                          ))}
                        </div>
                      )}
                      <Button
                        variant="ghost" size="icon"
                        onClick={() => removeLine(idx)}
                        disabled={lines.length <= 1}
                        className="h-9 w-9 text-muted-foreground hover:text-destructive hover:bg-destructive/10">
                        <X size={13} />
                      </Button>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Podział na numery porządkowe */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Label className="text-sm font-semibold">Numery porządkowe</Label>
                <Badge variant="secondary">{groupCount}</Badge>
              </div>
              <Button variant="outline" size="sm" onClick={addGroup}>
                <Plus size={13} className="mr-1.5" /> Rozbij na kolejny numer
              </Button>
            </div>

            <div className="grid gap-2">
              {groups.map(g => {
                const auto = containersForKg(g.kg, header.containerKg ?? null)
                return (
                  <Card key={g.index} className={g.kg > 0 ? '' : 'border-destructive/40 bg-destructive/5'}>
                    <CardContent className="p-3 flex items-center gap-4">
                      <div className="w-20 shrink-0">
                        <CardDescription className="text-[10px] font-bold uppercase">Nr porz.</CardDescription>
                        <CardTitle className="text-lg font-black font-mono text-primary tabular-nums">
                          {g.batchNo}
                        </CardTitle>
                      </div>
                      <div className="w-28 shrink-0">
                        <CardDescription className="text-[10px] font-bold uppercase">Waga</CardDescription>
                        <CardTitle className="text-lg font-black tabular-nums">{fmtKg(g.kg, 1)} kg</CardTitle>
                      </div>
                      <div className="w-28 shrink-0">
                        <CardDescription className="text-[10px] font-bold uppercase">Pojemniki</CardDescription>
                        <Input
                          type="number" min="0" step="1"
                          placeholder={auto !== null ? String(auto) : 'wpisz'}
                          value={containerOverride[g.index] ?? (auto ?? '')}
                          onChange={e => setContainerOverride(prev => ({
                            ...prev,
                            [g.index]: e.target.value === '' ? null : parseInt(e.target.value) || 0,
                          }))}
                          className="h-8 text-center font-black tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <CardDescription className="text-[10px] font-bold uppercase">Partie dostawcy</CardDescription>
                        <div className="font-mono text-xs truncate">
                          {g.supplierNos.join(', ') || <span className="text-muted-foreground">—</span>}
                        </div>
                      </div>
                      {groupCount > 1 && (
                        <Button variant="ghost" size="icon" onClick={() => removeGroup(g.index)}
                          className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10">
                          <X size={13} />
                        </Button>
                      )}
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          </div>

          <Separator />

          {/* Dane wspólne dostawy */}
          <div className="grid grid-cols-4 gap-3">
            <Card className="border-primary/20 bg-primary/5">
              <CardContent className="p-3 text-center">
                <Package size={15} className="text-primary mx-auto mb-1" />
                <CardTitle className="text-2xl font-black text-primary tabular-nums">
                  {fmtKg(totalKg, 1)}
                </CardTitle>
                <CardDescription className="text-[10px] uppercase font-bold">kg w dostawie</CardDescription>
              </CardContent>
            </Card>

            <div className="space-y-1.5">
              <Label>Kaliber pojemnika</Label>
              <Select
                value={caliber}
                onValueChange={(v: CaliberValue) => {
                  onHeaderChange('containerKg', caliberKg(v))
                  // Zmiana kalibru unieważnia ręczne liczby — przy
                  // niekalibrowanym operator wpisuje je od nowa.
                  setContainerOverride({})
                }}>
                <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CALIBER_OPTIONS.map(o => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Cena / kg (zł){isService && <span className="font-normal text-muted-foreground"> — mięso klienta</span>}</Label>
              <Input
                type="number" placeholder="0.00" step="0.01" min="0"
                value={header.pricePerKg || ''}
                onChange={e => onHeaderChange('pricePerKg', parseFloat(e.target.value) || 0)}
                className="h-11 text-lg font-black [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
            </div>

            <Card className="border-green-200 bg-green-50">
              <CardContent className="p-3 text-center">
                <CardTitle className="text-lg font-black text-green-700 tabular-nums">
                  {fmtPln(value)}
                </CardTitle>
                <CardDescription className="text-[10px] uppercase font-bold text-green-600">wartość</CardDescription>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-4 gap-4">
            <div className="space-y-1.5">
              <Label>Nr HDI</Label>
              <Input
                type="text" placeholder="np. 33656"
                value={header.hdiNo}
                onChange={e => onHeaderChange('hdiNo', e.target.value)}
                className="font-mono" />
            </div>
            <div className="space-y-1.5">
              <Label>Nr WZ / faktury dostawcy</Label>
              <Input
                type="text" placeholder="np. WZ 388/MDU/08/2026"
                value={header.documentNo}
                onChange={e => onHeaderChange('documentNo', e.target.value)} />
            </div>
            {/* „Ilość palet" ze stopki HDI. Palety liczone ręcznie — system
                nie ma skąd ich znać, a wchodzą na saldo nośników dostawcy. */}
            <div className="space-y-1.5">
              <Label>Palety H1 (z HDI)</Label>
              <Input
                type="number" min="0" step="1"
                value={header.palletsH1 ?? 0}
                onChange={e => onHeaderChange('palletsH1', parseInt(e.target.value) || 0)}
                className="tabular-nums" />
            </div>
            {/* Inne opakowania: rodzaj z listy ma WŁASNE saldo — siatki E1
                nie zwraca się europaletą, więc nie wolno ich sumować. */}
            <div className="space-y-1.5">
              <Label>Inne opakowania / palety</Label>
              <div className="flex gap-1.5">
                <Select
                  value={header.palletsOtherKind || 'net_e1'}
                  onValueChange={v => onHeaderChange('palletsOtherKind', v)}>
                  <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {OTHER_CARRIER_KINDS.map(k => (
                      <SelectItem key={k.value} value={k.value}>{k.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  type="number" min="0" step="1"
                  value={header.palletsOther ?? 0}
                  onChange={e => onHeaderChange('palletsOther', parseInt(e.target.value) || 0)}
                  className="w-20 tabular-nums" />
              </div>
            </div>
          </div>

          {/* Kontrola ze stopki HDI — „Ilość pojemników: 600, Masa netto: 9 000,00".
              Porównanie z sumą wpisanych pozycji łapie najczęstszy błąd
              przepisywania: linię pominiętą albo wpisaną dwa razy. */}
          <Card className={hdiCheck.ok ? 'border-surface-4' : 'border-amber-300 bg-amber-50'}>
            <CardContent className="p-3 flex items-end gap-4 flex-wrap">
              <div className="space-y-1.5 w-40">
                <Label className="text-[11px]">Masa netto z HDI</Label>
                <Input
                  type="text" inputMode="decimal" placeholder="9 000,00"
                  value={header.docKg || ''}
                  onChange={e => onHeaderChange('docKg', parseKg(e.target.value))}
                  className="h-9 text-right tabular-nums" />
              </div>
              <div className="space-y-1.5 w-36">
                <Label className="text-[11px]">Ilość pojemników z HDI</Label>
                <Input
                  type="number" min="0" step="1" placeholder="600"
                  value={header.docContainers || ''}
                  onChange={e => onHeaderChange('docContainers', parseInt(e.target.value) || 0)}
                  className="h-9 text-right tabular-nums" />
              </div>
              <div className="flex-1 min-w-[220px] text-xs leading-snug">
                {header.docKg <= 0 && header.docContainers <= 0 ? (
                  <CardDescription className="text-[11px]">
                    Nieobowiązkowe. Wpisane sumy z dokumentu są porównywane
                    z tym, co wprowadzono — od razu widać pominiętą pozycję.
                  </CardDescription>
                ) : hdiCheck.ok ? (
                  <span className="font-semibold text-green-700">
                    Zgodne z HDI: {fmtKg(totalKg, 1)} kg
                    {header.docContainers > 0 && `, ${header.docContainers} poj.`}
                  </span>
                ) : (
                  <span className="font-semibold text-amber-800">
                    {hdiCheck.kgDiff !== 0 && (
                      <span className="block">
                        Wpisano {fmtKg(totalKg, 1)} kg, HDI mówi {fmtKg(header.docKg, 1)} kg
                        {' '}(różnica {hdiCheck.kgDiff > 0 ? '+' : ''}{fmtKg(hdiCheck.kgDiff, 1)} kg)
                      </span>
                    )}
                    {hdiCheck.containersDiff !== 0 && (
                      <span className="block">
                        Pojemniki: {hdiCheck.containersDiff > 0 ? '+' : ''}{hdiCheck.containersDiff}
                        {' '}wobec HDI — sprawdź kaliber albo przeliczenie stosu
                      </span>
                    )}
                  </span>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Zastrzeżenia podziału */}
          {(issues.errors.length > 0 || issues.warnings.length > 0) && (
            <div className="space-y-2">
              {issues.errors.map((m, i) => (
                <Card key={`e${i}`} className="border-destructive/50 bg-destructive/5">
                  <CardContent className="px-3 py-2 flex items-start gap-2">
                    <AlertTriangle size={13} className="text-destructive flex-shrink-0 mt-0.5" />
                    <CardDescription className="text-destructive font-medium">{m}</CardDescription>
                  </CardContent>
                </Card>
              ))}
              {issues.warnings.map((m, i) => (
                <Card key={`w${i}`} className="border-amber-200 bg-amber-50">
                  <CardContent className="px-3 py-2 flex items-start gap-2">
                    <AlertTriangle size={13} className="text-amber-600 flex-shrink-0 mt-0.5" />
                    <CardDescription className="text-amber-700">{m}</CardDescription>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {error && (
            <Card className="border-destructive/50 bg-destructive/5">
              <CardContent className="px-4 py-2">
                <CardDescription className="text-destructive font-medium">{error}</CardDescription>
              </CardContent>
            </Card>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={loading}>Anuluj</Button>
          <Button
            onClick={() => onSubmit(groups)}
            disabled={!header.supplierId || totalKg <= 0 || issues.errors.length > 0}
            className="gap-2">
            {loading
              ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              : <Plus size={15} />}
            Przyjmij dostawę ({fmtKg(totalKg, 0)} kg
            {groupCount > 1
              ? ` → nr ${batchNos.join(', ')}`
              : `, nr ${batchNos[0] || '—'}`})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
