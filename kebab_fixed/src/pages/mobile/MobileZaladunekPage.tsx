/**
 * Załadunek auta — panel skanera magazyniera.
 *
 * ŹRÓDŁEM PRAWDY JEST BAZA. Ten ekran nie pamięta o załadunku NICZEGO między
 * odświeżeniami i niczego sam nie dolicza: co widać, przyszło przed chwilą
 * z `GET /api/pallets/vehicle-state/{id}`.
 *
 * Co tu było do 20.09.2026: lista zamówień pojazdu i jej kolejność żyły
 * w `localStorage` TEGO urządzenia, a serwer dociągało się wyłącznie jako
 * SUMĘ — dopisywał brakujące, nigdy nic nie odejmował. Skutek na hali:
 * urządzenie A kończyło załadunek, a urządzenie B trzymało to zamówienie
 * na ekranie w nieskończoność i pozwalało je „realizować" dalej, choć
 * dokument był wystawiony, a towar zszedł ze stanu.
 *
 * W `localStorage` nie zostało NIC z biznesu — patrz `useVehicleLoading`.
 *
 * Ekran jest projektowany pod przemysłowy panel HMI ~21": duże liczby, duże
 * cele dotykowe, minimum przewijania. Telefon dostaje te same elementy
 * w mniejszej skali (klasy bazowe = telefon, `xl:` = panel hali).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  ArrowLeft, Camera, CheckCircle2, AlertTriangle, Truck, RefreshCw,
  CircleDashed, CircleDot, CheckCircle, Plus, X,
  ArrowUp, ArrowDown, ListChecks, RotateCcw, Wifi, WifiOff,
} from 'lucide-react'
import {
  errCode,
  isOfflineError,
  palletScanApi,
  vehicleLoadingApi,
  type ActiveLoadingOrder,
  type VehicleStateOrder,
  type VehicleStatePallet,
} from '@/lib/api'
import { useSkanAutoSubmit } from '@/features/scan/useSkanAutoSubmit'
import { useApi } from '@/hooks/useApi'
import { QrScannerModal } from '@/components/scan/QrScannerModal'
import { fmtKg } from '@/lib/utils'
import { useClientNames } from '@/lib/clientNames'
import { drukuj } from '@/lib/print'
import { useVehicleLoading } from '@/features/loading/useVehicleLoading'
import {
  komunikatOdmowy, komunikatSkanu, type KomunikatSkanu, type WynikSkanu,
} from '@/features/loading/scanMessages'

type Toast = KomunikatSkanu & { ts: number }


function escapeHtml(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function fmtKgClean(n: number): string {
  const num = Number(n) || 0
  const rounded = Math.round(num * 10) / 10
  const s = rounded.toFixed(1)
  return (s.endsWith('.0') ? s.slice(0, -2) : s).replace('.', ',')
}

function renderLoadingDocument(doc: any, plateOverride?: string) {
  const v = doc?.vehicle ?? {}
  const orders: any[] = doc?.orders ?? []
  const today = new Date().toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' })
  const plate = plateOverride || v.plate || ''
  const ordersHtml = orders.map((o: any) => {
    const items = (o.items ?? []).map((l: any) => `
      <tr>
        <td>${escapeHtml(l.recipe_name || l.product_type_name || '')}</td>
        <td class="r">${l.qty}</td>
        <td class="r">${fmtKgClean(l.total_kg)} kg</td>
      </tr>`).join('')
    const pallets = (o.pallets ?? []).map((p: any) =>
      `<span class="pill">P${p.pallet_no}</span>`).join(' ')
    return `
      <section class="order">
        <div class="order-head">
          <h3>${escapeHtml(o.order_no)} — ${escapeHtml(o.client_name)}</h3>
          <div class="sub">
            ${o.delivery_date ? 'Dostawa: ' + escapeHtml(o.delivery_date) + ' · ' : ''}
            ${o.pallets?.length ?? 0} palet · ${fmtKgClean(o.total_kg)} kg · ${o.total_units} szt
          </div>
        </div>
        <div class="pallets">${pallets}</div>
        <table>
          <thead><tr><th>Produkt</th><th class="r">Szt</th><th class="r">Razem kg</th></tr></thead>
          <tbody>${items}</tbody>
        </table>
      </section>`
  }).join('')

  const html = `<!DOCTYPE html><html lang="pl"><head><meta charset="utf-8"/>
<title>Wydanie ${escapeHtml(v.name || '')}</title>
<style>
  @page { size: A4 portrait; margin: 12mm }
  * { box-sizing: border-box; margin: 0; padding: 0 }
  body { font-family: Arial, sans-serif; font-size: 11px; color: #111 }
  h1 { font-size: 18px; margin-bottom: 4px }
  h3 { font-size: 13px; margin-bottom: 2px }
  .meta { color: #555; font-size: 10px; margin-bottom: 10px }
  table { width: 100%; border-collapse: collapse; margin-top: 4px }
  th, td { border: 1px solid #ccc; padding: 3px 6px }
  th { background: #f3f4f6; text-align: left; font-size: 10px }
  .r { text-align: right }
  .order { margin-top: 14px; page-break-inside: avoid }
  .order-head { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 2px solid #111; padding-bottom: 3px }
  .order-head .sub { font-size: 10px; color: #555 }
  .pallets { margin-top: 6px; display: flex; flex-wrap: wrap; gap: 4px }
  .pill { display: inline-block; padding: 2px 7px; border-radius: 9999px; background: #fef3c7; color: #92400e; font-weight: 700; font-size: 10px }
  .sigs { margin-top: 24px; display: grid; grid-template-columns: 1fr 1fr; gap: 24px }
  .sig { border-top: 1px solid #333; padding-top: 4px; font-size: 9px; color: #555 }
  .actions { position: fixed; top: 8px; right: 8px }
  @media print { .actions { display: none } }
  button { font: inherit; padding: 6px 12px; border: 1px solid #888; background: #fff; cursor: pointer; border-radius: 6px }
</style></head><body>
<div class="actions"><button onclick="void drukuj()">Drukuj</button></div>
<h1>Dokument wydania (WZ)</h1>
<div class="meta">
  Pojazd: <b>${escapeHtml(v.name || '')}</b>${plate ? ' · ' + escapeHtml(plate) : ''}${v.kind === 'own' ? ' · firmowy' : ' · spedycja'}<br/>
  Wygenerowano: ${escapeHtml(today)} · Zamówień: ${orders.length}
</div>
${ordersHtml}
<div class="sigs">
  <div class="sig">Wydał (osoba magazynowa)</div>
  <div class="sig">Odebrał (kierowca)</div>
</div>
<script>window.addEventListener('load', () => setTimeout(() => void drukuj(), 350))</script>
</body></html>`

  const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const win = window.open(url, '_blank')
  if (!win || win.closed || typeof win.closed === 'undefined') {
    window.location.href = url
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

// ── Drobne elementy ───────────────────────────────────────────────────────
function StatusBadge({ paleta }: { paleta: VehicleStatePallet }) {
  if (paleta.onThisVehicle)            return <CheckCircle   className="size-6 xl:size-9 text-emerald-600" />
  if (paleta.status === 'cold_storage') return <CircleDot    className="size-6 xl:size-9 text-sky-600" />
  return <CircleDashed className="size-6 xl:size-9 text-slate-400" />
}

function fmtKgInt(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

function opisPozycji(items: VehicleStatePallet['items']): string {
  const byKg = new Map<number, number>()
  for (const it of items) {
    if (it.qty <= 0) continue
    byKg.set(it.kgPerUnit, (byKg.get(it.kgPerUnit) ?? 0) + it.qty)
  }
  return Array.from(byKg.entries())
    .sort((a, b) => b[0] - a[0])
    .map(([kg, qty]) => `${qty}szt × ${fmtKgInt(kg)}kg`)
    .join(' + ')
}

/** Status zamówienia jednym słowem — bez mnożenia kolorów.
 *  Zielony = zrobione, bursztyn = w toku, szary = jeszcze nietknięte. */
function statusZamowienia(t: VehicleStateOrder['totals']) {
  if (t.totalPallets > 0 && t.loadedPallets === t.totalPallets)
    return { tekst: 'ZAŁADOWANE',   klasa: 'bg-emerald-100 text-emerald-800 border-emerald-300' }
  if (t.loadedPallets > 0)
    return { tekst: 'W TRAKCIE',    klasa: 'bg-amber-100 text-amber-900 border-amber-300' }
  return   { tekst: 'DO ZAŁADUNKU', klasa: 'bg-slate-100 text-slate-700 border-slate-300' }
}

function PalletRow({ p, orderId, onCofnij, cofanaId }: {
  p: VehicleStatePallet
  orderId: string
  onCofnij: (orderId: string, palletNo: number) => void
  cofanaId: string | null
}) {
  const label = opisPozycji(p.items)
  // Cofnięcie WPROST na liście załadunku. Biuro (2026-09-10): „zeskanowałem
  // paletę na auto przez przypadek, a nie mam przycisku cofnij".
  const mozna = p.onThisVehicle
  const wTrakcie = cofanaId === p.id
  return (
    <li className="flex items-center gap-3 px-3 py-2.5 xl:gap-5 xl:px-6 xl:py-4">
      <StatusBadge paleta={p} />
      <div className="min-w-0 flex-1">
        <div className="text-base font-semibold text-slate-900 xl:text-2xl">
          P{p.palletNo}
          {label && <span className="ml-2 font-normal text-slate-600 xl:ml-4">· {label}</span>}
        </div>
      </div>
      <div className="text-right">
        <div className="font-semibold tabular-nums text-slate-900 xl:text-2xl">
          {fmtKg(p.totalKg ?? 0, 1)} kg
        </div>
        <div className="text-xs text-slate-500 xl:text-base">{p.totalQty ?? 0} szt</div>
      </div>
      {mozna && (
        <button
          type="button"
          onClick={() => onCofnij(orderId, p.palletNo)}
          disabled={wTrakcie}
          aria-label={`Zdejmij paletę P${p.palletNo} z samochodu`}
          title="Zdejmij z samochodu"
          className="shrink-0 rounded-lg border border-slate-300 p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40 xl:p-4"
        >
          <RotateCcw className="size-[18px] xl:size-7" />
        </button>
      )}
    </li>
  )
}

export function MobileZaladunekPage() {
  const clientDisplay = useClientNames()
  const { vehicleId = '' } = useParams<{ vehicleId: string }>()

  // CAŁY stan załadunku pochodzi stąd i tylko stąd.
  const { stan, ladowanie, online, odswiez, przyjmij } = useVehicleLoading(vehicleId)

  const [cofanaId, setCofanaId] = useState<string | null>(null)
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<Toast | null>(null)
  const [scannerOpen, setScannerOpen] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [historia, setHistoria] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const zamowienia = stan?.orders ?? []
  const vehicle = stan?.vehicle
  const totals = stan?.totals

  // Lista „do dołożenia" — domyślnie TYLKO zamówienia wymagające działania.
  // Zrealizowane i anulowane filtruje backend; „Historia" to osobny tryb.
  const dostepneRes = useApi(() => palletScanApi.activeLoading(historia), [historia])
  const dostepne = useMemo(() => {
    const naAucie = new Set(zamowienia.map((o) => o.id))
    return (dostepneRes.data ?? []).filter((o) => !naAucie.has(o.id))
  }, [dostepneRes.data, zamowienia])

  const focusInput = useCallback(() => {
    setTimeout(() => inputRef.current?.focus(), 30)
  }, [])

  // Okno wyboru otwieramy DOPIERO gdy serwer potwierdzi, że na aucie nic nie
  // stoi. Inaczej świeżo włączony panel zasłaniałby nim listę, która właśnie
  // przychodzi — magazynier widziałby „wybierz zamówienia", choć auto jest
  // w połowie załadowane przez kolegę.
  useEffect(() => {
    if (!ladowanie && stan && zamowienia.length === 0 && !historia) setPickerOpen(true)
  }, [ladowanie, stan, zamowienia.length, historia])

  function pokazBlad(e: unknown, domyslny: WynikSkanu = 'ERROR', ctx = {}) {
    const kod = (isOfflineError(e) ? 'OFFLINE' : (errCode(e) || domyslny)) as WynikSkanu
    setToast({
      ...komunikatSkanu(kod, { ...ctx, wiadomosc: e instanceof Error ? e.message : undefined }),
      ts: Date.now(),
    })
    try { navigator.vibrate?.([60, 40, 60]) } catch {}
  }

  /** Odmowa operacji na liście auta — pokazujemy POWÓD z serwera.
   *  To nie jest skan, więc słownik kodów skanu tu nie pasuje. */
  function pokazOdmowe(e: unknown) {
    setToast({ ...komunikatOdmowy(e, isOfflineError(e)), ts: Date.now() })
    try { navigator.vibrate?.([60, 40, 60]) } catch {}
  }

  // ── Wybór zamówień — każda zmiana idzie na serwer ───────────────────────
  async function dodajZamowienie(id: string) {
    try { przyjmij(await vehicleLoadingApi.addOrder(vehicleId, id)) }
    catch (e) { pokazOdmowe(e); void odswiez() }
  }

  async function zdejmijZamowienie(id: string) {
    try { przyjmij(await vehicleLoadingApi.removeOrder(vehicleId, id)) }
    catch (e) { pokazOdmowe(e); void odswiez() }
  }

  async function przesun(id: string, dir: -1 | 1) {
    const ids = zamowienia.map((o) => o.id)
    const i = ids.indexOf(id)
    const j = i + dir
    if (i < 0 || j < 0 || j >= ids.length) return
    ;[ids[i], ids[j]] = [ids[j], ids[i]]
    try { przyjmij(await vehicleLoadingApi.reorder(vehicleId, ids)) }
    catch (e) { pokazOdmowe(e); void odswiez() }
  }

  async function wyczyscAuto() {
    if (!confirm('Zdjąć wszystkie zamówienia z tego samochodu?')) return
    try { przyjmij(await vehicleLoadingApi.clear(vehicleId)) }
    catch (e) { pokazOdmowe(e); void odswiez() }
  }

  // Skaner HID bez sufiksu Enter wpisuje kod i nic więcej — formularz się nie
  // wysyła i wygląda to jak awaria MES (zakład, 17.09.2026, DS2278). Ekran
  // rozpoznaje więc KOMPLETNY kod palety sam i wysyła go po chwili
  // bezczynności; Enter, jeśli jednak przyjdzie, jest bezczynny.
  const { zatwierdz } = useSkanAutoSubmit(value, handleSubmit)

  async function handleSubmit(code: string) {
    const trimmed = code.trim()
    if (!trimmed || busy) return
    if (zamowienia.length === 0) {
      setToast({
        ok: false,
        naglowek: 'NAJPIERW WYBIERZ ZAMÓWIENIA',
        szczegol: 'Wskaż, co jedzie tym samochodem, zanim zaczniesz skanować palety.',
        ts: Date.now(),
      })
      setPickerOpen(true)
      return
    }
    setBusy(true)
    try {
      // Skan rozstrzyga się na serwerze — łącznie z tym, czy paleta w ogóle
      // należy do zamówienia stojącego na tym aucie (kod WRONG_ORDER).
      // Front tej decyzji NIE podejmuje: do 20.09.2026 sprawdzał ją po swojej
      // liście z localStorage, więc drugi skaner miewał inne zdanie.
      const wynik = await palletScanApi.scan(trimmed, 'loaded', '', vehicleId)
      setToast({
        ...komunikatSkanu(wynik.result, {
          palletNo: wynik.palletNo,
          orderNo: wynik.order.orderNo,
          kg: wynik.totalKg,
        }),
        ts: Date.now(),
      })
      try { navigator.vibrate?.(wynik.result === 'SUCCESS' ? 80 : [60, 40, 60]) } catch {}
      // Stan bierzemy z serwera, nie z własnego licznika.
      await odswiez()
    } catch (e) {
      pokazBlad(e)
      await odswiez()
    } finally {
      setBusy(false)
      setValue('')
      focusInput()
    }
  }

  /** Zdejmij paletę z samochodu — cofnięcie omyłkowego skanu.
   *  Backend odsyła ją tam, skąd przyszła: do mroźni, jeśli w niej była. */
  async function cofnijPalete(orderId: string, palletNo: number) {
    if (cofanaId !== null) return
    const paleta = zamowienia.find((o) => o.id === orderId)
      ?.pallets.find((p) => p.palletNo === palletNo)
    setCofanaId(paleta?.id ?? `${orderId}-${palletNo}`)
    try {
      await palletScanApi.scan(`PAL|${orderId}|${palletNo}`, 'undo')
      setToast({
        ok: true,
        naglowek: 'PALETA ZDJĘTA',
        szczegol: `P${palletNo} wróciła z samochodu.`,
        ts: Date.now(),
      })
      try { navigator.vibrate?.(60) } catch {}
      await odswiez()
    } catch (e) {
      pokazBlad(e)
      await odswiez()
    } finally {
      setCofanaId(null)
    }
  }

  // ── Zakończenie załadunku ───────────────────────────────────────────────
  const zaladowanePalety = totals?.loadedPallets ?? 0
  const wszystkiePalety  = totals?.totalPallets ?? 0
  const pct = wszystkiePalety > 0 ? Math.round((zaladowanePalety / wszystkiePalety) * 100) : 0
  const allLoaded = wszystkiePalety > 0 && zaladowanePalety === wszystkiePalety
  const isForwarder = vehicle?.kind && vehicle.kind !== 'own'

  const [finalizing, setFinalizing] = useState(false)
  const [confirmFinalize, setConfirmFinalize] = useState(false)
  const [plateInput, setPlateInput] = useState('')

  function openConfirm() {
    setPlateInput(vehicle?.plate || '')
    setConfirmFinalize(true)
  }

  async function handleFinalize() {
    if (zamowienia.length === 0) return
    const plate = plateInput.trim().toUpperCase()
    if (isForwarder && !plate) {
      setToast({
        ok: false,
        naglowek: 'BRAK NUMERU REJESTRACYJNEGO',
        szczegol: 'Pojazd spedycyjny musi mieć wpisany numer — trafia na dokument.',
        ts: Date.now(),
      })
      return
    }
    setFinalizing(true)
    const ids = zamowienia.map((o) => o.id)
    try {
      const res = await palletScanApi.finalizeLoading(vehicleId, ids, plate)
      const doc = await palletScanApi.loadingDocument(vehicleId, ids)
      renderLoadingDocument(doc, plate)
      const rozjazdy = (res.orders || []).filter(o => o.wz_status === 'rozjazd')
      const wzNums = (res.orders || []).filter(o => o.wz_number).map(o => o.wz_number).join(', ')
      if (rozjazdy.length) {
        setToast({
          ok: false,
          naglowek: 'ZAŁADUNEK ZAPISANY — ROZJAZD Z WZ',
          szczegol: `${rozjazdy.map(o => o.order_no).join(', ')}: biuro musi skorygować `
                  + 'dokument przed fakturą (Dokumenty WZ → Raport rozjazdu).',
          ts: Date.now(),
        })
      } else {
        setToast({
          ok: true,
          naglowek: 'ZAMÓWIENIE ZREALIZOWANE',
          szczegol: `WZ: ${wzNums || '—'} · dokument wydania otwarty do druku.`,
          ts: Date.now(),
        })
      }
      setConfirmFinalize(false)
      setPlateInput('')
      // Zamówienia zeszły z auta po stronie BAZY (`release_orders`) — tutaj
      // tylko pobieramy nowy stan. Żadnego czyszczenia lokalnej listy, bo
      // takiej listy już nie ma; drugie urządzenie zobaczy to samo po tiku.
      await odswiez()
      dostepneRes.refetch()
    } catch (e) {
      pokazBlad(e)
      await odswiez()
    } finally {
      setFinalizing(false)
    }
  }

  const naglowekAuta = vehicle
    ? `${vehicle.name}${vehicle.plate ? ` · ${vehicle.plate}` : ''}`
    : 'Samochód…'

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 text-slate-900">
      <header className="flex items-center justify-between gap-2 border-b border-amber-200 bg-amber-500 px-3 py-2 text-white shadow-sm xl:px-8 xl:py-5">
        <Link to="/mobile/zaladunek" className="flex shrink-0 items-center gap-1 text-sm font-semibold text-amber-50 hover:text-white xl:gap-2 xl:text-xl">
          <ArrowLeft className="size-4 xl:size-7" /> Auta
        </Link>
        <div className="min-w-0 text-center">
          <div className="flex items-center justify-center gap-1.5 text-[11px] uppercase tracking-wider text-amber-50 xl:text-base">
            <Truck className="size-[13px] xl:size-5" /> Załadunek
          </div>
          <div className="truncate text-sm font-bold xl:text-3xl">{naglowekAuta}</div>
        </div>
        <div className="flex shrink-0 items-center gap-1 xl:gap-3">
          {/* OFFLINE musi być widoczne bez szukania — operator ma wiedzieć,
              że patrzy na dane sprzed chwili, a skan może nie przejść. */}
          {online
            ? <Wifi className="size-4 text-amber-100 xl:size-7" aria-label="Połączono" />
            : <WifiOff className="size-4 text-white xl:size-7" aria-label="Brak połączenia" />}
          <button
            onClick={() => { void odswiez(); dostepneRes.refetch() }}
            aria-label="Odśwież"
            className="rounded p-1 text-amber-50 hover:bg-white/20 xl:p-3"
          >
            <RefreshCw className="size-4 xl:size-7" />
          </button>
        </div>
      </header>

      {!online && (
        <div className="flex items-center justify-center gap-2 bg-slate-800 px-3 py-2 text-sm font-bold text-white xl:py-4 xl:text-2xl">
          <WifiOff className="size-4 xl:size-7" />
          BRAK POŁĄCZENIA — DANE MOGĄ BYĆ NIEAKTUALNE
        </div>
      )}

      <main className="mx-auto flex w-full max-w-[1800px] flex-1 flex-col gap-3 p-3 xl:gap-6 xl:p-8">
        {/* Karta wyboru zamówień */}
        <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <button
            type="button"
            onClick={() => setPickerOpen((v) => !v)}
            className="flex w-full items-center justify-between gap-2 px-3 py-3 text-left xl:px-8 xl:py-6"
          >
            <div className="min-w-0">
              <div className="text-xs uppercase tracking-wide text-slate-500 xl:text-base">
                Zamówienia na samochód
              </div>
              <div className="text-base font-semibold text-slate-900 xl:text-3xl">
                {zamowienia.length === 0
                  ? 'Wybierz zamówienia →'
                  : `${zamowienia.length} ${zamowienia.length === 1 ? 'zamówienie' : 'zamówienia'} · ${zaladowanePalety}/${wszystkiePalety} palet`}
              </div>
            </div>
            <Plus className={`size-5 shrink-0 text-slate-500 transition-transform xl:size-9 ${pickerOpen ? 'rotate-45' : ''}`} />
          </button>

          {pickerOpen && (
            <div className="border-t border-slate-200 p-3 xl:p-8">
              {zamowienia.length > 0 && (
                <div className="mb-4 xl:mb-8">
                  <div className="mb-2 flex items-center gap-1.5 text-xs uppercase tracking-wide text-slate-500 xl:text-base">
                    <ListChecks className="size-3 xl:size-5" /> Kolejność na samochód
                  </div>
                  <ul className="space-y-2 xl:space-y-3">
                    {zamowienia.map((o, idx) => (
                      <li key={o.id} className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-2 py-2 xl:gap-4 xl:px-5 xl:py-4">
                        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-amber-500 text-sm font-bold text-white xl:size-14 xl:text-2xl">
                          {idx + 1}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-semibold text-slate-900 xl:text-2xl">
                            {o.orderNo} · {clientDisplay(o.clientName)}
                          </div>
                          <div className="text-xs text-slate-500 xl:text-lg">
                            {o.totals.loadedPallets}/{o.totals.totalPallets} palet
                            {o.deliveryDate ? ` · ${o.deliveryDate}` : ''}
                          </div>
                        </div>
                        <div className="flex shrink-0 flex-col gap-1 xl:gap-2">
                          <button type="button" onClick={() => przesun(o.id, -1)} disabled={idx === 0}
                            aria-label="W górę"
                            className="rounded bg-slate-200 p-1 text-slate-700 hover:bg-slate-300 disabled:opacity-30 xl:p-2.5">
                            <ArrowUp className="size-3.5 xl:size-6" />
                          </button>
                          <button type="button" onClick={() => przesun(o.id, 1)} disabled={idx === zamowienia.length - 1}
                            aria-label="W dół"
                            className="rounded bg-slate-200 p-1 text-slate-700 hover:bg-slate-300 disabled:opacity-30 xl:p-2.5">
                            <ArrowDown className="size-3.5 xl:size-6" />
                          </button>
                        </div>
                        <button type="button" onClick={() => zdejmijZamowienie(o.id)}
                          aria-label={`Usuń ${o.orderNo} z samochodu`}
                          className="ml-1 rounded p-1 text-red-600 hover:bg-red-50 xl:p-3">
                          <X className="size-4 xl:size-7" />
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="text-xs uppercase tracking-wide text-slate-500 xl:text-base">
                    {historia ? 'Historia (także zrealizowane)' : 'Do załadunku'}
                  </div>
                  {/* Historia jest OSOBNYM trybem, nigdy domyślnym: główny ekran
                      odpowiada na pytanie „co mam teraz załadować?". */}
                  <button type="button" onClick={() => setHistoria((v) => !v)}
                    className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50 xl:px-4 xl:py-2 xl:text-base">
                    {historia ? 'Pokaż tylko aktywne' : 'Historia'}
                  </button>
                </div>
                {dostepneRes.loading && !dostepneRes.data && (
                  <div className="py-4 text-center text-sm text-slate-500 xl:text-xl">Ładowanie…</div>
                )}
                {!dostepneRes.loading && dostepne.length === 0 && (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-center text-sm text-slate-500 xl:p-6 xl:text-xl">
                    {(dostepneRes.data ?? []).length === 0
                      ? 'Brak zamówień gotowych do załadunku'
                      : 'Wszystkie aktywne zamówienia są już na samochodzie'}
                  </div>
                )}
                <ul className="divide-y divide-slate-100">
                  {dostepne.map((o: ActiveLoadingOrder) => {
                    // W trybie Historia wiersze są DO WGLĄDU. Zamówienie
                    // zrealizowane nie ma czego szukać na samochodzie —
                    // backend i tak by je odrzucił, ale operator nie powinien
                    // dostać przycisku, który zawsze kończy się odmową.
                    const zamkniete = o.orderStatus === 'done' || o.orderStatus === 'cancelled'
                    const tresc = (
                      <>
                        <div className={`flex size-8 shrink-0 items-center justify-center rounded-full border xl:size-14 ${
                          zamkniete ? 'border-slate-200 text-slate-300' : 'border-slate-300 text-slate-400'}`}>
                          {zamkniete
                            ? <CheckCircle className="size-3.5 xl:size-7" />
                            : <Plus className="size-3.5 xl:size-7" />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className={`truncate text-sm font-semibold xl:text-2xl ${
                            zamkniete ? 'text-slate-400' : 'text-slate-900'}`}>
                            {o.orderNo} · {clientDisplay(o.clientName)}
                          </div>
                          <div className="text-xs text-slate-500 xl:text-lg">
                            {zamkniete ? 'zrealizowane · ' : ''}
                            {o.loadedPallets}/{o.totalPallets} palet
                            {o.deliveryDate ? ` · ${o.deliveryDate}` : ''}
                          </div>
                        </div>
                      </>
                    )
                    return (
                      <li key={o.id}>
                        {zamkniete ? (
                          <div className="flex w-full items-center gap-3 py-2 xl:gap-5 xl:py-4">{tresc}</div>
                        ) : (
                          <button type="button" onClick={() => dodajZamowienie(o.id)}
                            className="flex w-full items-center gap-3 py-2 text-left hover:bg-slate-50 xl:gap-5 xl:py-4">
                            {tresc}
                          </button>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </div>

              {zamowienia.length > 0 && (
                <button type="button" onClick={wyczyscAuto}
                  className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-100 xl:mt-6 xl:py-4 xl:text-xl">
                  <X className="size-3.5 xl:size-6" /> Wyczyść samochód
                </button>
              )}
            </div>
          )}
        </section>

        {zamowienia.length > 0 && (
          <>
            {/* Postęp — największe liczby na ekranie, czytelne z dwóch metrów */}
            <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm xl:p-8">
              <div className="mb-2 flex justify-between xl:mb-5">
                <div>
                  <div className="text-xs uppercase tracking-wide text-slate-500 xl:text-lg">Załadowano</div>
                  <div className="text-3xl font-bold tabular-nums text-slate-900 xl:text-7xl">
                    {zaladowanePalety}<span className="text-slate-400">/{wszystkiePalety}</span>
                  </div>
                  <div className="text-xs text-slate-500 xl:text-xl">palet</div>
                </div>
                <div className="text-center">
                  <div className="text-xs uppercase tracking-wide text-slate-500 xl:text-lg">Zostało</div>
                  <div className="text-3xl font-bold tabular-nums text-amber-600 xl:text-7xl">
                    {Math.max(0, wszystkiePalety - zaladowanePalety)}
                  </div>
                  <div className="text-xs text-slate-500 xl:text-xl">palet</div>
                </div>
                <div className="text-right">
                  <div className="text-xs uppercase tracking-wide text-slate-500 xl:text-lg">Waga</div>
                  <div className="text-3xl font-bold tabular-nums text-slate-900 xl:text-7xl">
                    {fmtKg(totals?.loadedKg ?? 0, 0)}
                    <span className="text-slate-400">/{fmtKg(totals?.totalKg ?? 0, 0)}</span>
                  </div>
                  <div className="text-xs text-slate-500 xl:text-xl">kg</div>
                </div>
              </div>
              <div className="h-3 overflow-hidden rounded-full bg-slate-100 xl:h-6">
                <div className="h-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
              </div>
              <div className="mt-1 text-right text-xs text-slate-500 xl:mt-3 xl:text-xl">{pct}%</div>
            </div>

            {/* Strefa skanowania */}
            <form
              onSubmit={(e) => { e.preventDefault(); zatwierdz(value) }}
              className="flex items-stretch gap-2 xl:gap-4"
            >
              <input
                ref={inputRef}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="Skanuj QR palety"
                autoFocus
                inputMode="text"
                autoComplete="off"
                spellCheck={false}
                disabled={busy}
                className="flex-1 rounded-lg border-2 border-amber-300 bg-white px-3 py-3 text-base text-slate-900 placeholder:text-slate-400 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-200 disabled:bg-slate-100 xl:rounded-2xl xl:px-8 xl:py-8 xl:text-4xl"
              />
              <button
                type="button"
                onClick={() => setScannerOpen(true)}
                className="flex items-center justify-center rounded-lg bg-amber-500 px-4 text-white hover:bg-amber-600 xl:rounded-2xl xl:px-10"
                aria-label="Skanuj aparatem"
              >
                <Camera className="size-[22px] xl:size-12" />
              </button>
            </form>

            {/* Komunikat po skanie — duży, jednoznaczny */}
            {toast && (
              <div
                role="status"
                className={`flex items-start gap-3 rounded-xl border-2 p-3 xl:gap-6 xl:p-7 ${
                  toast.ok ? 'border-emerald-300 bg-emerald-50' : 'border-red-300 bg-red-50'
                }`}
              >
                {toast.ok
                  ? <CheckCircle2 className="size-6 shrink-0 text-emerald-600 xl:size-14" />
                  : <AlertTriangle className="size-6 shrink-0 text-red-600 xl:size-14" />}
                <div className="min-w-0">
                  <div className={`text-base font-bold leading-tight xl:text-4xl ${
                    toast.ok ? 'text-emerald-900' : 'text-red-900'}`}>
                    {toast.naglowek}
                  </div>
                  <div className={`mt-0.5 text-sm xl:mt-2 xl:text-2xl ${
                    toast.ok ? 'text-emerald-800' : 'text-red-800'}`}>
                    {toast.szczegol}
                  </div>
                </div>
              </div>
            )}

            {/* Zamówienia w kolejności załadunku.
                Na panelu 21" dwie kolumny — przy 1920×1080 jedna kolumna
                zjeżdżała poniżej ekranu już przy dwóch zamówieniach,
                a magazynier ma widzieć auto bez przewijania. */}
            <div className="flex flex-col gap-3 xl:grid xl:grid-cols-2 xl:items-start xl:gap-6">
              {zamowienia.map((o, idx) => {
                const orderPct = o.totals.totalPallets > 0
                  ? Math.round((o.totals.loadedPallets / o.totals.totalPallets) * 100)
                  : 0
                const znacznik = statusZamowienia(o.totals)
                const sorted = [...o.pallets].sort(
                  (a, b) => (a.onThisVehicle ? 1 : 0) - (b.onThisVehicle ? 1 : 0)
                            || a.palletNo - b.palletNo)
                return (
                  <section key={o.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                    <div className="border-b border-slate-200 bg-slate-50 px-3 py-2 xl:px-8 xl:py-5">
                      <div className="flex items-baseline justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2 xl:gap-4">
                          <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-amber-500 text-xs font-bold text-white xl:size-12 xl:text-2xl">
                            {idx + 1}
                          </div>
                          <div className="min-w-0">
                            <div className="truncate text-sm font-bold text-slate-900 xl:text-3xl">
                              {clientDisplay(o.clientName)}
                            </div>
                            <div className="text-xs text-slate-500 xl:text-lg">Zam. {o.orderNo}</div>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2 xl:gap-5">
                          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide xl:px-4 xl:py-1.5 xl:text-base ${znacznik.klasa}`}>
                            {znacznik.tekst}
                          </span>
                          <div className="text-right tabular-nums">
                            <div className="text-sm font-semibold text-slate-900 xl:text-2xl">
                              {o.totals.loadedPallets}/{o.totals.totalPallets}
                            </div>
                            <div className="text-xs text-slate-500 xl:text-base">{orderPct}%</div>
                          </div>
                        </div>
                      </div>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200 xl:mt-4 xl:h-3">
                        <div className="h-full bg-emerald-500 transition-all" style={{ width: `${orderPct}%` }} />
                      </div>
                    </div>
                    <ul className="divide-y divide-slate-100">
                      {sorted.map((p) => (
                        <PalletRow key={p.id || p.palletNo} p={p} orderId={o.id}
                          onCofnij={cofnijPalete} cofanaId={cofanaId} />
                      ))}
                    </ul>
                  </section>
                )
              })}
            </div>

            <button
              type="button"
              onClick={openConfirm}
              disabled={zaladowanePalety === 0 || finalizing}
              className={`flex items-center justify-center gap-2 rounded-lg px-3 py-4 text-base font-bold shadow xl:gap-4 xl:rounded-2xl xl:py-10 xl:text-4xl ${
                zaladowanePalety === 0
                  ? 'cursor-not-allowed bg-slate-200 text-slate-400'
                  : allLoaded
                    ? 'bg-emerald-500 text-white hover:bg-emerald-600'
                    : 'bg-amber-500 text-white hover:bg-amber-600'
              }`}
            >
              <CheckCircle2 className="size-[18px] xl:size-10" />
              {zaladowanePalety === 0
                ? 'Brak załadowanych palet'
                : allLoaded
                  ? 'Zakończ załadunek pojazdu'
                  : `Zakończ częściowo (${zaladowanePalety}/${wszystkiePalety} palet)`}
            </button>
          </>
        )}
      </main>

      {/* Dialog: potwierdzenie zakończenia */}
      {confirmFinalize && (
        <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/40 px-3 py-4 sm:items-center">
          <div className="w-full max-w-md rounded-2xl bg-white p-4 shadow-xl xl:max-w-3xl xl:p-10">
            <div className="mb-2 text-base font-bold text-slate-900 xl:mb-5 xl:text-4xl">
              Zakończyć załadunek?
            </div>
            {allLoaded ? (
              <div className="mb-4 text-sm text-slate-600 xl:mb-8 xl:text-2xl">
                Zamknie się {zamowienia.length} {zamowienia.length === 1 ? 'zamówienie' : 'zamówienia'} ({zaladowanePalety} palet · {fmtKg(totals?.loadedKg ?? 0, 0)} kg).
                Otworzy się dokument wydania do druku.
              </div>
            ) : (
              <div className="mb-4 rounded-lg border-2 border-amber-400 bg-amber-50 p-3 xl:mb-8 xl:p-6">
                <div className="flex items-start gap-2 xl:gap-4">
                  <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-600 xl:size-10" />
                  <div className="text-sm xl:text-2xl">
                    <div className="mb-1 font-bold text-amber-900">
                      Częściowy załadunek — {zaladowanePalety} z {wszystkiePalety} palet
                    </div>
                    <div className="text-amber-800">
                      Pozostałe <b>{wszystkiePalety - zaladowanePalety}</b> palet NIE pojedzie tym pojazdem.
                      WZ zawiera tylko załadowane palety. Zamówienia z niezaładowanymi paletami
                      zostaną na liście aktywnych załadunków.
                    </div>
                  </div>
                </div>
              </div>
            )}
            {isForwarder && (
              <div className="mb-4 xl:mb-8">
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-700 xl:mb-3 xl:text-lg">
                  Nr rejestracyjny pojazdu spedycyjnego *
                </label>
                <input
                  type="text"
                  value={plateInput}
                  onChange={e => setPlateInput(e.target.value.toUpperCase())}
                  placeholder="np. KR1234A"
                  autoFocus
                  className="w-full rounded-lg border-2 border-amber-300 bg-white px-3 py-2 font-mono text-base font-bold tracking-wider text-slate-900 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-200 xl:px-6 xl:py-5 xl:text-3xl"
                />
                <div className="mt-1 text-[11px] text-slate-500 xl:mt-3 xl:text-lg">
                  Wpisany numer pojawi się na dokumencie wydania.
                </div>
              </div>
            )}
            <div className="flex gap-2 xl:gap-5">
              <button
                type="button"
                onClick={() => setConfirmFinalize(false)}
                disabled={finalizing}
                className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 xl:py-6 xl:text-2xl"
              >
                Anuluj
              </button>
              <button
                type="button"
                onClick={handleFinalize}
                disabled={finalizing}
                className="flex-1 rounded-lg bg-emerald-500 px-3 py-3 text-sm font-bold text-white hover:bg-emerald-600 disabled:opacity-60 xl:py-6 xl:text-2xl"
              >
                {finalizing ? 'Zamykam…' : 'Tak, zakończ'}
              </button>
            </div>
          </div>
        </div>
      )}

      {scannerOpen && (
        <QrScannerModal
          onScan={(text) => { setScannerOpen(false); handleSubmit(text); focusInput() }}
          onClose={() => { setScannerOpen(false); focusInput() }}
        />
      )}
    </div>
  )
}
