import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Truck, FileText, Check, X, RefreshCw, Download, Printer, ListPlus } from 'lucide-react'
import { useApp, CommandBar, Dialog, type Cmd } from '../../shell/context'
import { useOrders } from '../../data/store'
import { kg, num } from '../../data/model'
import { FlagIcon } from '../../ui/Glyphs'
import { carriersApi, downloadDocPdf, zaladunkiApi, type Carrier } from '@/lib/api'
import { INSTRUKCJE_DOMYSLNE } from '../orders/dokumenty/Cmr'
import {
  PUSTA_DECYZJA, calosc, doWystawienia, kgNaFakture, kgNaWz, kgSprzedazy, tylkoUsluga, papieryPozycji, saldoPozycji, uklad, wpiszKg, zamowieniaDoWystawienia,
  type Decyzja, type Kurs, type PozycjaKursu, type Transport,
} from './kurs'
import { PapierChip, useZaznaczonePapiery } from './Papiery'
import { DopiszPozycjeDialog } from '../orders/wz/DopiszPozycjeDialog'

const dzisIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const godz = (iso: string | null) => {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

/**
 * Papiery kursu — wszystko, co wyjechało jednym autem, w jednym miejscu
 * (port `ZaladunekDrukPage`). Magazynier skanuje załadunek, ale nie ma drukarki
 * ani uprawnień: biuro wystawia komplet (WM/WZ, HDI, CMR) dla odbiorców
 * czekających na wystawienie i drukuje papiery dla kierowcy.
 */
export function PapieryKursu({ kursId, active, setCmds, onDone }: { kursId: string; active: boolean; setCmds: (c: Cmd[]) => void; onDone: () => void }) {
  const app = useApp()
  const { refresh } = useOrders()
  const [kurs, setKurs] = useState<Kurs | null>(null)
  const [blad, setBlad] = useState<string | null>(null)
  const [decyzje, setDecyzje] = useState<Record<string, Decyzja>>({})
  const [transport, setTransport] = useState<Transport>({ carrier_id: '', plate: '', invoice_no: '', instructions: INSTRUKCJE_DOMYSLNE })
  const [carriers, setCarriers] = useState<Carrier[] | null>(null)
  const [pytanie, setPytanie] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [dopisz, setDopisz] = useState<string | null>(null)
  const lock = useRef(false)

  const wczytaj = useCallback(async () => {
    setBlad(null)
    try {
      const k = await zaladunkiApi.get(kursId) as Kurs
      setKurs(k)
      // Numer rejestracyjny z potwierdzenia załadunku — nie nadpisujemy tego, co biuro już wpisało.
      if (k?.plate) setTransport(t => (t.plate.trim() ? t : { ...t, plate: String(k.plate) }))
      // Domyślnie CAŁOŚĆ na fakturę; decyzje już wpisane zostają.
      setDecyzje(d => Object.fromEntries((k?.pozycje ?? []).map(p => [p.order_id, d[p.order_id] ?? { ...PUSTA_DECYZJA }])))
    } catch (e) { setBlad(e instanceof Error ? e.message : 'Nie udało się wczytać kursu') }
  }, [kursId])
  useEffect(() => { void wczytaj() }, [wczytaj])
  useEffect(() => { carriersApi.list().then(setCarriers).catch(() => setCarriers([])) }, [])

  const czekajace = doWystawienia(kurs)
  const wynik = useMemo(() => zamowieniaDoWystawienia(kurs, decyzje), [kurs, decyzje])
  const wszystkiePapiery = useMemo(() => (kurs?.pozycje ?? []).flatMap(p => {
    const saldo = saldoPozycji(p, dzisIso())
    return [...papieryPozycji(p), ...(saldo?.doWszystkich ? [saldo] : [])]
  }), [kurs])

  // Do zaznaczania: każdy papier kursu, także zestawienie należności odbiorcy z WZ.
  const doZaznaczenia = useMemo(() => (kurs?.pozycje ?? []).flatMap(p => {
    const saldo = saldoPozycji(p, dzisIso())
    return [...papieryPozycji(p), ...(saldo ? [saldo] : [])]
  }), [kurs])
  const z = useZaznaczonePapiery(doZaznaczenia, `Kurs ${kurs?.plate ?? ''} — papiery`)

  const wystaw = async () => {
    if (lock.current || 'blad' in wynik) return
    lock.current = true; setBusy('wystaw'); setBlad(null); setPytanie(false)
    try {
      await zaladunkiApi.wystaw(kursId, wynik.orders, { ...transport })
      app.toast({ kind: 'ok', title: `Wystawiono komplet dla kursu ${kurs?.plate ?? ''}`, detail: `${wynik.orders.length} ${wynik.orders.length === 1 ? 'odbiorca' : 'odbiorców'} — WM zdjął towar ze stanu.` })
      await Promise.all([wczytaj(), refresh().catch(() => undefined)])
    } catch (e) { setBlad(e instanceof Error ? e.message : 'Nie udało się wystawić dokumentów') }
    finally { lock.current = false; setBusy(null) }
  }
  const pobierzWszystkie = async () => {
    setBusy('all')
    for (const d of wszystkiePapiery) {
      try { await downloadDocPdf(d.url, d.plik) } catch (e) { app.toast({ kind: 'warn', title: `Nie udało się pobrać ${d.etykieta} ${d.numer}`.trim(), detail: e instanceof Error ? e.message : '' }) }
    }
    setBusy(null)
  }
  const wydrukowane = async () => {
    if (lock.current) return
    lock.current = true; setBusy('druk')
    try {
      await zaladunkiApi.wydrukowano(kursId)
      app.toast({ kind: 'ok', title: `Kurs ${kurs?.plate ?? ''} oznaczony jako wydrukowany`, detail: 'Znika z pulpitu. Ponowny wydruk — z listy dokumentów zamówienia.' })
      await wczytaj()
    } catch (e) { setBlad(e instanceof Error ? e.message : 'Nie udało się oznaczyć kursu') }
    finally { lock.current = false; setBusy(null) }
  }

  const cmds = useMemo<Cmd[]>(() => [
    ...(czekajace.length ? [{ id: 'issue', group: 1, label: 'Wystaw komplet dokumentów', icon: <FileText size={17} />, primary: true, disabled: !!busy || 'blad' in wynik, tip: 'blad' in wynik ? wynik.blad : undefined, run: () => setPytanie(true) }] : []),
    { id: 'print-sel', group: 2, label: `Drukuj zaznaczone${z.zaznaczone.length ? ` (${z.zaznaczone.length})` : ''}`, icon: <Printer size={17} />, disabled: !!busy || !!z.busy || !z.zaznaczone.length,
      tip: z.zaznaczone.length ? 'jeden PDF ze wszystkimi zaznaczonymi' : 'zaznacz ptaszkiem dokumenty w tabeli', run: () => void z.drukuj() },
    { id: 'all', group: 2, label: 'Pobierz wszystkie PDF', icon: <Download size={17} />, disabled: !!busy || !wszystkiePapiery.length, run: () => void pobierzWszystkie() },
    { id: 'printed', group: 2, label: kurs?.printed_at ? 'Oznaczony jako wydrukowany' : 'Wydrukowane — zdejmij z pulpitu', icon: <Check size={17} />, disabled: !!busy || !kurs || !!kurs.printed_at || czekajace.length > 0, tip: czekajace.length ? 'najpierw wystaw dokumenty' : undefined, run: () => void wydrukowane() },
    { id: 'reload', group: 3, label: 'Odśwież', icon: <RefreshCw size={17} />, opt: true, disabled: !!busy, run: () => void wczytaj() },
    { id: 'close', group: 3, label: 'Zamknij', icon: <X size={17} />, run: onDone },
  ], [czekajace.length, busy, wynik, wszystkiePapiery.length, kurs, wczytaj, onDone, z.zaznaczone.length, z.busy, z.drukuj]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (active) setCmds(cmds) }, [cmds, setCmds, active])

  const wybierzPrzewoznika = (id: string) => setTransport(t => ({ ...t, carrier_id: id, plate: t.plate.trim() || (carriers?.find(c => c.id === id)?.defaultPlate ?? '') }))

  return (
    <>
      <CommandBar title={`Kurs ${kurs?.plate || ''}`} count={kurs ? `załadunek ${godz(kurs.finished_at)} · ${kurs.pozycje.length} ${kurs.pozycje.length === 1 ? 'odbiorca' : 'odbiorców'}${kurs.printed_at ? ' · wydrukowany' : ''}` : 'wczytywanie…'} cmds={cmds} />
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <div className="dock-pad" style={{ maxWidth: 1180 }}>
          {blad && <div className="note crit" role="alert"><FlagIcon level="crit" size={15} /><div><b>Serwer odmówił:</b> {blad}</div></div>}
          {!kurs && !blad && <div className="note">Wczytywanie kursu…</div>}

          {czekajace.length > 0 && <>
            <div className="sect-h"><h3><Truck size={16} style={{ verticalAlign: -3 }} /> Do wystawienia · {czekajace.length}</h3>
              <span className="sub">przy każdym odbiorcy wpisz kilogramy na fakturę albo na WZ — drugie pole policzy się samo</span></div>
            {czekajace.map(p => <KartaOdbiorcy key={p.order_id} p={p} d={decyzje[p.order_id] ?? PUSTA_DECYZJA} zmien={d => setDecyzje(s => ({ ...s, [p.order_id]: d }))} />)}
            <div className="box ov-card">
              <h4>Dane na listy przewozowe (CMR) — wspólne dla kursu</h4>
              <div className="kurs-tr">
                <label className="fld"><span className="label">Przewoźnik (pole 16)</span>
                  <select className="field" value={transport.carrier_id} onChange={e => wybierzPrzewoznika(e.target.value)} aria-label="Przewoźnik">
                    <option value="">— bez przewoźnika —</option>
                    {(carriers ?? []).map(c => <option key={c.id} value={c.id}>{c.name}{c.city ? `, ${c.city}` : ''}</option>)}
                  </select></label>
                <label className="fld"><span className="label">Nr rejestracyjny</span><input className="field" value={transport.plate} disabled={!transport.carrier_id} onChange={e => setTransport(t => ({ ...t, plate: e.target.value }))} aria-label="Numer rejestracyjny" /></label>
                <label className="fld kurs-tr-wide"><span className="label">Instrukcje (pole 13)</span><input className="field" value={transport.instructions} onChange={e => setTransport(t => ({ ...t, instructions: e.target.value }))} aria-label="Instrukcje" /></label>
              </div>
              {!transport.carrier_id && <p className="muted" style={{ fontSize: 'var(--fs-sm)', margin: 0 }}>Bez przewoźnika CMR nie ma numeru rejestracyjnego (tak jak w starym MES).</p>}
            </div>
            {'blad' in wynik && <div className="note warn"><FlagIcon level="warn" size={15} /><div>{wynik.blad}</div></div>}
          </>}

          {kurs && <>
            <div className="sect-h"><h3>Dokumenty kursu</h3><span className="sub">zaznacz ptaszkiem, co drukujesz — „Drukuj zaznaczone” u góry złoży jeden PDF</span>
              <span style={{ marginLeft: 'auto' }} className="row-wrap">
                {doZaznaczenia.length > 0 && <button className="btn sm ghost" disabled={!!z.busy} onClick={() => z.ustaw(doZaznaczenia.map(d => d.key), z.zaznaczone.length !== doZaznaczenia.length)}>
                  {z.zaznaczone.length === doZaznaczenia.length ? 'Odznacz wszystkie' : 'Zaznacz wszystkie'}</button>}
              </span></div>
            <div className="box"><table className="tbl">
              <thead><tr><th>Odbiorca</th><th>Zamówienie</th><th className="num">Wyjechało</th><th>Dokumenty</th></tr></thead>
              <tbody>{kurs.pozycje.map((p, i) => {
                const papiery = papieryPozycji(p)
                const saldo = saldoPozycji(p, dzisIso())
                return (
                  <tr key={p.order_id} className={`row${i % 2 ? ' zebra' : ''}`}>
                    <td className="strong">{p.client_name || '—'}{p.wz_status === 'rozjazd' && <span className="tag warn" style={{ marginLeft: 8 }}>rozjazd — sprawdź przed wydrukiem</span>}</td>
                    <td className="code">{p.order_no}</td>
                    <td className="num">{kg(p.kg_zaladowane)}</td>
                    <td style={{ whiteSpace: 'normal' }}><div className="row-wrap">
                      {papiery.map(d => <PapierChip key={d.key} p={d} z={z} zablokowany={!!busy} />)}
                      {saldo && <span className="row-wrap" style={{ gap: 6 }}>
                        <PapierChip p={saldo} z={z} zablokowany={!!busy} />
                        {saldo.doWszystkich && <span className="tag warn">do wydruku — brak WZ</span>}
                      </span>}
                      {!papiery.length && <span className="muted">{p.wz_status === 'do_wystawienia' ? 'czeka na wystawienie' : 'brak dokumentów'}</span>}
                      {p.wz.length > 0 && <button className="btn sm ghost" disabled={!!busy} onClick={() => setDopisz((p.wz.find(w => w.doc_series !== 'WM') ?? p.wz[0]).id)}
                        data-tip="Towar spoza zamówienia: z ręki (np. jogurt) albo z magazynu surowca (np. łój)" aria-label={`Dopisz pozycję — ${p.client_name || p.order_no}`}><ListPlus size={15} />Dopisz pozycję…</button>}
                    </div></td>
                  </tr>
                )
              })}</tbody>
            </table></div>
          </>}
        </div>
      </div>
      {dopisz && <DopiszPozycjeDialog wzId={dopisz} onClose={() => setDopisz(null)} onZmiana={() => void wczytaj()} />}
      {pytanie && !('blad' in wynik) && <Dialog title="Wystawić komplet dokumentów?" icon={<FileText size={20} />} onClose={() => setPytanie(false)}
        footer={<><button className="btn" onClick={() => setPytanie(false)} data-autofocus>Wróć</button><button className="btn primary" disabled={!!busy} onClick={() => void wystaw()}>{busy === 'wystaw' ? 'Wystawianie…' : 'Wystaw komplet'}</button></>}>
        <p>Dla {wynik.orders.length} {wynik.orders.length === 1 ? 'odbiorcy' : 'odbiorców'} powstaną WM/WZ, HDI i CMR.</p>
        <ul style={{ margin: 0, paddingLeft: 18 }}>{czekajace.map(p => { const d = decyzje[p.order_id] ?? PUSTA_DECYZJA; return <li key={p.order_id}><b>{p.client_name}</b>: {opisUkladu(p, d)}{d.hdiFv && uklad(p, d) !== 'wz' ? ' · HDI także do faktury' : ''}</li> })}</ul>
        <div className="note warn"><FlagIcon level="warn" size={15} /><div>WZ wewnętrzny (WM) <b>zdejmie towar ze stanu magazynu</b> — do tej chwili towar wyjechał, ale magazyn go jeszcze pokazuje.</div></div>
      </Dialog>}
    </>
  )
}

const opisUkladu = (p: PozycjaKursu, d: Decyzja) => {
  const u = uklad(p, d)
  const usluga = (p.kg_usluga ?? 0) > 0 ? ` · usługa ${kg(p.kg_usluga ?? 0)}: WM i HDI usługa` : ''
  if (tylkoUsluga(p)) return `sama usługa ${kg(p.kg_usluga ?? 0)} — WM, HDI usługa i CMR, bez WZ i faktury`
  if (u === 'fv') return `całość ${kg(kgSprzedazy(p))} na fakturę${usluga}`
  if (u === 'wz') return `całość ${kg(kgSprzedazy(p))} na WZ — bez dokumentów do faktury${usluga}`
  return `${kg(kgNaFakture(p, d))} na fakturę, ${kg(kgNaWz(p, d))} na WZ${usluga}`
}

/**
 * Jeden odbiorca kursu: szybki wybór (całość na fakturę / podział / całość na WZ)
 * i dwa połączone pola kg — wpis w jednym przelicza drugie z tego, co wyjechało.
 */
function KartaOdbiorcy({ p, d, zmien }: { p: PozycjaKursu; d: Decyzja; zmien: (d: Decyzja) => void }) {
  const kto = p.client_name ?? ''
  const u = uklad(p, d)
  const fv = kgNaFakture(p, d), wz = kgNaWz(p, d)
  const pole = (x: string, n: number) => (x.trim() === '' && d.kgFv.trim() === '' && d.kgWz.trim() === '' ? String(n).replace('.', ',') : x)
  const baza = kgSprzedazy(p), usluga = p.kg_usluga ?? 0
  const procFv = baza > 0 ? Math.min(100, Math.max(0, (fv / baza) * 100)) : 0
  const ustaw = (patch: Partial<Decyzja>) => zmien({ ...d, ...patch })
  const glowka = <div className="ko-h"><b>{p.client_name || '—'}</b><span className="muted">{p.order_no}</span>
    <span className="ko-kg">wyjechało <b>{kg(p.kg_zaladowane)}</b> · {num(p.zaladowano.length)} poz.
      {usluga > 0 && <> · <span className="tag info" data-tip="Towar usługobiorcy: WM i osobne HDI „usługa”, bez WZ i faktury">w tym usługa {kg(usluga)}</span></>}</span></div>
  if (tylkoUsluga(p)) return (
    <div className="box kurs-odb" aria-label={`Odbiorca ${kto}`}>
      {glowka}
      <div className="ko-f"><span className="muted ko-nota">Sama usługa: powstanie WM (zdejmuje stan), HDI usługa i CMR — bez WZ i dokumentów do faktury. Usługobiorca fakturuje swój towar sam.</span></div>
    </div>
  )
  return (
    <div className="box kurs-odb" aria-label={`Odbiorca ${kto}`}>
      {glowka}
      {usluga > 0 && <div className="faint ko-nota ko-usluga">Na fakturę i WZ dzielisz tylko sprzedaż: {kg(baza)}. Usługa {kg(usluga)} dostaje osobne HDI usługa.</div>}
      <div className="ko-podzial">
        <div className="seg" role="group" aria-label={`Faktura i WZ — ${kto}`}>
          <button type="button" aria-pressed={u === 'fv'} onClick={() => zmien(calosc(p, d, 'fv'))}>Całość na fakturę</button>
          <button type="button" aria-pressed={u === 'podzial'} onClick={() => { if (u !== 'podzial') zmien(wpiszKg(p, d, 'fv', String(Math.round(baza / 2)))) }}>Podział</button>
          <button type="button" aria-pressed={u === 'wz'} onClick={() => zmien(calosc(p, d, 'wz'))}>Całość na WZ</button>
        </div>
        <label className="fld ko-kgpole"><span className="label">Na fakturę</span>
          <span className="ko-in"><input className="field num" inputMode="decimal" value={pole(d.kgFv, baza)} onFocus={e => e.currentTarget.select()}
            onChange={e => zmien(wpiszKg(p, d, 'fv', e.target.value))} aria-label={`kg na fakturę, ${kto}`} /><span className="unit">kg</span></span></label>
        <label className="fld ko-kgpole"><span className="label">Na WZ</span>
          <span className="ko-in"><input className="field num" inputMode="decimal" value={pole(d.kgWz, 0)} onFocus={e => e.currentTarget.select()}
            onChange={e => zmien(wpiszKg(p, d, 'wz', e.target.value))} aria-label={`kg na WZ, ${kto}`} /><span className="unit">kg</span></span></label>
        <div className="ko-pasek" aria-hidden>
          <div className="ko-bar"><span className="ko-bar-fv" style={{ width: `${procFv}%` }} /></div>
          <div className="ko-bar-l"><span>faktura {kg(fv)}</span><span>WZ {kg(wz)}</span></div>
        </div>
      </div>
      <div className="ko-f">
        {u !== 'wz'
          ? <>
            <label className="fld"><span className="label">Nr faktury (CMR, pole 5)</span>
              <input className="field" value={d.fakturaNr} placeholder="FV 11/10/2026" onChange={e => ustaw({ fakturaNr: e.target.value })} aria-label={`Nr faktury, ${kto}`} /></label>
            <label className="ko-chk"><input type="checkbox" className="cbx" checked={d.hdiFv} onChange={e => ustaw({ hdiFv: e.target.checked })} />HDI także do faktury <span className="faint">(drugie, obok HDI na całość)</span></label>
          </>
          : <span className="muted ko-nota">Całość na WZ: powstanie WZ dla klienta, HDI i CMR na całość — bez dokumentów do faktury.</span>}
        {u === 'podzial' && <span className="faint ko-nota">Podział idzie pełnymi sztukami — na dokumentach może wyjść kilka kg inaczej.</span>}
      </div>
    </div>
  )
}
