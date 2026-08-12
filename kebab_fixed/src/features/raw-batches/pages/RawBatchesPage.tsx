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
import { Plus, AlertTriangle, CheckCircle, Trash2 } from 'lucide-react'
import { useRawBatches, useCreateReception } from '../hooks/useRawBatches'
import { RawBatchesTable }    from '../components/RawBatchesTable'
import { CreateReceptionModal } from '../components/CreateReceptionModal'
import { EditRawBatchModal, type EditRawBatchFormData } from '../components/EditRawBatchModal'
import { splitDeliveries, liveSummary, pluralDostawy, type MeatStockMap } from '../deliveryView'
import { wzApi } from '@/lib/apiClient'
import { rawBatchesApi } from '../api'
import { fmtKg, fmtDatePl, fmtPln } from '@/lib/utils'
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

  // ── Edit state ─────────────────────────────────────────────────────────────
  const [editBatch,   setEditBatch]   = useState<RawBatch | null>(null)
  const [editLoading, setEditLoading] = useState(false)
  const [editError,   setEditError]   = useState<string | null>(null)

  const handleEditOpen = useCallback((batch: RawBatch) => {
    setEditBatch(batch)
    setEditError(null)
  }, [])

  const handleEditClose = useCallback(() => {
    setEditBatch(null)
    setEditError(null)
  }, [])

  const handleEditSubmit = useCallback(async (data: EditRawBatchFormData) => {
    if (!editBatch) return
    setEditLoading(true)
    setEditError(null)
    try {
      await rawBatchesApi.edit(editBatch.id, {
        supplierBatchNo: data.supplierBatchNo,
        slaughterDate:   data.slaughterDate,
        receivedDate:    data.receivedDate,
        expiryDate:      data.expiryDate,
        kgReceived:      data.kgReceived,
        pricePerKg:      data.pricePerKg,
        invoiceNo:       data.invoiceNo,
        notes:           data.notes,
      } as any)
      setEditBatch(null)
      refetch()
      toast.success(`Partia ${editBatch.internalBatchNo} zaktualizowana`)
    } catch (e) {
      setEditError(e instanceof Error ? e.message : 'Błąd zapisu')
    } finally {
      setEditLoading(false)
    }
  }, [editBatch, refetch])

  // ── Cancel (delete) state ──────────────────────────────────────────────────
  const [cancelBatch,   setCancelBatch]   = useState<RawBatch | null>(null)
  const [cancelLoading, setCancelLoading] = useState(false)

  const handleCancelOpen = useCallback((batch: RawBatch) => {
    setCancelBatch(batch)
  }, [])

  const handleCancelConfirm = useCallback(async () => {
    if (!cancelBatch) return
    setCancelLoading(true)
    try {
      await rawBatchesApi.cancel(cancelBatch.id, { reason: '' } as any)
      toast.success(`Partia ${cancelBatch.internalBatchNo} usunięta`)
      setCancelBatch(null)
      refetch()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Błąd usuwania')
    } finally {
      setCancelLoading(false)
    }
  }, [cancelBatch, refetch])

  const {
    header, updateHeader, open, openModal, closeModal,
    confirmOpen, cancelConfirm, pending, validationResult,
    suggestedReceptionNo, suggestedBatchNo,
    mutationLoading, mutationError, requestSubmit, confirmSubmit,
  } = useCreateReception(
    useCallback((receptionNo: string, batchNos: string[], kg: number) => {
      refetch()
      toast.success(
        `Przyjęcie ${receptionNo} — ${kg.toFixed(2).replace('.', ',')} kg` +
        ` (nr porządkowy: ${batchNos.join(', ')})`)
    }, [refetch]),
  )

  const warnings = validationResult?.ok ? validationResult.warnings : []
  const pendingKg = useMemo(
    () => pending.reduce((s, g) => s + g.kg, 0), [pending])

  // Rodzaj surowca wstrzykiwany do formularza przyjęcia (zmiana taba lub
  // otwarcie modala ustawia materialTypeId w dto)
  useEffect(() => {
    updateHeader('materialTypeId', matId)
    // Usługa dotyczy tylko mięsa z/s — przy innym surowcu tryb musi zgasnąć,
    // inaczej backend odrzuciłby zapis (400) mimo ukrytego przełącznika.
    if (matId !== 'mat-mieso-zs') updateHeader('isService', false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matId, open])

  const handleSubmit = useCallback(async (groups: Parameters<typeof requestSubmit>[0]) => {
    const err = await requestSubmit(groups)
    if (err) toast.error(err)
  }, [requestSubmit])

  const handleConfirm = useCallback(async () => {
    const err = await confirmSubmit()
    if (err) toast.error(err)
  }, [confirmSubmit])

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
        <Button onClick={openModal}>
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
      <CreateReceptionModal
        open={open}
        onClose={closeModal}
        onSubmit={handleSubmit}
        header={header}
        suggestedReceptionNo={suggestedReceptionNo}
        suggestedBatchNo={suggestedBatchNo}
        supplierOptions={supplierOptions}
        loading={mutationLoading}
        error={mutationError}
        onHeaderChange={updateHeader}
      />

      {/* Modal edycji */}
      <EditRawBatchModal
        open={editBatch !== null}
        batch={editBatch}
        loading={editLoading}
        error={editError}
        onClose={handleEditClose}
        onSubmit={handleEditSubmit}
      />

      {/* Dialog potwierdzenia usuniecia (cancel) */}
      <Dialog open={cancelBatch !== null} onOpenChange={v => { if (!v) setCancelBatch(null) }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Usuń przyjęcie</DialogTitle>
            <DialogDescription>
              Czy na pewno usunąć partię <code className="font-mono font-bold text-primary">{cancelBatch?.internalBatchNo}</code>?
              Ćwiartka jeszcze nie została wykorzystana, więc usunięcie jest bezpieczne.
              Dostawa zostanie oznaczona jako anulowana (zostaje w historii), a numer{' '}
              <strong>{cancelBatch?.internalBatchNo}</strong> wróci do puli — będzie można
              przyjąć pod nim ponownie.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setCancelBatch(null)} disabled={cancelLoading}>
              Anuluj
            </Button>
            <Button variant="destructive" onClick={handleCancelConfirm} disabled={cancelLoading} className="gap-2">
              {cancelLoading
                ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                : <Trash2 size={14} />
              }
              Usuń
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Krok 2 — potwierdzenie */}
      <Dialog open={confirmOpen} onOpenChange={v => { if (!v) cancelConfirm() }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Potwierdź przyjęcie dostawy</DialogTitle>
            <DialogDescription>
              Sprawdź podział dostawy przed zapisem w systemie.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <Card>
              <CardContent className="p-0 divide-y">
                <div className="flex items-center justify-between px-4 py-2.5">
                  <CardDescription>Numer przyjęcia</CardDescription>
                  <code className="font-mono font-bold text-primary">
                    {header.receptionNo || suggestedReceptionNo || '—'}
                  </code>
                </div>
                <div className="flex items-center justify-between px-4 py-2.5">
                  <CardDescription>Cała dostawa</CardDescription>
                  <CardTitle className="text-sm tabular-nums">{fmtKg(pendingKg)} kg</CardTitle>
                </div>
                {/* Podział na numery porządkowe — to jest właśnie ta decyzja,
                    której nie da się już cofnąć jednym kliknięciem po zapisie. */}
                {pending.map(g => (
                  <div key={g.index} className="flex items-center justify-between px-4 py-2.5">
                    <CardDescription>
                      Numer porządkowy {g.batchNo ?? `#${g.index + 1}`}
                      <span className="block font-mono text-[11px] text-ink-3">
                        {g.supplierNos.join(', ') || 'bez partii dostawcy'}
                      </span>
                    </CardDescription>
                    <div className="text-right">
                      <CardTitle className="text-sm tabular-nums">{fmtKg(g.kg)} kg</CardTitle>
                      <CardDescription className="text-[11px]">
                        do {fmtDatePl(g.expiryDate)}
                      </CardDescription>
                    </div>
                  </div>
                ))}
                <div className="flex items-center justify-between px-4 py-2.5">
                  <CardDescription>Wartość netto</CardDescription>
                  <CardTitle className="text-sm tabular-nums">
                    {fmtPln(pendingKg * header.pricePerKg)}
                  </CardTitle>
                </div>
              </CardContent>
            </Card>

            {/* Ostrzeżenia walidacji */}
            {warnings.length > 0 && (
              <div className="space-y-2">
                {warnings.map((w, i) => (
                  <Card key={i} className="border-amber-200 bg-amber-50">
                    <CardContent className="px-3 py-2 flex items-start gap-2">
                      <AlertTriangle size={13} className="text-amber-600 flex-shrink-0 mt-0.5" />
                      <CardDescription className="text-amber-700">{w.message}</CardDescription>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}

            <Card className="bg-muted/40 border-transparent">
              <CardContent className="px-3 py-2">
                <CardDescription className="text-xs">
                  Numery — przyjęcia i porządkowe — nadaje system przy zapisie;
                  powyższe to podpowiedzi. Gdy w tej samej chwili ktoś zarejestruje
                  dostawę z drugiego stanowiska, faktyczne numery mogą wyjść wyższe.
                </CardDescription>
              </CardContent>
            </Card>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={cancelConfirm} disabled={mutationLoading}>
              Anuluj
            </Button>
            <Button onClick={handleConfirm} disabled={mutationLoading} className="gap-2">
              {mutationLoading
                ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                : <CheckCircle size={14} />
              }
              Potwierdź
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  )
}
