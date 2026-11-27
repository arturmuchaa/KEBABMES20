import React, { useMemo, useState } from 'react'
import { ArrowRightLeft } from 'lucide-react'
import { Dialog, useApp } from '../../../shell/context'
import { useOrders } from '../../../data/store'
import { fmtDate, kg, num, palletKg, palletQty, PALLET_STATUS, type Order, type Pallet } from '../../../data/model'
import { FlagIcon } from '../../../ui/Glyphs'
import { ile } from '../../../data/tekst'
import { biuroApi } from '@/lib/api'

const isoDnia = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const dzienPo = (d?: Date) => { const x = d ? new Date(d) : new Date(); x.setDate(x.getDate() + 1); return isoDnia(x) }

/**
 * Przeniesienie CAŁYCH palet do innego zamówienia (właściciel 27.11.2026:
 * „YALCIN Z/7 — 21 palet, klient chce 16 na niedzielę, 5 zostaje na
 * poniedziałek”). Palety zachowują kartkę, karton, ważenie i miejsce
 * w mroźni; magazyn skanuje stare kartki. Domyślnie powstaje nowe zamówienie
 * z datą wyjazdu, można też dołożyć do otwartego zamówienia tego klienta.
 */
export function PrzeniesPaletyDialog({ order, pallets, inne, onClose }: {
  order: Order; pallets: Pallet[]
  /** Pozostałe zamówienia (dialog sam bierze otwarte zamówienia tego klienta). */
  inne: Order[]
  onClose: () => void
}) {
  const app = useApp()
  const { refresh } = useOrders()
  const [tryb, setTryb] = useState<'nowe' | 'istniejace'>('nowe')
  const [data, setData] = useState(dzienPo(order.delivery))
  const [cel, setCel] = useState('')
  const [busy, setBusy] = useState(false)
  const [blad, setBlad] = useState<string | null>(null)

  const cele = useMemo(() => inne
    .filter(o => o.id !== order.id && o.client.id === order.client.id && o.status !== 'done' && o.status !== 'cancelled')
    .sort((a, b) => (a.delivery?.getTime() ?? Infinity) - (b.delivery?.getTime() ?? Infinity)), [inne, order])
  const szt = pallets.reduce((s, p) => s + palletQty(p), 0)
  const masa = pallets.reduce((s, p) => s + palletKg(order, p), 0)
  const zostaje = order.pallets.length - pallets.length
  const mozna = !busy && pallets.length > 0 && (tryb === 'nowe' ? !!data : !!cel)
  const etykieta = `Przenieś ${ile(pallets.length, 'paletę', 'palety', 'palet')}`

  const przenies = async () => {
    if (!mozna) return
    setBusy(true); setBlad(null)
    try {
      const w = await biuroApi.przeniesPalety(order.id, {
        palletIds: pallets.map(p => p.id), ...(tryb === 'nowe' ? { newDeliveryDate: data } : { targetOrderId: cel }),
      })
      await refresh()
      app.toast({
        kind: 'ok', title: `Przeniesiono ${ile(pallets.length, 'paletę', 'palety', 'palet')} do ${w.targetOrderNo}`,
        detail: w.created ? 'Nowe zamówienie jest potwierdzone — kartki palet działają jak dotąd' : 'Kartki palet działają jak dotąd',
      })
      onClose()
    } catch (e) {
      setBlad(e instanceof Error ? e.message : 'Nie udało się przenieść palet')
    } finally { setBusy(false) }
  }

  return (
    <Dialog wide title="Przenieś palety do innego zamówienia" icon={<ArrowRightLeft size={20} color="var(--accent)" />}
      onClose={() => { if (!busy) onClose() }}
      footer={<>
        <span className="left muted">{order.no}: zostaje {ile(zostaje, 'paleta', 'palety', 'palet')}</span>
        <button className="btn" onClick={onClose} disabled={busy}>Anuluj</button>
        <button className="btn primary" data-autofocus disabled={!mozna} onClick={() => void przenies()}>{busy ? 'Przenoszę…' : etykieta}</button>
      </>}>
      <div className="pp-przen">
        <div className="pp-przen-sum">
          <b>{ile(pallets.length, 'paleta', 'palety', 'palet')} · {num(szt)} szt. · {kg(masa)}</b>
          <span className="muted"> z {order.no}</span>
        </div>
        <div className="pp-przen-pal">{[...pallets].sort((a, b) => a.no - b.no).map(p => (
          <span key={p.id} className="tag outline" data-tip={`karton ${p.carton} · ${PALLET_STATUS[p.status]}`}>
            <b>P{p.no}</b>&nbsp;{palletQty(p)} szt.{p.status === 'cold' ? ' · mroźnia' : ''}</span>
        ))}</div>

        <fieldset className="pp-przen-cel">
          <legend>Dokąd</legend>
          <label className="radio"><input type="radio" name="cel" checked={tryb === 'nowe'} onChange={() => setTryb('nowe')} />
            <span><b>Nowe zamówienie</b> {order.client.name} — data wyjazdu{' '}
              <input type="date" className="field" value={data} onChange={e => { setData(e.target.value); setTryb('nowe') }} aria-label="Data wyjazdu nowego zamówienia" /></span></label>
          <label className="radio"><input type="radio" name="cel" checked={tryb === 'istniejace'} onChange={() => setTryb('istniejace')} disabled={!cele.length} />
            <span><b>Istniejące zamówienie</b> {order.client.name}{!cele.length && <span className="muted"> — brak innych otwartych zamówień</span>}</span></label>
          {tryb === 'istniejace' && <div role="listbox" aria-label="Zamówienie docelowe" className="pp-przen-lista">
            {cele.map(o => (
              <button key={o.id} type="button" role="option" aria-selected={cel === o.id} className={`pp-przen-opt${cel === o.id ? ' sel' : ''}`} onClick={() => setCel(o.id)}>
                <b className="code">{o.no}</b><span className="muted">wyjazd {fmtDate(o.delivery)}</span><span className="grow" />
                <span className="muted tnum">{ile(o.pallets.length, 'paleta', 'palety', 'palet')}</span>
              </button>
            ))}
          </div>}
        </fieldset>

        <div className="note"><FlagIcon level="info" size={15} /><div>
          Kartki palet zostają — magazyn skanuje stare kartki, system sam wskaże nowe zamówienie. Ważenie z mroźni i miejsce w mroźni też zostają.
          Ilości: {order.no} maleje o to, co jest na paletach; {tryb === 'nowe' ? 'nowe zamówienie dostaje dokładnie zawartość palet' : 'w wybranym zamówieniu palety zajmą najpierw nierozpisaną ilość, nadwyżka się doliczy'}.
        </div></div>
        {blad && <div className="note crit" role="alert"><FlagIcon level="crit" size={15} /><div><b>Nie przeniesiono:</b> {blad}</div></div>}
      </div>
    </Dialog>
  )
}
