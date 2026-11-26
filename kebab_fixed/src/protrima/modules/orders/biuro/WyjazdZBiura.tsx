import React, { useEffect, useMemo, useState } from 'react'
import { Truck } from 'lucide-react'
import { Dialog, useApp } from '../../../shell/context'
import { useOrders } from '../../../data/store'
import { kg, num, type Order } from '../../../data/model'
import { FlagIcon } from '../../../ui/Glyphs'
import { biuroApi, vehiclesApi, type KartonDoWyjazdu, type PartialLoadingConfirmation, type Vehicle, type WynikKursu } from '@/lib/api'
import { BrakiCzesciowe, WynikKursuNotka, czesciowe } from './kurs'

/** Stany z serwera (nie z widoku PROTRIMA — tam mroźnia to „cold”). */
const STAN: Record<string, string> = { created: 'Rozpisana, na hali', packing: 'W pakowaniu', packed: 'Spakowana', cold_storage: 'W mroźni', loaded: 'Na aucie' }

/**
 * Wyjazd kartonem prosto z biura (właściciel 26.11.2026): biuro wybiera auto
 * i kartony zamówienia, serwer kładzie je na auto i od razu zamyka kurs — te
 * same skany i dokumenty co na HMI, tylko bez skanera. Gdy serwer odmówi,
 * kartony schodzą z auta (nic nie zostaje w pół drogi).
 */
export function WyjazdZBiuraDialog({ order, onClose }: { order: Order; onClose: () => void }) {
  const app = useApp()
  const { refresh } = useOrders()
  const [kartony, setKartony] = useState<KartonDoWyjazdu[] | null>(null)
  const [auta, setAuta] = useState<Vehicle[]>([])
  const [auto, setAuto] = useState('')
  const [zazn, setZazn] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [blad, setBlad] = useState<string | null>(null)
  const [partial, setPartial] = useState<PartialLoadingConfirmation | null>(null)
  const [wynik, setWynik] = useState<WynikKursu | null>(null)

  useEffect(() => {
    let zyje = true
    Promise.all([biuroApi.kartonyDoWyjazdu(order.id), vehiclesApi.list()]).then(([k, v]) => {
      if (!zyje) return
      setKartony(k)
      setAuta(v.filter(a => a.active))
      // Domyślnie: wszystko, co nie stoi na innym aucie. Auto — to, na którym już coś stoi.
      const naAucie = k.find(x => x.vehicleId)?.vehicleId ?? ''
      setAuto(naAucie)
      setZazn(k.filter(x => !x.vehicleId || x.vehicleId === naAucie).map(x => x.id))
    }).catch(e => zyje && setBlad(e instanceof Error ? e.message : 'Nie udało się wczytać kartonów'))
    return () => { zyje = false }
  }, [order.id])

  const wybrane = useMemo(() => (kartony ?? []).filter(k => zazn.includes(k.id)), [kartony, zazn])
  const obce = wybrane.filter(k => k.vehicleId && auto && k.vehicleId !== auto)
  const gotowe = !!auto && wybrane.length > 0 && obce.length === 0

  const wyslij = async (potwierdzenie?: string) => {
    if (!gotowe || busy) return
    setBusy(true); setBlad(null)
    try {
      const w = await biuroApi.wyjazd(order.id, auto, wybrane.map(k => k.id), potwierdzenie)
      setWynik(w); setPartial(null)
      await refresh()
      app.toast({ kind: 'ok', title: `Wyjazd zapisany — ${order.no}` })
    } catch (e) {
      const p = czesciowe(e)
      if (p) setPartial(p)
      else setBlad(e instanceof Error ? e.message : 'Serwer odmówił')
    } finally { setBusy(false) }
  }

  const nazwaAuta = (id: string | null) => { const a = auta.find(x => x.id === id); return a ? `${a.name}${a.plate ? ` · ${a.plate}` : ''}` : 'inne auto' }
  return (
    <Dialog wide title={`Wyjazd z biura — ${order.no}`} icon={<Truck size={20} color="var(--accent)" />} onClose={() => { if (!busy) onClose() }}
      footer={wynik
        ? <button className="btn primary" onClick={onClose} data-autofocus>Zamknij</button>
        : <><span className="left">{wybrane.length ? <>{num(wybrane.length)} {wybrane.length === 1 ? 'karton' : 'kartonów'} · <b className="num">{num(wybrane.reduce((a, k) => a + k.szt, 0))} szt.</b> · {kg(wybrane.reduce((a, k) => a + k.kg, 0))}</> : 'Nic nie zaznaczono'}</span>
          <button className="btn" onClick={onClose} disabled={busy}>Anuluj</button>
          {partial
            ? <button className="btn primary" disabled={busy} onClick={() => void wyslij(partial.confirmation_token)}>{busy ? 'Zapisywanie…' : 'Potwierdź wydanie częściowe'}</button>
            : <button className="btn primary" disabled={busy || !gotowe} onClick={() => void wyslij()}>{busy ? 'Zapisywanie…' : 'Załaduj i zakończ kurs'}</button>}</>}>
      {wynik ? <WynikKursuNotka w={wynik} /> : <>
        <p className="muted" style={{ margin: 0, fontSize: 'var(--fs-sm)' }}>Kartony trafią na wybrane auto i kurs zostanie od razu zakończony — jak po „Zakończ załadunek” na HMI. Karton z mroźni z niej wyjeżdża.</p>
        <label className="label" htmlFor="wyjazd-auto">Auto</label>
        <select id="wyjazd-auto" className="field" value={auto} onChange={e => { setAuto(e.target.value); setPartial(null) }} disabled={busy}>
          <option value="">— wybierz auto —</option>
          {auta.map(a => <option key={a.id} value={a.id}>{a.name}{a.plate ? ` · ${a.plate}` : ''}</option>)}
        </select>
        <div className="box">
          <table className="tbl">
            <thead><tr><th style={{ width: 36 }} /><th>Karton</th><th>Gdzie jest</th><th className="num">Sztuk</th><th className="num">Masa</th></tr></thead>
            <tbody>
              {kartony === null && !blad && <tr><td colSpan={5}><span className="muted">Wczytywanie…</span></td></tr>}
              {kartony?.length === 0 && <tr><td colSpan={5}><span className="muted">Wszystkie kartony tego zamówienia już wyjechały albo nie ma rozpisu.</span></td></tr>}
              {kartony?.map(k => {
                const on = zazn.includes(k.id)
                return (
                  <tr key={k.id} className="row click" onClick={() => { if (busy) return; setPartial(null); setZazn(z => on ? z.filter(x => x !== k.id) : [...z, k.id]) }}>
                    <td><input type="checkbox" className="cbx" checked={on} readOnly aria-label={`Karton ${k.cartonNo}`} /></td>
                    <td><b className="code">{k.cartonNo}</b>{k.palletNo ? <span className="sub"> · paleta {k.palletNo}</span> : <span className="sub"> · karton magazynowy</span>}</td>
                    <td>{k.vehicleId ? <span className={k.vehicleId === auto ? 'tag info' : 'tag warn'}>na aucie {nazwaAuta(k.vehicleId)}</span> : (STAN[k.status] ?? k.status)}</td>
                    <td className="num">{num(k.szt)}</td>
                    <td className="num">{kg(k.kg)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {obce.length > 0 && <div className="note warn"><FlagIcon level="warn" size={15} /><div>Kartony {obce.map(k => k.cartonNo).join(', ')} stoją na innym aucie — odznacz je albo wybierz tamto auto.</div></div>}
        {partial && <BrakiCzesciowe p={partial} />}
        {blad && <div className="note crit" role="alert"><FlagIcon level="crit" size={15} /><div><b>Serwer odmówił:</b> {blad}</div></div>}
      </>}
    </Dialog>
  )
}
