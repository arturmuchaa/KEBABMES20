import { Truck, Check } from 'lucide-react'
import { useApp } from '../../shell/context'
import { useApi } from '@/hooks/useApi'
import { useLiveRefresh } from '@/hooks/useLiveRefresh'
import { biuroApi, type ZaladunekAuta } from '@/lib/api'
import { num } from '../../data/model'

const BEZ_RUCHU_MIN = 30
const godz = (iso: string) => new Date(iso).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })
const minOd = (iso: string) => Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000))
const czasTrwania = (min: number) => min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`

function Pasek({ tu, z, etykieta }: { tu: number; z: number; etykieta: string }) {
  const p = z > 0 ? Math.min(100, tu / z * 100) : 0
  return <span className="zl-pasek" role="progressbar" aria-label={etykieta} aria-valuemin={0} aria-valuemax={z} aria-valuenow={tu}><i style={{ width: `${p}%` }} /></span>
}

/**
 * Pulpit: auta, które się TERAZ ładują — postęp palet i kg, zamówienia i klienci.
 * Chowa się, gdy nic się nie ładuje; odświeża co 15 s, gdy Pulpit jest aktywny.
 */
export function ZaladunekNaZywo({ active }: { active: boolean }) {
  const res = useApi(() => biuroApi.zaladunekNaZywo())
  useLiveRefresh(active ? { res } : {}, 15_000)
  const auta = res.data ?? []
  if (!auta.length) return null
  return (
    <section className="panel p-load" aria-label="Załadunek na żywo">
      <div className="panel-h"><h2>Załadunek na żywo</h2><span className="sub">{auta.length === 1 ? '1 auto' : `${auta.length} aut`} w trakcie · odświeżane co 15 s</span></div>
      <div className="zl-auta">{auta.map(a => <Auto key={a.vehicleId} a={a} />)}</div>
    </section>
  )
}

function Auto({ a }: { a: ZaladunekAuta }) {
  const app = useApp()
  const bezRuchu = a.lastLoadedAt && minOd(a.lastLoadedAt) > BEZ_RUCHU_MIN
  return (
    <article className="zl-auto" aria-label={`Auto ${a.plate}`}>
      <header className="zl-h">
        <Truck size={16} aria-hidden /><b className="code">{a.plate}</b><span className="faint">{a.name}</span>
        <span className="zl-od">{a.startedAt ? `ładuje od ${godz(a.startedAt)} (${czasTrwania(minOd(a.startedAt))})` : 'czeka na pierwszą paletę'}</span>
      </header>
      <div className="zl-suma">
        <Pasek tu={a.unitsLoaded} z={a.unitsToLoad} etykieta={`Palety auta ${a.plate}`} />
        <span className="zl-liczby"><b>{`${a.unitsLoaded} / ${a.unitsToLoad}`}</b> palet · {num(a.kgLoaded)} / {num(a.kgToLoad)} kg</span>
      </div>
      <ol className="zl-zam">{a.orders.map(o => {
        const doZal = o.unitsTotal - o.unitsShippedBefore
        return (
          <li key={o.orderId}>
            <button type="button" className="zl-nr" onClick={() => app.openOrder(o.orderId)}>{o.orderNo}</button>
            <span className="zl-klient ell">{o.clientShortName || o.clientName}</span>
            <Pasek tu={o.unitsHere} z={doZal} etykieta={`Palety ${o.orderNo}`} />
            <span className="zl-liczby">{`${o.unitsHere} / ${doZal}`}</span>
            {o.complete ? <Check size={15} className="ok-ink" aria-label="komplet" /> : <span className="zl-nic" />}
            {o.unitsShippedBefore > 0 && <span className="faint zl-wcz">{`+${o.unitsShippedBefore} wysłane wcześniej`}</span>}
          </li>
        )
      })}</ol>
      {a.lastLoadedAt && <footer className={`zl-stopka${bezRuchu ? ' faint' : ''}`}>{bezRuchu ? `bez ruchu od ${godz(a.lastLoadedAt)}` : `ostatnia paleta ${godz(a.lastLoadedAt)}`}</footer>}
    </article>
  )
}
