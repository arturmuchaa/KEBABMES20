import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Truck, FileDown, FileText, Check, X, RefreshCw, Download } from 'lucide-react'
import { useApp, CommandBar, Dialog, type Cmd } from '../../shell/context'
import { useOrders } from '../../data/store'
import { kg, num } from '../../data/model'
import { FlagIcon } from '../../ui/Glyphs'
import { carriersApi, downloadDocPdf, zaladunkiApi, type Carrier } from '@/lib/api'
import { INSTRUKCJE_DOMYSLNE } from '../orders/dokumenty/Cmr'
import {
  PUSTA_DECYZJA, doWystawienia, kgNaFakture, papieryPozycji, zamowieniaDoWystawienia,
  type Decyzja, type Kurs, type Transport,
} from './kurs'

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
  const wszystkiePapiery = useMemo(() => (kurs?.pozycje ?? []).flatMap(papieryPozycji), [kurs])

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
  const pobierz = async (url: string, plik: string, key: string) => {
    setBusy(key)
    try { await downloadDocPdf(url, plik) } catch (e) { app.toast({ kind: 'warn', title: 'Nie udało się pobrać PDF', detail: e instanceof Error ? e.message : '' }) }
    finally { setBusy(null) }
  }
  const pobierzWszystkie = async () => {
    setBusy('all')
    for (const d of wszystkiePapiery) {
      try { await downloadDocPdf(d.url, d.plik) } catch (e) { app.toast({ kind: 'warn', title: `Nie udało się pobrać ${d.etykieta} ${d.numer}`, detail: e instanceof Error ? e.message : '' }) }
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
    { id: 'all', group: 2, label: 'Pobierz wszystkie PDF', icon: <Download size={17} />, disabled: !!busy || !wszystkiePapiery.length, run: () => void pobierzWszystkie() },
    { id: 'printed', group: 2, label: kurs?.printed_at ? 'Oznaczony jako wydrukowany' : 'Wydrukowane — zdejmij z pulpitu', icon: <Check size={17} />, disabled: !!busy || !kurs || !!kurs.printed_at || czekajace.length > 0, tip: czekajace.length ? 'najpierw wystaw dokumenty' : undefined, run: () => void wydrukowane() },
    { id: 'reload', group: 3, label: 'Odśwież', icon: <RefreshCw size={17} />, opt: true, disabled: !!busy, run: () => void wczytaj() },
    { id: 'close', group: 3, label: 'Zamknij', icon: <X size={17} />, run: onDone },
  ], [czekajace.length, busy, wynik, wszystkiePapiery.length, kurs, wczytaj, onDone]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (active) setCmds(cmds) }, [cmds, setCmds, active])

  const ustaw = (orderId: string, patch: Partial<Decyzja>) => setDecyzje(s => ({ ...s, [orderId]: { ...(s[orderId] ?? PUSTA_DECYZJA), ...patch } }))
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
              <span className="sub">przy każdym odbiorcy wybierz, ile idzie na fakturę — reszta pójdzie na WZ</span></div>
            {czekajace.map(p => {
              const d = decyzje[p.order_id] ?? PUSTA_DECYZJA
              const naFv = kgNaFakture(p, d)
              return (
                <div key={p.order_id} className="box kurs-odb" aria-label={`Odbiorca ${p.client_name ?? ''}`}>
                  <div className="ko-h"><b>{p.client_name || '—'}</b><span className="muted">{p.order_no}</span>
                    <span className="ko-kg">wyjechało <b>{kg(p.kg_zaladowane)}</b> · {num(p.zaladowano.length)} poz.</span></div>
                  <div className="ko-f">
                    <div className="seg" role="group" aria-label={`Faktura — ${p.client_name ?? ''}`}>
                      <button type="button" aria-pressed={d.tryb === 'calosc'} onClick={() => ustaw(p.order_id, { tryb: 'calosc' })}>Całość na fakturę</button>
                      <button type="button" aria-pressed={d.tryb === 'podzial'} onClick={() => ustaw(p.order_id, { tryb: 'podzial' })}>Podział</button>
                    </div>
                    {d.tryb === 'podzial' && <label className="fld ko-kgfv"><span className="label">kg na fakturę</span>
                      <input className="field num" inputMode="decimal" value={d.kgFv} placeholder="0" onChange={e => ustaw(p.order_id, { kgFv: e.target.value })} aria-label={`kg na fakturę, ${p.client_name ?? ''}`} />
                      <span className="sub">reszta {kg(Math.max(0, p.kg_zaladowane - naFv))} na WZ</span></label>}
                    <label className="fld"><span className="label">Nr faktury (CMR, pole 5)</span>
                      <input className="field" value={d.fakturaNr} placeholder="FV 11/10/2026" onChange={e => ustaw(p.order_id, { fakturaNr: e.target.value })} aria-label={`Nr faktury, ${p.client_name ?? ''}`} /></label>
                    <label className="ko-chk"><input type="checkbox" className="cbx" checked={d.hdiFv} onChange={e => ustaw(p.order_id, { hdiFv: e.target.checked })} />HDI także do faktury <span className="faint">(drugie, obok HDI na całość)</span></label>
                  </div>
                </div>
              )
            })}
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
            <div className="sect-h"><h3>Dokumenty kursu</h3><span className="sub">PDF z serwera — ten sam wzór co w starym MES</span></div>
            <div className="box"><table className="tbl">
              <thead><tr><th>Odbiorca</th><th>Zamówienie</th><th className="num">Wyjechało</th><th>Dokumenty</th></tr></thead>
              <tbody>{kurs.pozycje.map((p, i) => {
                const papiery = papieryPozycji(p)
                return (
                  <tr key={p.order_id} className={`row${i % 2 ? ' zebra' : ''}`}>
                    <td className="strong">{p.client_name || '—'}{p.wz_status === 'rozjazd' && <span className="tag warn" style={{ marginLeft: 8 }}>rozjazd — sprawdź przed wydrukiem</span>}</td>
                    <td className="code">{p.order_no}</td>
                    <td className="num">{kg(p.kg_zaladowane)}</td>
                    <td style={{ whiteSpace: 'normal' }}><div className="row-wrap">
                      {papiery.map(d => <button key={d.key} className="btn sm" disabled={!!busy} onClick={() => void pobierz(d.url, d.plik, d.key)}>
                        <FileDown size={14} />{d.etykieta} <span className="code">{d.numer}</span></button>)}
                      {!papiery.length && <span className="muted">{p.wz_status === 'do_wystawienia' ? 'czeka na wystawienie' : 'brak dokumentów'}</span>}
                    </div></td>
                  </tr>
                )
              })}</tbody>
            </table></div>
          </>}
        </div>
      </div>
      {pytanie && !('blad' in wynik) && <Dialog title="Wystawić komplet dokumentów?" icon={<FileText size={20} />} onClose={() => setPytanie(false)}
        footer={<><button className="btn" onClick={() => setPytanie(false)} data-autofocus>Wróć</button><button className="btn primary" disabled={!!busy} onClick={() => void wystaw()}>{busy === 'wystaw' ? 'Wystawianie…' : 'Wystaw komplet'}</button></>}>
        <p>Dla {wynik.orders.length} {wynik.orders.length === 1 ? 'odbiorcy' : 'odbiorców'} powstaną WM/WZ, HDI i CMR.</p>
        <ul style={{ margin: 0, paddingLeft: 18 }}>{czekajace.map(p => { const d = decyzje[p.order_id] ?? PUSTA_DECYZJA; return <li key={p.order_id}><b>{p.client_name}</b>: {d.tryb === 'calosc' ? `całość ${kg(p.kg_zaladowane)} na fakturę` : `${kg(kgNaFakture(p, d))} na fakturę, reszta na WZ`}{d.hdiFv ? ' · HDI także do faktury' : ''}</li> })}</ul>
        <div className="note warn"><FlagIcon level="warn" size={15} /><div>WZ wewnętrzny (WM) <b>zdejmie towar ze stanu magazynu</b> — do tej chwili towar wyjechał, ale magazyn go jeszcze pokazuje.</div></div>
      </Dialog>}
    </>
  )
}
