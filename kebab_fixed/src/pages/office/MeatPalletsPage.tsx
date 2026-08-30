/**
 * MeatPalletsPage — palety ważenia zbiorczego i ich korekta z biura.
 *
 * POWÓD ISTNIENIA: 24.08.2026 cztery palety trzeba było poprawić ręcznie
 * w bazie produkcyjnej — trzy razy zła partia (ekran hali podpowiadał
 * najstarszy lot z puli), raz brak liczby pojemników (218 kg zamiast 200,
 * bo tara E2 nie została odjęta). Backend miał wyłącznie tworzenie i odczyt,
 * więc pomyłka na dokumencie identyfikowalności wymagała dostępu do bazy.
 *
 * Po korekcie etykietę trzeba PRZEDRUKOWAĆ z hali („Zważone dziś") — na
 * palecie leży kartka z poprzednimi danymi i to ona jedzie na masownię.
 */
import { useCallback, useMemo, useState } from 'react'
import { useApi } from '@/hooks/useApi'
import { meatPalletsApi, type MeatPallet } from '@/lib/api'
import { fmtKgTrim, todayIso } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardTitle } from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Pencil, Plus, Trash2, AlertTriangle, Printer } from 'lucide-react'
import { toast } from 'sonner'
import { correctionIssues, type CorrectionLot } from '@/features/deboning/palletCorrection'

interface Szkic {
  palletNo:   string
  kgNet:      string
  containers: string
  reason:     string
  lots:       { lotNo: string; kg: string }[]
}

const num = (v: string): number => {
  const n = parseFloat(String(v ?? '').replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}

const szkicZPalety = (p: MeatPallet): Szkic => ({
  palletNo:   p.palletNo,
  kgNet:      String(p.kgNet),
  containers: String(p.containers ?? 0),
  reason:     '',
  lots:       (p.lots ?? []).map(l => ({ lotNo: l.lotNo, kg: String(l.kg) })),
})

export function MeatPalletsPage() {
  const [dzien, setDzien] = useState(todayIso())
  const { data, loading, refetch } = useApi(() => meatPalletsApi.list(dzien), [dzien])
  const palety = useMemo(() => (data ?? []) as MeatPallet[], [data])

  const [szkic, setSzkic]   = useState<Szkic | null>(null)
  const [saving, setSaving] = useState(false)
  // Zdjęcie palety, a nie „poprawienie jej do zera": operator na hali dotyka
  // „Etykieta" przy pełnym wskazaniu wagi i zapisuje paletę, której nie ma.
  // Zmniejszona do 0,5 kg dalej pokazywała się masowni jako mięso do wzięcia.
  const [doUsuniecia, setDoUsuniecia] = useState<MeatPallet | null>(null)
  const [powodUsuniecia, setPowodUsuniecia] = useState('')
  const [usuwanie, setUsuwanie] = useState(false)

  const lotyDoWalidacji: CorrectionLot[] = useMemo(
    () => (szkic?.lots ?? []).map(l => ({ lotNo: l.lotNo.trim(), kg: num(l.kg) })),
    [szkic],
  )
  const bledy = useMemo(
    () => (szkic ? correctionIssues(num(szkic.kgNet), lotyDoWalidacji, szkic.reason) : []),
    [szkic, lotyDoWalidacji],
  )

  const zmienLot = (i: number, pole: 'lotNo' | 'kg', v: string) =>
    setSzkic(s => (s ? { ...s, lots: s.lots.map((l, j) => (j === i ? { ...l, [pole]: v } : l)) } : s))

  const zapisz = useCallback(async () => {
    if (!szkic || bledy.length > 0) return
    setSaving(true)
    try {
      await meatPalletsApi.correct(szkic.palletNo, {
        kgNet:      num(szkic.kgNet),
        containers: Math.max(0, Math.round(num(szkic.containers))),
        reason:     szkic.reason.trim(),
        lots:       lotyDoWalidacji,
      })
      toast.success(
        `Paleta ${szkic.palletNo} poprawiona — PRZEDRUKUJ etykietę na hali`,
        { duration: 8000 },
      )
      setSzkic(null)
      refetch()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Nie udało się poprawić palety')
    } finally {
      setSaving(false)
    }
  }, [szkic, bledy, lotyDoWalidacji, refetch])

  const usun = useCallback(async () => {
    if (!doUsuniecia || powodUsuniecia.trim().length < 3) return
    setUsuwanie(true)
    try {
      await meatPalletsApi.usun(doUsuniecia.palletNo, powodUsuniecia.trim())
      toast.success(`Paleta ${doUsuniecia.palletNo} zdjęta — masownia jej nie zobaczy`)
      setDoUsuniecia(null)
      setPowodUsuniecia('')
      refetch()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Nie udało się zdjąć palety')
    } finally {
      setUsuwanie(false)
    }
  }, [doUsuniecia, powodUsuniecia, refetch])

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-end justify-between gap-3">
        <div>
          <CardTitle className="text-base">Palety mięsa</CardTitle>
          <CardDescription className="mt-0.5">
            Ważenie zbiorcze z hali · korekta wagi, pojemników i składu partii
          </CardDescription>
        </div>
        <div>
          <Label className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
            Dzień produkcyjny
          </Label>
          <Input type="date" value={dzien} onChange={e => setDzien(e.target.value)}
            className="h-9 w-auto text-sm" />
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="text-xs uppercase tracking-wide">Nr palety</TableHead>
                <TableHead className="text-xs uppercase tracking-wide">Cel</TableHead>
                <TableHead className="text-xs uppercase tracking-wide text-right">Netto</TableHead>
                <TableHead className="text-xs uppercase tracking-wide text-right">Pojemniki</TableHead>
                <TableHead className="text-xs uppercase tracking-wide">Skład partii</TableHead>
                <TableHead className="text-xs uppercase tracking-wide">Operator</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {palety.map(p => {
                // Zero pojemników przy palecie liczonej w setkach to sygnał
                // dokładnie tej pomyłki, przez którą ten ekran powstał.
                const podejrzana = (p.containers ?? 0) === 0 && p.kgNet >= 100
                return (
                  <TableRow key={p.id} data-testid="paleta-wiersz">
                    <TableCell>
                      <code className="font-mono text-xs font-bold text-foreground">{p.palletNo}</code>
                    </TableCell>
                    <TableCell className="text-ink-3">{fmtKgTrim(p.targetKg)} kg</TableCell>
                    <TableCell className="text-right font-bold tabular-nums">
                      {fmtKgTrim(p.kgNet)} kg
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {podejrzana ? (
                        <span data-testid="paleta-bez-pojemnikow"
                          className="inline-flex items-center gap-1 font-bold text-amber-700"
                          title="Brak pojemników przy palecie — tara mogła nie zostać odjęta">
                          <AlertTriangle size={12} /> 0
                        </span>
                      ) : (p.containers ?? 0)}
                    </TableCell>
                    <TableCell className="font-mono text-[11.5px] text-ink-2">
                      {(p.lots ?? []).map(l => `${l.lotNo}: ${fmtKgTrim(l.kg)}`).join(' · ') || '—'}
                    </TableCell>
                    <TableCell className="text-ink-3">{p.operator || '—'}</TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="ghost" className="gap-1.5 text-xs"
                        onClick={() => setSzkic(szkicZPalety(p))}>
                        <Pencil size={13} /> Popraw
                      </Button>
                      <Button size="sm" variant="ghost" data-testid={`paleta-usun-${p.palletNo}`}
                        className="gap-1.5 text-xs text-red-700 hover:bg-red-50"
                        onClick={() => { setDoUsuniecia(p); setPowodUsuniecia('') }}>
                        <Trash2 size={13} /> Zdejmij
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })}
              {palety.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">
                    {loading ? 'Ładowanie…' : 'Brak palet w tym dniu.'}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={szkic !== null} onOpenChange={v => { if (!v) setSzkic(null) }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Korekta palety {szkic?.palletNo}</DialogTitle>
            <DialogDescription>
              Poprawiasz dokument identyfikowalności. Po zapisie etykieta na palecie
              jest nieaktualna — przedrukuj ją z hali („Zważone dziś").
            </DialogDescription>
          </DialogHeader>

          {szkic && (
            <div className="space-y-3">
              <div className="flex gap-3">
                <div className="flex-1">
                  <Label className="mb-1 block text-[10px] font-bold uppercase text-muted-foreground">
                    Waga netto [kg]
                  </Label>
                  <Input value={szkic.kgNet} inputMode="decimal"
                    onChange={e => setSzkic(s => (s ? { ...s, kgNet: e.target.value } : s))} />
                </div>
                <div className="w-32">
                  <Label className="mb-1 block text-[10px] font-bold uppercase text-muted-foreground">
                    Pojemniki
                  </Label>
                  <Input value={szkic.containers} inputMode="numeric"
                    onChange={e => setSzkic(s => (s ? { ...s, containers: e.target.value } : s))} />
                </div>
              </div>

              <div>
                <Label className="mb-1 block text-[10px] font-bold uppercase text-muted-foreground">
                  Skład partii
                </Label>
                <div className="space-y-1.5">
                  {szkic.lots.map((l, i) => (
                    <div key={i} className="flex items-center gap-2" data-testid="korekta-lot">
                      <Input className="w-32 font-mono" placeholder="nr partii" value={l.lotNo}
                        onChange={e => zmienLot(i, 'lotNo', e.target.value)} />
                      <Input className="w-28 tabular-nums" inputMode="decimal" placeholder="kg" value={l.kg}
                        onChange={e => zmienLot(i, 'kg', e.target.value)} />
                      <Button size="icon" variant="ghost" title="Usuń partię"
                        onClick={() => setSzkic(s => (s ? { ...s, lots: s.lots.filter((_, j) => j !== i) } : s))}>
                        <Trash2 size={14} />
                      </Button>
                    </div>
                  ))}
                  <Button size="sm" variant="outline" className="gap-1.5 text-xs"
                    onClick={() => setSzkic(s => (s ? { ...s, lots: [...s.lots, { lotNo: '', kg: '' }] } : s))}>
                    <Plus size={13} /> Dołóż partię
                  </Button>
                </div>
              </div>

              <div>
                <Label className="mb-1 block text-[10px] font-bold uppercase text-muted-foreground">
                  Powód korekty
                </Label>
                <Input value={szkic.reason} placeholder="np. operator nie wpisał pojemników"
                  onChange={e => setSzkic(s => (s ? { ...s, reason: e.target.value } : s))} />
              </div>

              {bledy.length > 0 && (
                <ul data-testid="korekta-bledy"
                  className="space-y-0.5 rounded-[3px] border border-destructive/30 bg-destructive/5 px-3 py-2 text-[12px] font-semibold text-destructive">
                  {bledy.map(b => <li key={b}>• {b}</li>)}
                </ul>
              )}
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setSzkic(null)} disabled={saving}>Anuluj</Button>
            <Button onClick={zapisz} disabled={saving || bledy.length > 0} className="gap-1.5">
              <Printer size={14} /> Zapisz i przedrukuj etykietę
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={doUsuniecia !== null} onOpenChange={v => { if (!v) setDoUsuniecia(null) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Zdjąć paletę {doUsuniecia?.palletNo}?</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-[3px] border border-surface-4 bg-surface-2 px-3 py-2 text-[12px]">
              <div className="font-bold tabular-nums">
                {doUsuniecia ? fmtKgTrim(doUsuniecia.kgNet) : '0'} kg
                {doUsuniecia?.operator ? ` · ${doUsuniecia.operator}` : ''}
              </div>
              <div className="font-mono text-[11.5px] text-ink-2 mt-0.5">
                {(doUsuniecia?.lots ?? []).map(l => `${l.lotNo}: ${fmtKgTrim(l.kg)}`).join(' · ') || '—'}
              </div>
            </div>
            <CardDescription className="text-[11.5px]">
              Paleta zniknie z listy i z widoku masowni, a jej kilogramy wrócą do puli
              partii jako mięso nieułożone. Ślad zostaje w bazie — kto i dlaczego ją zdjął.
              Stan magazynowy się nie zmienia: paleta go nigdy nie ruszała.
            </CardDescription>
            <div>
              <Label className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                Powód *
              </Label>
              <Input value={powodUsuniecia} autoFocus
                placeholder="np. operator kliknął etykietę przez pomyłkę"
                onChange={e => setPowodUsuniecia(e.target.value)} />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDoUsuniecia(null)} disabled={usuwanie}>
              Anuluj
            </Button>
            <Button variant="destructive" onClick={usun}
              disabled={usuwanie || powodUsuniecia.trim().length < 3} className="gap-1.5">
              <Trash2 size={14} /> Zdejmij paletę
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
