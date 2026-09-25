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
import { useMemo, useState } from 'react'
import {
  errCode, isOfflineError, palletScanApi, vehicleLoadingApi, type ScanResultCode,
} from '@/lib/api'
import { useApi } from '@/hooks/useApi'
import { useVehicleLoading } from '@/features/loading/useVehicleLoading'
import { komunikatOdmowy, komunikatPozaKolejnoscia, komunikatSkanu } from '@/features/loading/scanMessages'
import { PasSkanowania } from './components/PasSkanowania'
import { Karta, Znacznik } from './components/Karta'
import { grajBlad, grajInny } from './dzwiek'
import { krotkaData } from './pula'
import type { PokazAlarm } from './magazynTypes'

export function EkranZaladunku({ vehicleId, onAlarm, onKoniec }: {
  vehicleId: string
  onAlarm: PokazAlarm
  onKoniec: () => void
}) {
  const { stan, ladowanie, online, odswiez, przyjmij } = useVehicleLoading(vehicleId)
  const zamowienia = stan?.orders ?? []
  const suma = stan?.totals ?? { totalPallets: 0, loadedPallets: 0, shippedPallets: 0, totalKg: 0, loadedKg: 0 }
  const pojazd = stan?.vehicle
  const spedycja = !!pojazd?.kind && pojazd.kind !== 'own'

  const dostepneRes = useApi(() => palletScanApi.activeLoading(false), [])
  const dostepne = useMemo(() => {
    const naAucie = new Set(zamowienia.map(o => o.id))
    return (dostepneRes.data ?? []).filter(o => !naAucie.has(o.id))
  }, [dostepneRes.data, zamowienia])

  const [pytanie, setPytanie] = useState(false)
  const [rejestracja, setRejestracja] = useState('')
  const [zamyka, setZamyka] = useState(false)
  const [cofana, setCofana] = useState<string | null>(null)

  function blad(naglowek: string, szczegol: string) {
    grajBlad('L')
    onAlarm({ skaner: 'L', ton: 'blad', naglowek, szczegol })
  }

  async function skanuj(kod: string) {
    try {
      const w = await palletScanApi.scan(kod, 'loaded', '', vehicleId)
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
      const k = komunikatSkanu(kod2, { wiadomosc: e instanceof Error ? e.message : undefined })
      blad(k.naglowek, k.szczegol)
    }
    await odswiez()
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
  async function cofnij(orderId: string, palletNo: number, id: string) {
    if (cofana) return
    setCofana(id)
    try { await palletScanApi.scan(`PAL|${orderId}|${palletNo}`, 'undo') }
    catch (e) { const k = komunikatOdmowy(e, isOfflineError(e)); blad(k.naglowek, k.szczegol) }
    finally { setCofana(null); await odswiez() }
  }

  async function zakoncz() {
    const plate = rejestracja.trim().toUpperCase()
    if (spedycja && !plate) {
      blad('BRAK NUMERU REJESTRACYJNEGO', 'Auto spedycji musi mieć wpisany numer — trafia na dokument.')
      return
    }
    setZamyka(true)
    try {
      const res = await palletScanApi.finalizeLoading(vehicleId, zamowienia.map(o => o.id), plate)
      const palet = (res.orders || []).reduce((s, o) => s + (o.pallets || 0), 0)
      grajInny('L')
      onAlarm({ skaner: 'L', ton: 'uwaga', naglowek: 'KURS ZAPISANY',
        szczegol: `${palet} palet na ${pojazd?.name ?? 'aucie'}. Dokumenty wystawi biuro z kursu.` })
      setPytanie(false)
      await odswiez()
      dostepneRes.refetch()
      onKoniec()
    } catch (e) {
      const k = komunikatOdmowy(e, isOfflineError(e))
      blad(k.naglowek, k.szczegol)
      await odswiez()
    } finally {
      setZamyka(false)
    }
  }

  const proc = suma.totalPallets ? suma.loadedPallets / suma.totalPallets : 0
  const komplet = suma.totalPallets > 0 && suma.loadedPallets === suma.totalPallets

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid min-h-0 flex-1 gap-3 p-4 px-6"
        style={{ gridTemplateColumns: 'minmax(0, 1fr) 380px' }}>

        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto pr-1">
          <section className="flex shrink-0 items-center gap-6 rounded-2xl px-6 py-5"
            style={{ background: 'var(--panel)', border: '1px solid var(--line)' }}>
            <div className="min-w-0">
              <div className="truncate text-[28px] font-extrabold leading-tight">{pojazd?.name ?? '…'}</div>
              <div className="hmi-v10-mono text-[15px] font-bold" style={{ color: 'var(--mut)' }}>{pojazd?.plate ?? ''}</div>
            </div>
            <div className="ml-auto text-right">
              <div className="hmi-v10-mono font-bold leading-none"
                style={{ fontSize: 44, color: komplet ? 'var(--success)' : 'var(--accent)' }}>
                {suma.loadedPallets}<span style={{ color: '#9AA3B0' }}>/{suma.totalPallets}</span>
              </div>
              <div className="mt-1 text-[13px]" style={{ color: 'var(--mut)' }}>
                palet · {Math.round(suma.loadedKg).toLocaleString('pl-PL')} / {Math.round(suma.totalKg).toLocaleString('pl-PL')} kg
              </div>
            </div>
            <div className="w-[220px] shrink-0">
              <div className="h-3 overflow-hidden rounded-full" style={{ background: 'var(--lineSoft)' }}>
                <div className="h-full rounded-full transition-all"
                  style={{ width: `${Math.round(proc * 100)}%`, background: komplet ? 'var(--success)' : 'var(--accent)' }} />
              </div>
              {!online ? (
                <div className="mt-2 text-[12px] font-bold" style={{ color: 'var(--red)' }}>OFFLINE — dane sprzed chwili</div>
              ) : null}
            </div>
          </section>

          {zamowienia.map((z, i) => {
            const zl = z.totals.loadedPallets, wsz = z.totals.totalPallets
            return (
              <Karta key={z.id} tresc={false}
                tytul={`${i + 1}. ${z.clientName}`}
                prawo={<>
                  <Znacznik ton={wsz && zl === wsz ? 'ok' : zl ? 'uwaga' : 'szary'}>
                    {wsz && zl === wsz ? 'załadowane' : zl ? 'w trakcie' : 'czeka'}
                  </Znacznik>
                  <span className="hmi-v10-mono">{z.orderNo}</span>
                  {zl === 0 ? (
                    <button type="button" onClick={() => zdejmij(z.id)}
                      className="rounded-md px-2 py-0.5 text-[11px] font-bold"
                      style={{ border: '1px solid var(--line)', background: 'var(--panel)', color: 'var(--mut)' }}>
                      zdejmij z auta
                    </button>
                  ) : null}
                </>}>
                <div className="grid gap-2 p-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))' }}>
                  {z.pallets.map(p => {
                    const na = p.onThisVehicle
                    return (
                      <div key={p.id || p.palletNo} className="flex items-center gap-3 rounded-xl px-3 py-2.5"
                        style={{ background: na ? 'var(--successSoft)' : 'var(--panel)',
                                 border: `1.5px solid ${na ? 'var(--successLine)' : 'var(--line)'}` }}>
                        <span className="hmi-v10-mono grid shrink-0 place-items-center rounded-full text-[12px] font-extrabold"
                          style={{ width: 34, height: 34, background: '#fff',
                                   border: `2px solid ${na ? 'var(--success)' : 'var(--line)'}`,
                                   color: na ? 'var(--success)' : '#AFB7C4' }}>
                          {na ? '✓' : `P${p.palletNo}`}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[14.5px] font-bold">Paleta {p.palletNo}</span>
                          <span className="hmi-v10-mono block text-[12px]" style={{ color: 'var(--mut)' }}>
                            {Math.round(p.totalKg)} kg · {p.totalQty} szt
                          </span>
                        </span>
                        {na ? (
                          <button type="button" disabled={!!cofana}
                            onClick={() => cofnij(z.id, p.palletNo, p.id)}
                            className="rounded-md px-2 py-1 text-[11px] font-bold"
                            style={{ border: '1px solid var(--line)', background: '#fff', color: 'var(--mut)' }}>
                            {cofana === p.id ? '…' : 'Cofnij'}
                          </button>
                        ) : null}
                      </div>
                    )
                  })}
                  {!z.pallets.length ? (
                    <div className="p-2 text-[13px]" style={{ color: 'var(--amb)' }}>
                      Zamówienie nie ma rozpisanych palet — biuro musi je rozpisać.
                    </div>
                  ) : null}
                </div>
              </Karta>
            )
          })}
          {!zamowienia.length && !ladowanie ? (
            <div className="rounded-2xl p-8 text-center text-[16px]"
              style={{ border: '1.5px dashed var(--accentLine)', color: 'var(--mut)', background: 'var(--panel)' }}>
              Na aucie nie ma jeszcze zamówień. Dołóż je z listy po prawej —
              ostatni klient na trasie wjeżdża pierwszy.
            </div>
          ) : null}
        </div>

        <div className="flex min-h-0 flex-col gap-3">
          <Karta tytul="Dołóż zamówienie" tresc={false} className="flex-1"
            prawo={<span>do załadunku · {dostepne.length}</span>}>
            {dostepne.map(o => (
              <button key={o.id} type="button" onClick={() => dodaj(o.id)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-[var(--accentSoft)]"
                style={{ borderTop: '1px solid var(--lineSoft)', color: 'var(--ink)' }}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15.5px] font-extrabold">{o.clientName}</span>
                  <span className="hmi-v10-mono block truncate text-[12px]" style={{ color: 'var(--mut)' }}>
                    {o.orderNo}{o.deliveryDate ? ` · ${krotkaData(o.deliveryDate)}` : ''}
                  </span>
                </span>
                <span className="shrink-0 text-right text-[12px]" style={{ color: 'var(--mut)' }}>
                  <span className="hmi-v10-mono block text-[15px] font-bold" style={{ color: 'var(--ink)' }}>
                    {o.totalPallets} pal.
                  </span>
                  {o.coldPallets ? `${o.coldPallets} w mroźni` : ''}
                </span>
                <span className="grid shrink-0 place-items-center rounded-lg text-[20px] font-bold"
                  style={{ width: 36, height: 36, background: 'var(--accentSoft)', color: 'var(--accent)',
                           border: '1.5px solid var(--accentLine)' }}>+</span>
              </button>
            ))}
            {!dostepne.length ? (
              <div className="p-4 text-[13.5px]" style={{ color: 'var(--mut)' }}>Nic więcej nie czeka na załadunek.</div>
            ) : null}
          </Karta>

          <button type="button" disabled={!zamowienia.length || suma.loadedPallets === 0}
            onClick={() => { setRejestracja(pojazd?.plate ?? ''); setPytanie(true) }}
            className="shrink-0 rounded-2xl px-5 py-5 text-left text-white transition active:scale-[0.99] disabled:cursor-not-allowed"
            style={{ background: (!zamowienia.length || suma.loadedPallets === 0) ? '#AFB7C4'
              : komplet ? 'var(--success)' : 'var(--amb)' }}>
            <span className="block text-[22px] font-extrabold leading-tight">
              {komplet ? 'Zakończ załadunek' : `Zakończ częściowo (${suma.loadedPallets}/${suma.totalPallets})`}
            </span>
            <span className="mt-1 block text-[13.5px] opacity-90">Zapisuje kurs — dokumenty wystawia biuro.</span>
          </button>
        </div>
      </div>

      <PasSkanowania placeholder="Skanuj kartkę palety…" onSkan={skanuj}
        podpis="Paleta z zamówienia na tym aucie. Udany skan — cisza." />

      {pytanie ? (
        <div className="fixed inset-0 z-[80] grid place-items-center p-6" style={{ background: 'rgba(15,23,42,.45)' }}>
          <div className="w-full max-w-[520px] rounded-2xl p-6" style={{ background: 'var(--panel)' }}>
            <div className="text-[24px] font-extrabold">Zakończyć załadunek?</div>
            <div className="mt-2 text-[15px]" style={{ color: 'var(--mut)' }}>
              {suma.loadedPallets} z {suma.totalPallets} palet na aucie {pojazd?.name}.
              {!komplet ? ' Niezaładowane palety zostają przy zamówieniu.' : ''}
            </div>
            {spedycja ? (
              <label className="mt-4 block">
                <span className="text-[11px] font-extrabold uppercase tracking-[0.1em]" style={{ color: 'var(--mut)' }}>
                  Numer rejestracyjny (spedycja)
                </span>
                <input value={rejestracja} onChange={e => setRejestracja(e.target.value)}
                  className="hmi-v10-mono mt-1 w-full rounded-xl px-4 py-3 text-[20px] font-bold uppercase outline-none"
                  style={{ border: '2px solid var(--accent)' }} />
              </label>
            ) : null}
            <div className="mt-6 flex gap-3">
              <button type="button" onClick={() => setPytanie(false)}
                className="flex-1 rounded-xl py-4 text-[16px] font-extrabold"
                style={{ border: '1px solid var(--line)', background: 'var(--panel)' }}>Wróć</button>
              <button type="button" onClick={zakoncz} disabled={zamyka}
                className="flex-1 rounded-xl py-4 text-[16px] font-extrabold text-white"
                style={{ background: 'var(--success)' }}>{zamyka ? 'Zapisuję…' : 'Zakończ'}</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
