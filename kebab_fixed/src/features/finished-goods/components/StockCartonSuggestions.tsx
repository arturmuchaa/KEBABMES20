/**
 * Sekcja „Kartony z magazynu" na widoku zamówienia.
 *
 * Przegląd z serwera (stock-carton-options) w trzech listach:
 *  - przypisane do tego zamówienia — fizyczne powiązanie kartonu z zamówieniem
 *    (osobne od pokrycia magazynem w qtyDone; tych liczb NIE dodajemy do qtyDone),
 *  - dostępne — biuro przypisuje je jawnym przyciskiem, jeden po drugim,
 *  - niedostępne — z powodem podanym przez serwer.
 *
 * Sekcja jest ZAWSZE widoczna — także w trakcie ładowania, przy pustym wyniku
 * i przy błędzie pobierania. Błąd pobrania (GET), przypisania i odłączenia są
 * pokazywane osobno; błąd pobrania ukrywa listy, żeby nieaktualne dane nie
 * pozwalały przypisać kartonu na ślepo. Zamówienie zamknięte (zrealizowane,
 * anulowane) pokazuje historycznie przypisane kartony, bez żadnych akcji.
 */
import { useRef, useState, type ReactNode } from 'react'
import { useApi } from '@/hooks/useApi'
import { clientOrdersApi, type StockCartonOption, type StockCartonOptions } from '@/lib/api'
import { formatCartonNo } from '@/lib/unitLocation'
import { PackageCheck, Loader2, RefreshCw, Unlink, Ban } from 'lucide-react'

interface Props {
  orderId: string
  /** Status zamówienia; „done" i „cancelled" blokują przypisywanie i odłączanie. */
  orderStatus?: string
  /** Wołane raz po udanym przypisaniu/odłączeniu (np. odświeżenie listy zamówień). */
  onAssigned?: () => void | Promise<void>
}

type Pending = { kind: 'assign' | 'detach'; cartonId: string }

const label = (c: StockCartonOption) => formatCartonNo(c.cartonNo) || '—'

const isClosed = (s?: string) => s === 'done' || s === 'cancelled'

export function StockCartonSuggestions({ orderId, orderStatus, onAssigned }: Props) {
  const { data, loading, error, refetch } = useApi<StockCartonOptions>(
    () => clientOrdersApi.stockCartonOptions(orderId),
    [orderId],
  )
  // Status z serwera wygrywa, gdy lista zamówień u rodzica jest jeszcze nieaktualna.
  const closedStatus = isClosed(data?.orderStatus) ? data!.orderStatus : isClosed(orderStatus) ? orderStatus : null
  const closed = closedStatus !== null
  // Ref blokuje szybki podwójny klik zanim React zdąży przerysować przyciski.
  const pendingRef = useRef(false)
  const [pending, setPending] = useState<Pending | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [confirmDetachId, setConfirmDetachId] = useState<string | null>(null)

  const busy = pending !== null || refreshing
  const blockedReason = closed
    ? `Zamówienie jest zamknięte (${closedStatus === 'done' ? 'zrealizowane' : 'anulowane'}) — przypisywanie i odłączanie kartonów jest niedostępne.`
    : data?.assignBlockedReason ?? null
  const canAssign = !closed && !blockedReason
  // Odłączanie blokuje tylko zamknięcie zamówienia; resztę rozstrzyga serwer per karton (canDetach).
  const canDetachAny = !closed

  async function reload() {
    setRefreshing(true)
    try { await refetch() } finally { setRefreshing(false) }
  }

  async function afterMutation() {
    // Przegląd i lista zamówień odświeżają się równolegle. Błąd rodzica nie jest
    // błędem przypisania i nie może zostać nieobsłużony; błąd odświeżenia przeglądu
    // pokaże się jako błąd pobierania — nie jako błąd przypisania.
    await Promise.all([
      refetch(),
      Promise.resolve().then(() => onAssigned?.()).catch(() => { /* lista zamówień odświeży się przy następnym razie */ }),
    ])
  }

  async function mutate(kind: Pending['kind'], c: StockCartonOption) {
    if (pendingRef.current || closed) return
    if (kind === 'assign' && !canAssign) return
    if (kind === 'detach' && !c.canDetach) return
    pendingRef.current = true
    setPending({ kind, cartonId: c.cartonId }); setActionError(null); setSuccess(null)
    try {
      try {
        if (kind === 'assign') await clientOrdersApi.assignStockCarton(orderId, c.cartonId)
        else await clientOrdersApi.detachStockCarton(orderId, c.cartonId)
      } catch (e: any) {
        const what = kind === 'assign' ? 'przypisać' : 'odłączyć'
        setActionError(`Nie udało się ${what} kartonu ${label(c)}: ${e?.message || 'nieznany błąd'}`)
        return
      }
      setConfirmDetachId(null)
      setSuccess(kind === 'assign'
        ? `Przypisano karton ${label(c)} (${c.units} szt.) do tego zamówienia. ` + (c.scannerless
          ? 'Karton bez zeskanowanych sztuk — nie skanuj go na aucie; towar zejdzie z magazynu na dokumencie zamówienia.'
          : 'Dodaj zamówienie do auta i skanuj dotychczasową etykietę kartonu.')
        : `Odłączono karton ${label(c)} od tego zamówienia. Karton i towar zostają na magazynie.`)
      await afterMutation()
    } finally {
      pendingRef.current = false
      setPending(null)
    }
  }

  const spinner = (kind: Pending['kind'], c: StockCartonOption) =>
    pending?.kind === kind && pending.cartonId === c.cartonId

  let body: ReactNode
  if (loading) {
    body = (
      <div role="status" className="flex items-center gap-1.5 text-sm text-slate-600">
        <Loader2 size={14} className="animate-spin" /> Szukam kartonów z magazynu…
      </div>
    )
  } else if (error || !data) {
    body = (
      <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
        <div className="font-semibold">Nie udało się pobrać listy kartonów z magazynu: {error || 'brak danych'}</div>
        <div className="mt-0.5 text-xs">Lista jest ukryta, dopóki nie uda się jej pobrać ponownie.</div>
        <button
          type="button"
          onClick={reload}
          disabled={busy}
          className="mt-2 inline-flex items-center gap-1.5 rounded border border-red-300 bg-white px-3 py-1 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50"
        >
          {refreshing ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
          Spróbuj ponownie
        </button>
      </div>
    )
  } else {
    const { available, assigned, unavailable, assignedTotals } = data
    body = (
      <div className="space-y-3">
        {blockedReason && (
          <div data-testid="assign-blocked" className="flex items-start gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">
            <Ban size={14} className="mt-0.5 shrink-0" /> {blockedReason}
          </div>
        )}

        <section aria-label="Przypisane kartony">
          <div className="mb-1 text-sm font-bold text-emerald-900" data-testid="assigned-totals">
            Przypisano: {assignedTotals.cartons} {cartonsWord(assignedTotals.cartons)} / {assignedTotals.units} szt.
          </div>
          {assigned.length === 0 ? (
            <p className="text-xs text-slate-600">Do tego zamówienia nie przypisano jeszcze żadnego kartonu z magazynu.</p>
          ) : (
            <ul className="space-y-1.5">
              {assigned.map(c => (
                <li key={c.cartonId} className="rounded-md border border-emerald-300 bg-white px-3 py-2">
                  <div className="flex items-start gap-3">
                    <CartonInfo c={c} />
                    {canDetachAny && c.canDetach && confirmDetachId !== c.cartonId && (
                      <button
                        type="button"
                        onClick={() => { setConfirmDetachId(c.cartonId); setActionError(null) }}
                        disabled={busy}
                        className="ml-auto mt-0.5 inline-flex shrink-0 items-center gap-1.5 rounded border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                      >
                        <Unlink size={13} /> Odłącz od zamówienia
                      </button>
                    )}
                  </div>
                  {canDetachAny && !c.canDetach && c.detachBlockedReason && (
                    <div className="mt-1 text-[11px] font-semibold text-slate-500">Nie można odłączyć: {c.detachBlockedReason}</div>
                  )}
                  {canDetachAny && c.canDetach && confirmDetachId === c.cartonId && (
                    <div role="group" aria-label="Potwierdzenie odłączenia" className="mt-2 rounded border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
                      <div className="font-semibold">
                        Odłączyć karton {label(c)} od tego zamówienia? Karton i towar zostają na magazynie — znika tylko powiązanie z zamówieniem.
                      </div>
                      <div className="mt-1.5 flex gap-2">
                        <button
                          type="button"
                          onClick={() => mutate('detach', c)}
                          disabled={busy}
                          className="inline-flex items-center gap-1.5 rounded bg-amber-600 px-3 py-1 font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
                        >
                          {spinner('detach', c) ? <Loader2 size={13} className="animate-spin" /> : <Unlink size={13} />}
                          Tak, odłącz
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDetachId(null)}
                          disabled={busy}
                          className="rounded border border-slate-300 bg-white px-3 py-1 font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                        >
                          Anuluj
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        {!closed && (
          <section aria-label="Dostępne kartony">
            <div className="mb-1 text-xs font-bold uppercase tracking-wide text-emerald-700">Dostępne do przypisania ({available.length})</div>
            {available.length === 0 ? (
              <div className="space-y-1 text-xs text-slate-600">
                <p className="text-sm font-semibold text-slate-700">System nie znalazł pasujących, nieprzypisanych kartonów z magazynu dla tego zamówienia.</p>
                <p className="font-semibold text-emerald-800">To nie oznacza, że towaru nie ma na magazynie.</p>
                <p>
                  Karton jest proponowany tylko wtedy, gdy zgadzają się receptura, rodzaj, tuleja i waga sztuki (a klient — jeśli karton go ma),
                  a karton nie jest już powiązany z innym zamówieniem.
                </p>
              </div>
            ) : (
              <>
                {canAssign && (
                  <p className="mb-1.5 text-xs text-slate-600">
                    Przypisanie zachowuje etykietę i partie kartonu. Potem dodaj zamówienie do auta i skanuj dotychczasową etykietę kartonu —
                    dla tych kartonów nie twórz dodatkowych palet ani nowych kartonów.
                  </p>
                )}
                <ul className="space-y-1.5">
                  {available.map(c => (
                    <li key={c.cartonId} className="flex items-start gap-3 rounded-md border border-emerald-200 bg-white px-3 py-2">
                      <CartonInfo c={c} />
                      {canAssign && (
                        <button
                          type="button"
                          onClick={() => mutate('assign', c)}
                          disabled={busy}
                          className="ml-auto mt-0.5 inline-flex shrink-0 items-center gap-1.5 rounded bg-emerald-600 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                        >
                          {spinner('assign', c) ? <Loader2 size={13} className="animate-spin" /> : <PackageCheck size={13} />}
                          Przypisz do tego zamówienia
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        )}

        {!closed && unavailable.length > 0 && (
          <details className="rounded-md border border-slate-200 bg-white px-3 py-2">
            <summary className="cursor-pointer text-xs font-bold text-slate-600">
              Kartony niedostępne dla tego zamówienia ({unavailable.length})
            </summary>
            <ul className="mt-1.5 space-y-1">
              {unavailable.map(c => (
                <li key={c.cartonId} className="text-xs text-slate-600">
                  <span className="font-mono font-bold text-slate-800">Karton {label(c)}</span>
                  {' — '}{c.reason || 'powód nieznany'}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    )
  }

  return (
    <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50/60 p-3">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-emerald-700">
        <PackageCheck size={14} /> Kartony z magazynu
        {!loading && !error && (
          <button
            type="button"
            onClick={reload}
            disabled={busy}
            className="ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold normal-case tracking-normal text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
          >
            <RefreshCw size={12} className={refreshing ? 'animate-spin' : undefined} /> Odśwież
          </button>
        )}
      </div>
      {success && (
        <div role="status" className="mb-2 rounded-md border border-emerald-300 bg-white px-3 py-2 text-sm font-semibold text-emerald-800">
          {success}
        </div>
      )}
      {actionError && (
        <div role="alert" className="mb-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
          {actionError}
        </div>
      )}
      {body}
    </div>
  )
}

function cartonsWord(n: number) {
  if (n === 1) return 'karton'
  const d = n % 10, dd = n % 100
  return d >= 2 && d <= 4 && (dd < 12 || dd > 14) ? 'kartony' : 'kartonów'
}

const STATUS_LABEL: Record<string, string> = {
  open: 'otwarty', packing: 'w pakowaniu', packed: 'spakowany', closed: 'spakowany',
}

function CartonInfo({ c }: { c: StockCartonOption }) {
  const flags = [
    c.scannerless ? 'spakowany bez skanera (towar na stanie)' : STATUS_LABEL[c.status] ?? c.status,
    c.inColdStorage ? 'w chłodni' : '',
    c.loaded ? 'załadowany' : '',
    c.shipped ? 'wydany' : '',
  ].filter(Boolean)
  return (
    <div className="min-w-0 flex-1 text-xs text-slate-600">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-mono text-sm font-black text-emerald-900">Karton {label(c)}</span>
        <span className="font-semibold text-slate-800">{c.units} szt.</span>
        <span className={c.generic ? 'font-semibold text-amber-700' : 'text-slate-500'}>
          {c.generic ? 'Na magazyn — bez klienta' : c.clientName || '—'}
        </span>
      </div>
      {c.lines.length > 0 && (
        <ul className="mt-0.5 space-y-0.5">
          {c.lines.map((l, i) => (
            <li key={i} className="tabular-nums">
              <span className="font-semibold text-slate-700">{l.packedQty}× {l.kgPerUnit} kg</span>
              {' · '}{l.productTypeName || l.recipeName}{l.packagingName ? ` · ${l.packagingName}` : ''}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-0.5 text-[11px] text-slate-500">
        {c.batches.length > 0 ? `Partia: ${c.batches.join(', ')}`
          : c.scannerless ? 'Partia: z magazynu na dokumencie' : 'Partia: —'}
        {flags.length > 0 && ` · ${flags.join(' · ')}`}
      </div>
    </div>
  )
}
