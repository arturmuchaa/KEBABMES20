import React, { useRef, useState } from 'react'
import { PackageCheck, Unlink, RefreshCw, Ban } from 'lucide-react'
import { useApp, Dialog } from '../../../shell/context'
import { useOrders } from '../../../data/store'
import { kg, num, type Order } from '../../../data/model'
import { FlagIcon } from '../../../ui/Glyphs'
import { useApi } from '@/hooks/useApi'
import { clientOrdersApi, type StockCartonOption, type StockCartonOptions } from '@/lib/api'
import { formatCartonNo } from '@/lib/unitLocation'

const nr = (c: StockCartonOption) => formatCartonNo(c.cartonNo) || '—'
const masa = (c: StockCartonOption) => c.lines.reduce((s, l) => s + l.packedQty * l.kgPerUnit, 0)
const stan = (c: StockCartonOption) => c.shipped ? 'Wydany' : c.loaded ? 'Na aucie' : c.inColdStorage ? 'W mroźni' : c.scannerless ? 'Bez skanowania sztuk' : `Spakowano ${c.packedQty}/${c.targetQty} szt.`

/**
 * „Kartony z magazynu” — jedyny RĘCZNY przydział wyrobu do zamówienia w MES
 * (stock_cartons → linked_order). Te same zasady co stara sekcja
 * features/finished-goods/components/StockCartonSuggestions.tsx:
 * przegląd z serwera (przypisane / dostępne / niedostępne z powodem),
 * przypisanie jawnym przyciskiem pojedynczo, odłączenie z potwierdzeniem i tylko
 * gdy serwer pozwala (canDetach), zamknięte zamówienie — tylko podgląd.
 * Pokrycie wyrobem luzem liczy serwer sam (stempel, zapas klienta, FEFO).
 */
export function KartonyZMagazynu({ order }: { order: Order }) {
  const app = useApp()
  const { refresh } = useOrders()
  const { data, loading, error, refetch } = useApi<StockCartonOptions>(() => clientOrdersApi.stockCartonOptions(order.id), [order.id])
  const lock = useRef(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [blad, setBlad] = useState<string | null>(null)
  const [odlacz, setOdlacz] = useState<StockCartonOption | null>(null)
  const zamkniete = ['done', 'cancelled'].includes(data?.orderStatus || order.status)
  const blokada = zamkniete ? `Zamówienie jest ${order.status === 'done' || data?.orderStatus === 'done' ? 'zrealizowane' : 'anulowane'} — kartonów nie przypisuje się ani nie odłącza.` : data?.assignBlockedReason ?? null

  const zmien = async (kind: 'assign' | 'detach', c: StockCartonOption) => {
    if (lock.current || zamkniete) return
    if (kind === 'assign' && blokada) return
    if (kind === 'detach' && !c.canDetach) return
    lock.current = true; setBusy(c.cartonId); setBlad(null)
    try {
      if (kind === 'assign') await clientOrdersApi.assignStockCarton(order.id, c.cartonId)
      else await clientOrdersApi.detachStockCarton(order.id, c.cartonId)
      app.toast({ kind: 'ok', title: kind === 'assign' ? `Przypisano karton ${nr(c)}` : `Odłączono karton ${nr(c)}`,
        detail: kind === 'assign' ? `${c.units} szt. — dodaj zamówienie do auta i skanuj dotychczasową etykietę kartonu.` : 'Karton i towar zostają na magazynie.' })
      setOdlacz(null)
      await Promise.all([refetch(), refresh().catch(() => undefined)])
    } catch (e) {
      setBlad(`Nie udało się ${kind === 'assign' ? 'przypisać' : 'odłączyć'} kartonu ${nr(c)}: ${e instanceof Error ? e.message : 'nieznany błąd'}`)
    } finally { lock.current = false; setBusy(null) }
  }

  const wiersz = (c: StockCartonOption, akcja: React.ReactNode) => (
    <tr key={c.cartonId} className="row">
      <td className="code strong">{nr(c)}</td>
      <td>{c.lines.map((l, i) => <div key={i}><b>{l.recipeName} {num(l.kgPerUnit)} kg</b> × {l.packedQty}{l.targetQty && l.targetQty !== l.packedQty ? <span className="muted"> (spakowano z {l.targetQty})</span> : null}<span className="sub" style={{ display: 'inline', marginLeft: 6 }}>{[l.productTypeName, l.packagingName].filter(Boolean).join(' · ')}</span></div>)}</td>
      <td className="num">{num(c.units)} szt.<span className="sub">{kg(masa(c))}</span></td>
      <td className="hide-m">{c.generic ? <span className="muted">na magazyn</span> : c.clientName}</td>
      <td>{stan(c)}</td>
      <td className="r">{akcja}</td>
    </tr>
  )

  return (
    <>
      <div className="sect-h"><h3>Kartony z magazynu</h3>
        <span className="sub">spakowane kartony przypisywane ręcznie do zamówienia</span>
        <div className="tools"><button className="btn sm ghost" onClick={() => void refetch()} disabled={!!busy}><RefreshCw size={14} />Odśwież</button></div>
      </div>
      {loading && !data && <div className="note">Szukam kartonów z magazynu…</div>}
      {error && <div className="note crit" role="alert"><FlagIcon level="crit" size={15} /><div>Nie udało się pobrać listy kartonów: {error}. Lista jest ukryta, dopóki nie uda się jej pobrać.</div></div>}
      {blad && <div className="note crit" role="alert"><FlagIcon level="crit" size={15} /><div>{blad}</div></div>}
      {data && !error && <>
        {blokada && <div className="note warn"><FlagIcon level="warn" size={15} /><div>{blokada}</div></div>}
        {data.assigned.length > 0 && <div className="box"><table className="tbl">
          <thead><tr><th colSpan={6}>Przypisane do tego zamówienia — {data.assignedTotals.cartons} kart. · {num(data.assignedTotals.units)} szt.</th></tr></thead>
          <tbody>{data.assigned.map(c => wiersz(c, !zamkniete && (c.canDetach
            ? <button className="btn sm danger" disabled={!!busy} onClick={() => setOdlacz(c)}><Unlink size={14} />Odłącz</button>
            : <span className="muted" style={{ fontSize: 'var(--fs-sm)' }} data-tip={c.detachBlockedReason ?? ''}>nie można odłączyć</span>)))}</tbody>
        </table></div>}
        {!zamkniete && <div className="box"><table className="tbl">
          <thead><tr><th colSpan={6}>Dostępne dla tego zamówienia ({data.available.length})</th></tr></thead>
          <tbody>
            {data.available.length === 0 && <tr><td colSpan={6}><div className="empty">Brak spakowanych kartonów pasujących do pozycji tego zamówienia.</div></td></tr>}
            {data.available.map(c => wiersz(c, <button className="btn sm primary" disabled={!!busy || !!blokada} onClick={() => zmien('assign', c)}>
              <PackageCheck size={14} />{busy === c.cartonId ? 'Przypisywanie…' : 'Przypisz'}</button>))}
          </tbody>
        </table></div>}
        {!zamkniete && data.unavailable.length > 0 && <details className="box" style={{ padding: '8px 12px' }}>
          <summary className="muted" style={{ cursor: 'pointer' }}><Ban size={13} style={{ verticalAlign: -2 }} /> Kartony niedostępne dla tego zamówienia ({data.unavailable.length})</summary>
          <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>{data.unavailable.map(c => <li key={c.cartonId} style={{ fontSize: 'var(--fs-sm)' }}><span className="code">{nr(c)}</span> — {c.reason || 'powód nieznany'}</li>)}</ul>
        </details>}
        {zamkniete && data.assigned.length === 0 && <div className="note">Do tego zamówienia nie przypisano kartonów magazynowych.</div>}
      </>}
      {odlacz && <Dialog title={`Odłączyć karton ${nr(odlacz)}?`} icon={<Unlink size={20} color="var(--warn)" />} onClose={() => { if (!busy) setOdlacz(null) }}
        footer={<><button className="btn" onClick={() => setOdlacz(null)} data-autofocus disabled={!!busy}>Wróć</button>
          <button className="btn primary" disabled={!!busy} onClick={() => zmien('detach', odlacz)}>{busy ? 'Odłączanie…' : 'Odłącz karton'}</button></>}>
        <p>{num(odlacz.units)} szt. · {kg(masa(odlacz))}. Karton i towar zostają na magazynie i będzie można przypisać je ponownie.</p>
      </Dialog>}
    </>
  )
}
