/**
 * WYDANIE, poziom 3 — załadunek palet na auto.
 *
 * Stan auta jest WSPÓLNY dla wszystkich skanerów (`useVehicleLoading`,
 * odpytywanie co 4 s) — paleta zeskanowana telefonem albo drugim skanerem
 * pojawia się tu sama. Do 20.09.2026 lista żyła w localStorage urządzenia
 * i dwa skanery miały różne zdanie o tym samym aucie.
 *
 * Przepływ jak na telefonie, bo backend go wymaga: paleta wchodzi tylko na
 * auto, na którym jest jej zamówienie (inaczej WRONG_ORDER). Stąd kolumna
 * „Dołóż zamówienie" — magazynier decyduje, co jedzie, gdy auto podjedzie.
 *
 * CISZA ZNACZY DOBRZE: udany skan nie gra i nie miga, pasek po prostu rośnie.
 * Poza kolejnością — bursztyn (paleta JEST zaliczona), odmowa — czerwień.
 *
 * „Zakończ załadunek" zapisuje KURS (co wyjechało, którym autem, o której).
 * Dokumenty wystawia biuro z kursu — panel nie ma ani drukarki A4, ani
 * uprawnień do WZ.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { StanPolaczenia } from './components/StanPolaczenia'
import { HMI_VARS } from '@/features/hmi-theme/vars'
import {
  errCode, isOfflineError, palletScanApi, vehicleLoadingApi, type ScanResultCode,
} from '@/lib/api'
import { useApi } from '@/hooks/useApi'
import { useVehicleLoading } from '@/features/loading/useVehicleLoading'
import { komunikatOdmowy, komunikatPozaKolejnoscia, komunikatSkanu } from '@/features/loading/scanMessages'
import { PasSkanowania } from './components/PasSkanowania'
import { ListaZaladunku } from './components/ListaZaladunku'
import { ZALADUNEK_OK } from './components/WierszZaladunku'
import { grajBlad, grajInny } from './dzwiek'
import type { PokazAlarm } from './magazynTypes'

export function EkranZaladunku({ vehicleId, onAlarm, onKoniec }: {
  vehicleId: string
  onAlarm: PokazAlarm
  onKoniec: () => void
}) {
  const { stan, ladowanie, online, aktualizacja, czekaNaStan, odswiez, odswiezPoZapisie, przyjmij } = useVehicleLoading(vehicleId)
  const zamowienia = stan?.orders ?? []
  const pojazd = stan?.vehicle
  const spedycja = !!pojazd?.kind && pojazd.kind !== 'own'

  const dostepneRes = useApi(() => palletScanApi.activeLoading(false), [])
  useEffect(() => {
    const timer = setInterval(dostepneRes.refetch, 5000)
    return () => clearInterval(timer)
  }, [dostepneRes.refetch])
  const dostepne = useMemo(() => {
    const naAucie = new Set(zamowienia.map(o => o.id))
    return (dostepneRes.data ?? []).filter(o => !naAucie.has(o.id))
  }, [dostepneRes.data, zamowienia])

  const [pytanie, setPytanie] = useState(false)
  const [rejestracja, setRejestracja] = useState('')
  const [zamyka, setZamyka] = useState(false)
  const [cofana, setCofana] = useState<string | null>(null)
  const [skanuje, setSkanuje] = useState(false)
  const [ostatniSkan, setOstatniSkan] = useState<{ vehicleId: string; orderId: string; palletId: string; palletNo: number } | null>(null)
  const [otwarteZamowienie, setOtwarteZamowienie] = useState<string | null>(null)
  const [potwierdzane, setPotwierdzane] = useState(zamowienia)
  const [wynik, setWynik] = useState<Awaited<ReturnType<typeof palletScanApi.finalizeLoading>> | null>(null)
  const proba = useRef<{ id: string; ids: string[]; orders: string[]; plate: string } | null>(null)
  const [niepewny, setNiepewny] = useState(false)
  const zapisuje = useRef(false)
  const retryKey = `magazyn.finalize.${vehicleId}`

  // Przeładowanie strony po zerwaniu sieci nie może zgubić identyfikatora
  // zapisu. Operator świadomie ponawia dokładnie tę samą próbę.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(retryKey)
      if (!raw) return
      const saved = JSON.parse(raw)
      if (!saved.attempt?.id || !Array.isArray(saved.snapshot)) return
      proba.current = saved.attempt
      setPotwierdzane(saved.snapshot)
      setRejestracja(saved.attempt.plate)
      setNiepewny(true)
      setPytanie(true)
    } catch { /* Pamięć może być niedostępna w trybie prywatnym. */ }
  }, [retryKey])

  function wyczyscProbe() {
    proba.current = null
    try { sessionStorage.removeItem(retryKey) } catch { /* jw. */ }
  }

  function blad(naglowek: string, szczegol: string) {
    grajBlad('L')
    onAlarm({ skaner: 'L', ton: 'blad', naglowek, szczegol })
  }

  async function skanuj(kod: string) {
    if (pytanie || zapisuje.current) return
    setOstatniSkan(null) // nowy odczyt nie może wyglądać jak sukces poprzedniego
    let maMigawke = false
    try {
      const w = await palletScanApi.scan(kod, 'loaded', '', vehicleId, true)
      if (w.vehicleState?.vehicle.id === vehicleId) {
        // Jedyna prawda to odpowiedź serwera, nie optymistyczne +1.
        // przyjmij unieważnia też starszy, wciąż lecący polling.
        przyjmij(w.vehicleState)
        maMigawke = true
      }
      if (w.result === 'SUCCESS' && w.order?.id) {
        setOtwarteZamowienie(w.order.id)
        setOstatniSkan({ vehicleId, orderId: w.order.id, palletId: w.id, palletNo: w.palletNo })
      }
      if (w.result === 'SUCCESS' && w.pozaKolejnoscia) {
        const k = komunikatPozaKolejnoscia(w.pozaKolejnoscia, { palletNo: w.palletNo })
        grajInny('L')
        onAlarm({ skaner: 'L', ton: 'uwaga', naglowek: 'POZA KOLEJNOŚCIĄ', szczegol: k.szczegol })
      } else if (w.result !== 'SUCCESS') {
        const k = komunikatSkanu(w.result, { palletNo: w.palletNo, orderNo: w.order.orderNo })
        blad(k.naglowek, k.szczegol)
      }
      // SUCCESS bez ostrzeżenia → CISZA.
    } catch (e) {
      const kod2 = (isOfflineError(e) ? 'OFFLINE' : (errCode(e) || 'ERROR')) as ScanResultCode | 'OFFLINE'
      const k = kod2 === 'ERROR' ? komunikatOdmowy(e, false)
        : komunikatSkanu(kod2, { wiadomosc: e instanceof Error ? e.message : undefined })
      blad(k.naglowek, k.szczegol)
    }
    if (!maMigawke) odswiezPoZapisie() // GET nie zajmuje kolejki skanów
  }

  async function dodaj(orderId: string) {
    try { przyjmij(await vehicleLoadingApi.addOrder(vehicleId, orderId)) }
    catch (e) { const k = komunikatOdmowy(e, isOfflineError(e)); blad(k.naglowek, k.szczegol); void odswiez() }
  }

  async function zdejmij(orderId: string) {
    try { przyjmij(await vehicleLoadingApi.removeOrder(vehicleId, orderId)) }
    catch (e) { const k = komunikatOdmowy(e, isOfflineError(e)); blad(k.naglowek, k.szczegol); void odswiez() }
  }

  /** Cofnięcie pomyłki: paleta wraca tam, skąd przyszła (np. do mroźni). */
  async function cofnij(orderId: string, palletNo: number, id: string, scanCode?: string) {
    if (cofana) return
    setCofana(id)
    setOstatniSkan(null)
    try { await palletScanApi.scan(scanCode || `PAL|${orderId}|${palletNo}`, 'undo', '', vehicleId) }
    catch (e) { const k = komunikatOdmowy(e, isOfflineError(e)); blad(k.naglowek, k.szczegol) }
    finally { setCofana(null); await odswiez() }
  }

  async function zakoncz() {
    if (zapisuje.current || skanuje || czekaNaStan) return
    const plate = rejestracja.trim().toUpperCase()
    if (/[|:/\\]/.test(plate) || /^(SCARTON|PAL|UNIT)[^A-Z]/.test(plate)) {
      blad('TO KOD SKANERA, NIE REJESTRACJA', 'Wpisz numer rejestracyjny auta. Skanowanie jest w tym oknie wyłączone.')
      return
    }
    if (spedycja && !plate) {
      blad('BRAK NUMERU REJESTRACYJNEGO', 'Auto spedycji musi mieć wpisany numer — trafia na dokument.')
      return
    }
    if (!proba.current) proba.current = {
      id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      ids: potwierdzane.flatMap(o => o.pallets.filter(p => p.onThisVehicle).map(p => p.id)),
      orders: potwierdzane.map(o => o.id), plate,
    }
    try { sessionStorage.setItem(retryKey, JSON.stringify({ attempt: proba.current, snapshot: potwierdzane })) } catch { /* Ponowienie w bieżącym oknie nadal jest bezpieczne. */ }
    zapisuje.current = true
    setZamyka(true)
    try {
      const p = proba.current
      const res = await palletScanApi.finalizeLoading(vehicleId, p.orders, p.plate, p.id, p.ids)
      const palet = (res.orders || []).reduce((s, o) => s + (o.pallets || 0), 0)
      const problemy = (res.orders || []).filter(o => o.skipped || o.wz_status === 'rozjazd')
      if (!res.ok || !res.loading_id) {
        blad('KURS NIE ZOSTAŁ ZAPISANY', 'Brak towaru do wydania. Sprawdź aktualny stan auta.')
      } else if (problemy.length) {
        setWynik(res)
      } else {
      grajInny('L')
      onAlarm({ skaner: 'L', ton: 'uwaga', naglowek: 'KURS ZAPISANY',
        szczegol: `${palet} kartonów/palet na ${pojazd?.name ?? 'aucie'}. Dokumenty wystawi biuro z kursu.` })
      }
      wyczyscProbe()
      setNiepewny(false)
      setPytanie(false)
      await odswiez()
      dostepneRes.refetch()
      if (res.ok && res.loading_id && !problemy.length) onKoniec()
    } catch (e) {
      const k = komunikatOdmowy(e, isOfflineError(e))
      blad(k.naglowek, k.szczegol)
      if (isOfflineError(e)) setNiepewny(true)
      else { wyczyscProbe(); setNiepewny(false); setPytanie(false) }
      await odswiez()
    } finally {
      setZamyka(false)
      zapisuje.current = false
    }
  }

  const ostatnieZamowienie = ostatniSkan?.vehicleId === vehicleId ? zamowienia.find(z => z.id === ostatniSkan.orderId) : undefined
  const ostatniaPaleta = ostatnieZamowienie?.pallets.find(p => ostatniSkan?.palletId ? p.id === ostatniSkan.palletId : p.palletNo === ostatniSkan?.palletNo)
  // Cofnięcie na innym stanowisku usuwa potwierdzenie także z tego paska.
  const ostatni = ostatniaPaleta?.onThisVehicle ? { paleta: ostatniaPaleta, klient: ostatnieZamowienie!.clientName } : null

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <StanPolaczenia blad={!online} aktualizacja={aktualizacja} ladowanie={ladowanie} />
      <ListaZaladunku stan={stan} ladowanie={ladowanie} online={online} skanuje={skanuje}
        czekaNaStan={czekaNaStan} cofana={cofana} otwarte={otwarteZamowienie} ostatni={ostatni}
        dostepne={dostepne} bladDostepnych={!!dostepneRes.error} ladujeDostepne={dostepneRes.loading}
        onOtworz={setOtwarteZamowienie} onDodaj={dodaj} onZdejmij={zdejmij}
        onCofnij={(orderId, p) => cofnij(orderId, p.palletNo, p.id, p.scanCode)}
        onZakoncz={() => { setPotwierdzane(zamowienia); proba.current = null; setRejestracja(pojazd?.plate ?? ''); setPytanie(true) }} />

      <PasSkanowania placeholder="Skanuj karton lub paletę…" onSkan={skanuj}
        disabled={pytanie || zamyka || !!wynik || !!cofana} onPendingChange={setSkanuje}
        podpis="Skanuj kolejne kartony. Zielony wiersz oznacza zapis na aucie." />

      <Dialog open={pytanie} onOpenChange={open => { if (!zamyka && !niepewny) setPytanie(open) }}>
          <DialogContent style={HMI_VARS} className="max-h-[90vh] overflow-y-auto" onInteractOutside={e => e.preventDefault()}>
            <DialogTitle>Zakończyć załadunek?</DialogTitle>
            <DialogDescription>Auto {pojazd?.name}. Sprawdź, co wyjeżdża i co zostaje.</DialogDescription>
            {potwierdzane.map(z => <div key={z.id} className="rounded-xl border p-3">
              <b>{z.clientName} · {z.orderNo}</b>
              <div>Wyjeżdża: {z.pallets.filter(p => p.onThisVehicle).length} kartonów/palet · {Math.round(z.totals.loadedKg)} kg</div>
              <div className="text-amber-800">Zostaje: {z.pallets.filter(p => !p.onThisVehicle).map(p => p.cartonNo ? `karton ${p.cartonNo}` : `P${p.palletNo}`).join(', ') || 'nic'}</div>
            </div>)}
            {niepewny ? <p role="alert" className="font-bold text-red-700">Nie otrzymano potwierdzenia. Ponów zapis — ten sam kurs nie zostanie zapisany drugi raz.</p> : null}
            {spedycja ? (
              <label className="mt-4 block">
                <span className="text-[11px] font-extrabold uppercase tracking-[0.1em]" style={{ color: 'var(--mut)' }}>
                  Numer rejestracyjny (spedycja)
                </span>
                <input value={rejestracja} disabled={zamyka || niepewny} onChange={e => setRejestracja(e.target.value)}
                  className="hmi-v10-mono mt-1 w-full rounded-xl px-4 py-3 text-[20px] font-bold uppercase outline-none"
                  style={{ border: '2px solid var(--accent)' }} />
              </label>
            ) : null}
            <div className="mt-6 flex gap-3">
              <button type="button" disabled={zamyka || niepewny} onClick={() => setPytanie(false)}
                className="flex-1 rounded-xl py-4 text-[16px] font-extrabold"
                style={{ border: '1px solid var(--line)', background: 'var(--panel)' }}>Wróć</button>
              <button type="button" onClick={zakoncz} disabled={zamyka}
                className="flex-1 rounded-xl py-4 text-[16px] font-extrabold text-white"
                style={{ background: ZALADUNEK_OK }}>{zamyka ? 'Zapisuję…' : 'Zakończ'}</button>
            </div>
          </DialogContent>
      </Dialog>
      <Dialog open={!!wynik} onOpenChange={open => { if (!open) setWynik(null) }}>
        <DialogContent style={HMI_VARS}>
          <DialogTitle>Kurs zapisany — wymaga wyjaśnienia</DialogTitle>
          <DialogDescription>Przekaż biuru poniższe informacje przed wyjazdem.</DialogDescription>
          {wynik?.orders.filter(o => o.skipped || o.wz_status === 'rozjazd').map(o => <div key={o.order_id}>
            <b>{o.client_name} · {o.order_no}</b>
            <p>{o.skipped ? `Nie wydano: ${o.skipped}` : 'Zawartość auta różni się od dokumentu.'}</p>
          </div>)}
          <button className="min-h-12 rounded-xl border p-3 font-bold" onClick={() => { setWynik(null); onKoniec() }}>Rozumiem — wróć do menu</button>
        </DialogContent>
      </Dialog>
    </div>
  )
}
