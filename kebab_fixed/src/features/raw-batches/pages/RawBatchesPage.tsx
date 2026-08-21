/**
 * RawBatchesPage — shadcn/ui
 */
import { useState, useCallback, useMemo, useEffect } from 'react'
import { useApi } from '@/hooks/useApi'
import { rawBatchesApi as legacyRawBatchesApi } from '@/lib/apiClient'
import { Button } from '@/components/ui/button'
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Plus, Trash2 } from 'lucide-react'
import { useRawBatches, useCreateReception } from '../hooks/useRawBatches'
import { RawBatchesTable }    from '../components/RawBatchesTable'
import { podsumowanieAnulowania } from '../cancelSummary'
import { splitDeliveries, liveSummary, pluralDostawy, type MeatStockMap } from '../deliveryView'
import { wzApi, receptionsApi } from '@/lib/apiClient'
import { rawBatchesApi } from '../api'
import { fmtKg, fmtDatePl } from '@/lib/utils'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import type { RawBatch } from '@/types'

function mapExpiryToUi(expiry: { level: string; daysLeft: number } | null) {
  if (!expiry) return null
  const map: Record<string, { label: string; colorCls: string }> = {
    OK:       { label: 'OK',              colorCls: 'bg-green-100 text-green-700' },
    WARNING:  { label: 'Wkrótce',         colorCls: 'bg-amber-100 text-amber-700' },
    CRITICAL: { label: 'Krytyczne',       colorCls: 'bg-red-100 text-red-700' },
    EXPIRED:  { label: 'Przeterminowane', colorCls: 'bg-red-700 text-white' },
  }
  const ui = map[expiry.level] ?? { label: expiry.level, colorCls: 'bg-gray-200' }
  return { level: expiry.level, ...ui }
}

export function RawBatchesPage() {
  const navigate = useNavigate()
  const { batches, supplierOptions, loading, refetch } = useRawBatches()

  // ── Rodzaje surowca (ćwiartka / filet / indyk…) — przełącznik ──────────────
  const { data: materialTypes } = useApi(() => (legacyRawBatchesApi as any).materialTypes())
  // Przyjmuje się TYLKO surowce receivable=true (od 2026-07 także „Mięso z/s"
  // z dostaw zewnętrznych — ścieżką "bez rozbioru" wprost do magazynu mięsa).
  const matList: { id: string; name: string; requiresDeboning: boolean }[] =
    ((materialTypes as any) ?? [{ id: 'mat-cwiartka', name: 'Ćwiartka z kurczaka', requiresDeboning: true, receivable: true }])
      .filter((m: any) => m.receivable !== false)
  const [matId, setMatId] = useState('mat-cwiartka')
  const selMat = matList.find(m => m.id === matId) ?? matList[0]

  // Lista filtrowana po wybranym rodzaju (stare partie bez rodzaju = ćwiartka)
  const matBatches = useMemo(
    () => batches.filter((b: any) => (b.materialTypeId || 'mat-cwiartka') === matId),
    [batches, matId],
  )

  // Żywy stan magazynu mięsa — jedyne miejsce, gdzie widać, ile zostało
  // z dostawy przyjętej BEZ rozbioru (filet, mięso z/s). Backend zeruje
  // kg_available takiej partii już przy przyjęciu i przerzuca całość do
  // meat_stock pod tym samym numerem, więc bez tego świeży filet wyglądałby
  // na zużyty. To samo źródło co picker WZ i Magazyn surowca.
  const { data: stockData } = useApi(() => (wzApi as any).stockRaw())
  const meatStock = useMemo(() => {
    const map: MeatStockMap = {}
    for (const r of ((stockData as any[]) ?? [])) {
      if (r?.stock_type !== 'meat') continue
      const no = String(r.internal_batch_no ?? '')
      if (!no) continue
      // Jedna partia może mieć kilka lotów (rozbiór na sesje) — sumujemy,
      // bo pytanie brzmi „ile z tej dostawy jeszcze leży".
      const prev = map[no]
      const kgAvailable = Number(r.kg_available ?? 0)
      const kgReserved  = Number(r.kg_reserved ?? 0)
      const kgInitial   = Number(r.kg_initial ?? r.kg_available ?? 0)
      map[no] = prev
        ? { kgAvailable: prev.kgAvailable + kgAvailable,
            kgReserved:  prev.kgReserved  + kgReserved,
            kgInitial:   prev.kgInitial   + kgInitial }
        : { kgAvailable, kgReserved, kgInitial }
    }
    return map
  }, [stockData])

  // Dwie perspektywy tej samej listy: co jeszcze leży w chłodni (W obiegu)
  // i co już rozliczone (Historia). Alarmy terminów żyją tylko w pierwszej.
  const resolveOpts = useMemo(
    () => ({ requiresDeboning: selMat?.requiresDeboning ?? true, meatStock }),
    [selMat?.requiresDeboning, meatStock],
  )
  const { live, history } = useMemo(
    () => splitDeliveries(matBatches, resolveOpts), [matBatches, resolveOpts])
  const summary = useMemo(() => liveSummary(live, resolveOpts), [live, resolveOpts])

  // ── Edycja dostawy — pełny formularz na osobnej stronie ───────────────────
  const handleEditOpen = useCallback((batch: RawBatch) => {
    // Edycja to teraz PEŁNY formularz dokumentu dostawy, nie modal na kilka
    // pól — poprawianie wagi czy rodzaju surowca nie wymaga już anulowania
    // dostawy i wpisywania jej od nowa.
    if (batch.receptionId) navigate(`/office/raw-batches/${batch.receptionId}/edycja`)
  }, [navigate])

  // ── Zawieszki na palety — przedruk po rejestracji dostawy ────────────────
  const handlePrintTags = useCallback((batch: RawBatch) => {
    if (batch.receptionId) navigate(`/office/raw-batches/${batch.receptionId}/zawieszki`)
  }, [navigate])

  // ── Cancel (delete) state ──────────────────────────────────────────────────
  const [cancelBatch,   setCancelBatch]   = useState<RawBatch | null>(null)
  const [cancelLoading, setCancelLoading] = useState(false)

  // Pozostałe numery porządkowe z TEGO SAMEGO dokumentu dostawy. Jedna dostawa
  // bywa rozpisana na kilka numerów i wycofanie pojedynczego numeru zostawiłoby
  // resztę dokumentu w systemie.
  const sameReception = useMemo(
    () => (cancelBatch?.receptionId
      ? batches.filter((b: RawBatch) =>
          b.receptionId === cancelBatch.receptionId && b.status !== 'cancelled')
      : []),
    [batches, cancelBatch],
  )

  const handleCancelOpen = useCallback((batch: RawBatch) => {
    setCancelBatch(batch)
  }, [])

  const handleCancelReception = useCallback(async () => {
    if (!cancelBatch?.receptionId) return
    setCancelLoading(true)
    try {
      const out = await receptionsApi.cancel(cancelBatch.receptionId)
      toast.success(`Dostawa ${cancelBatch.receptionNo ?? ''} anulowana — ${out.cancelled} nr`)
      setCancelBatch(null)
      refetch()
    } catch (e) {
      // 409 z backendu niesie numer, który jest już ruszony — pokazujemy go
      // wprost, bo to jedyna informacja pozwalająca zrozumieć odmowę.
      toast.error(e instanceof Error ? e.message : 'Błąd anulowania dostawy')
    } finally {
      setCancelLoading(false)
    }
  }, [cancelBatch, refetch])

  const handleCancelConfirm = useCallback(async () => {
    if (!cancelBatch) return
    setCancelLoading(true)
    try {
      await rawBatchesApi.cancel(cancelBatch.id, { reason: '' } as any)
      toast.success(`Partia ${cancelBatch.internalBatchNo} anulowana`)
      setCancelBatch(null)
      refetch()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Błąd usuwania')
    } finally {
      setCancelLoading(false)
    }
  }, [cancelBatch, refetch])

  // Rejestracja dostawy ma własną stronę (ReceptionFormPage) — lista tylko
  // tam prowadzi i odświeża się po powrocie.

  return (
    <div className="space-y-5 animate-fade-in">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <CardTitle className="text-base">Przyjęcie surowca</CardTitle>
          <CardDescription className="mt-0.5">
            Dostawy w obiegu i zamknięta historia · pełny stan magazynowy jest w Magazynie surowca
          </CardDescription>
        </div>
        <Button onClick={() => navigate(`/office/raw-batches/nowe?rodzaj=${encodeURIComponent(matId)}`)}>
          <Plus size={15} className="mr-1.5" /> Przyjmij: {selMat?.name ?? 'partię'}
        </Button>
      </div>

      {/* Przełącznik rodzaju surowca */}
      <div className="flex gap-1.5 flex-wrap">
        {matList.map(m => (
          <button key={m.id}
            onClick={() => setMatId(m.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
              matId === m.id
                ? 'bg-primary text-white border-primary'
                : 'bg-white text-ink-2 border-surface-4 hover:border-primary/50'
            }`}>
            {m.name}
            {!m.requiresDeboning && (
              <span className={`ml-1.5 text-[9px] font-semibold uppercase ${matId === m.id ? 'text-white/70' : 'text-muted-foreground'}`}>
                bez rozbioru
              </span>
            )}
          </button>
        ))}
      </div>
      {selMat && !selMat.requiresDeboning && (
        <CardDescription className="text-xs -mt-2">
          Surowiec bez rozbioru — po przyjęciu od razu trafia na magazyn mięsa
          i jest dostępny do masowania pod numerem partii przyjęcia.
        </CardDescription>
      )}

      <Separator />

      {/* Sekcja 1 — dostawy z resztą surowca */}
      <div className="space-y-2">
        <div className="flex items-baseline justify-between gap-3">
          <CardTitle className="text-xs uppercase tracking-[0.08em] text-ink-2">W obiegu</CardTitle>
          <CardDescription className="text-xs tabular-nums">
            {summary.count} {pluralDostawy(summary.count)} · {fmtKg(summary.kg)} kg
          </CardDescription>
        </div>
        <Card>
          <CardContent className="p-0">
            <RawBatchesTable
              key={matId}
              batches={live}
              loading={loading}
              variant="live"
              requiresDeboning={selMat?.requiresDeboning ?? true}
              meatStock={meatStock}
              emptyTitle="Brak surowca w obiegu"
              emptyHint={`Wszystkie dostawy (${selMat?.name ?? 'surowiec'}) są rozliczone — historia poniżej.`}
              onEdit={handleEditOpen}
              onPrintTags={handlePrintTags}
              onCancel={handleCancelOpen}
              onScanAttached={refetch}
            />
          </CardContent>
        </Card>
      </div>

      {/* Sekcja 2 — zamknięta historia, bez alarmów terminów */}
      <div className="space-y-2">
        <div className="flex items-baseline justify-between gap-3">
          <CardTitle className="text-xs uppercase tracking-[0.08em] text-ink-2">Historia dostaw</CardTitle>
          <CardDescription className="text-xs tabular-nums">
            {history.length} {pluralDostawy(history.length)}
          </CardDescription>
        </div>
        <Card>
          <CardContent className="p-0">
            <RawBatchesTable
              key={matId}
              batches={history}
              loading={loading}
              variant="history"
              requiresDeboning={selMat?.requiresDeboning ?? true}
              meatStock={meatStock}
              emptyTitle="Brak zamkniętych dostaw"
              emptyHint="Rozliczone i anulowane przyjęcia pojawią się tutaj."
              onScanAttached={refetch}
            />
          </CardContent>
        </Card>
      </div>

      {/* Modal formularza */}

      {/* Dialog potwierdzenia usuniecia (cancel) */}
      <Dialog open={cancelBatch !== null} onOpenChange={v => { if (!v) setCancelBatch(null) }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Anuluj przyjęcie</DialogTitle>
            <DialogDescription>
              Sprawdź, czy to ta dostawa — po anulowaniu jej kilogramy znikną z magazynu.
            </DialogDescription>
          </DialogHeader>

          {/* Tożsamość partii. Sam numer nie wystarcza: na liście stoją obok
              siebie kolejne numery od różnych dostawców i 2026-08-19 operator
              anulował w ciemno nie tę dostawę, co chciał. */}
          {cancelBatch && (() => {
            const op = podsumowanieAnulowania(cancelBatch)
            return (
              <div className="rounded-lg border-2 border-destructive/30 bg-destructive/5 px-3 py-2.5">
                <div className="flex items-baseline gap-2">
                  <code className="font-mono text-lg font-bold text-destructive">{op.numer}</code>
                  <span className="text-sm font-semibold text-foreground">{op.surowiec}</span>
                </div>
                <div className="text-sm font-semibold text-foreground mt-0.5">{op.dostawca}</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {op.kg} · przyjęta {op.data}
                </div>
              </div>
            )
          })()}

          <DialogDescription>
            Surowiec nie został jeszcze wykorzystany, więc anulowanie jest bezpieczne.
            Dostawa zostaje w historii jako anulowana, a numer{' '}
            <strong>{cancelBatch?.internalBatchNo}</strong> wraca do puli — będzie można
            przyjąć pod nim ponownie.
            {sameReception.length > 1 && (
              <>
                {' '}Ten sam dokument <strong>{cancelBatch?.receptionNo}</strong> ma{' '}
                <strong>{sameReception.length} numerów</strong> — pozostałe zostaną,
                chyba że wycofasz całą dostawę.
              </>
            )}
          </DialogDescription>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setCancelBatch(null)} disabled={cancelLoading}>
              Nie, wróć
            </Button>
            {sameReception.length > 1 && (
              <Button variant="destructive" onClick={handleCancelReception} disabled={cancelLoading} className="gap-2">
                <Trash2 size={14} />
                Cała dostawa ({sameReception.length})
              </Button>
            )}
            <Button variant="destructive" onClick={handleCancelConfirm} disabled={cancelLoading} className="gap-2">
              {cancelLoading
                ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                : <Trash2 size={14} />
              }
              Anuluj {cancelBatch?.internalBatchNo}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Krok 2 — potwierdzenie */}

    </div>
  )
}
