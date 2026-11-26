import React, { useCallback, useEffect, useState } from 'react'
import { Truck, CheckCheck } from 'lucide-react'
import { Dialog, useApp } from '../../shell/context'
import { useOrders } from '../../data/store'
import { kg, num } from '../../data/model'
import { FlagIcon } from '../../ui/Glyphs'
import { biuroApi, type KursOtwarty, type PartialLoadingConfirmation, type WynikKursu } from '@/lib/api'
import { BrakiCzesciowe, WynikKursuNotka, czesciowe } from '../orders/biuro/kurs'

const kiedy = (iso: string | null) => {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

/**
 * Auta z załadowanym towarem, których kursu nikt nie zakończył na HMI
 * (właściciel 26.11.2026: GOLD-KEBAB/Z/5/11/26 „wisi w załadunku, ktoś na HMI
 * nie potwierdził”). Biuro kończy kurs samo — te same dokumenty co z HMI.
 * Pusta lista = nic się nie wyświetla.
 */
export function KursyNiezakonczone() {
  const [kursy, setKursy] = useState<KursOtwarty[]>([])
  const [zamknij, setZamknij] = useState<KursOtwarty | null>(null)
  const wczytaj = useCallback(() => { biuroApi.kursyOtwarte().then(setKursy).catch(() => { /* panel pomocniczy — błąd nie psuje pulpitu */ }) }, [])
  useEffect(() => {
    wczytaj()
    const t = window.setInterval(wczytaj, 60_000)
    return () => window.clearInterval(t)
  }, [wczytaj])
  if (!kursy.length) return null
  return (<>
    <div className="note warn" style={{ margin: '0 12px 10px' }} aria-label="Kursy niezakończone">
      <FlagIcon level="warn" size={16} />
      <div style={{ flex: 1 }}>
        <b>Załadowane, kurs niezakończony</b> — na HMI nikt nie nacisnął „Zakończ załadunek”, więc zamówień nie da się zamknąć.
        <table className="tbl" style={{ marginTop: 6, background: 'transparent' }}>
          <tbody>{kursy.map(k => (
            <tr key={k.vehicleId} className="row">
              <td className="strong" style={{ whiteSpace: 'nowrap' }}><Truck size={14} className="ico-inl" /> {k.name}{k.plate ? ` · ${k.plate}` : ''}</td>
              <td className="tnum muted" style={{ whiteSpace: 'nowrap' }}>od {kiedy(k.loadedSince)}</td>
              <td className="ell" style={{ maxWidth: 360 }}>{k.orders.map(o => o.clientName || o.orderNo).join(', ')}</td>
              <td className="num">{num(k.orders.reduce((a, o) => a + o.cartons.length, 0))} kart. · {kg(k.orders.reduce((a, o) => a + o.kg, 0))}</td>
              <td className="r"><button className="btn sm primary" onClick={() => setZamknij(k)}><CheckCheck size={14} />Zakończ kurs</button></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </div>
    {zamknij && <ZakonczKursDialog kurs={zamknij} onClose={() => { setZamknij(null); wczytaj() }} />}
  </>)
}

export function ZakonczKursDialog({ kurs, onClose }: { kurs: KursOtwarty; onClose: () => void }) {
  const app = useApp()
  const { refresh } = useOrders()
  const [busy, setBusy] = useState(false)
  const [blad, setBlad] = useState<string | null>(null)
  const [partial, setPartial] = useState<PartialLoadingConfirmation | null>(null)
  const [wynik, setWynik] = useState<WynikKursu | null>(null)
  const zakoncz = async (token?: string) => {
    if (busy) return
    setBusy(true); setBlad(null)
    try {
      const w = await biuroApi.zakonczKurs(kurs.vehicleId, token)
      setWynik(w); setPartial(null)
      await refresh()
      app.toast({ kind: 'ok', title: `Kurs ${kurs.plate || kurs.name} zakończony` })
    } catch (e) {
      const p = czesciowe(e)
      if (p) setPartial(p)
      else setBlad(e instanceof Error ? e.message : 'Serwer odmówił')
    } finally { setBusy(false) }
  }
  return (
    <Dialog title={`Zakończyć kurs — ${kurs.name}${kurs.plate ? ` · ${kurs.plate}` : ''}?`} icon={<Truck size={20} color="var(--accent)" />} onClose={() => { if (!busy) onClose() }}
      footer={wynik
        ? <button className="btn primary" onClick={onClose} data-autofocus>Zamknij</button>
        : <><button className="btn" onClick={onClose} disabled={busy} data-autofocus>Wróć</button>
          {partial
            ? <button className="btn primary" disabled={busy} onClick={() => void zakoncz(partial.confirmation_token)}>{busy ? 'Zapisywanie…' : 'Potwierdź wydanie częściowe'}</button>
            : <button className="btn primary" disabled={busy} onClick={() => void zakoncz()}>{busy ? 'Zapisywanie…' : 'Zakończ kurs'}</button>}</>}>
      {wynik ? <WynikKursuNotka w={wynik} /> : <>
        <p style={{ margin: 0 }}>Towar z tego auta zostanie oznaczony jako wysłany — tak jak po „Zakończ załadunek” na HMI. Dokumenty dla kierowcy wystawisz potem w „Kursy po załadunku”.</p>
        <div className="box">
          <table className="tbl">
            <thead><tr><th>Zamówienie</th><th>Klient</th><th>Kartony</th><th className="num">Sztuk</th><th className="num">Masa</th></tr></thead>
            <tbody>{kurs.orders.map(o => (
              <tr key={o.orderId} className="row">
                <td className="code">{o.orderNo}</td><td>{o.clientName}</td>
                <td className="code ell" style={{ maxWidth: 160 }}>{o.cartons.join(', ')}</td>
                <td className="num">{num(o.szt)}</td><td className="num">{kg(o.kg)}</td>
              </tr>))}</tbody>
          </table>
        </div>
        {partial && <BrakiCzesciowe p={partial} />}
        {blad && <div className="note crit" role="alert"><FlagIcon level="crit" size={15} /><div><b>Serwer odmówił:</b> {blad}</div></div>}
      </>}
    </Dialog>
  )
}
