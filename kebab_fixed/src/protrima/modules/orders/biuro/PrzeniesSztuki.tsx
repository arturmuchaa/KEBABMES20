import React, { useEffect, useMemo, useState } from 'react'
import { ArrowRightLeft, Check, Search } from 'lucide-react'
import { Dialog, useApp } from '../../../shell/context'
import { useOrders } from '../../../data/store'
import { fmtDate, kg, num } from '../../../data/model'
import { FlagIcon } from '../../../ui/Glyphs'
import { dataZApi } from '../../../data/mapuj'
import { biuroApi, type CelPrzeniesienia, type PozycjaDoPrzeniesienia, type PrzeniesienieOpcje } from '@/lib/api'

const NOWA = ''
const opisPozycji = (p: Pick<PozycjaDoPrzeniesienia, 'productTypeName' | 'recipeName' | 'kgPerUnit' | 'packagingName'>) =>
  `${p.productTypeName ? `${p.productTypeName} ` : ''}${p.recipeName} ${num(p.kgPerUnit)} kg${p.packagingName ? ` · ${p.packagingName}` : ''}`
const takiSamWyrob = (a: PozycjaDoPrzeniesienia, b: PozycjaDoPrzeniesienia) =>
  a.recipeId === b.recipeId && a.productTypeId === b.productTypeId && Math.abs(a.kgPerUnit - b.kgPerUnit) < 0.0005

/** Pozycja docelowa podpowiadana dla sztuk z kartonu: ta sama tuleja, potem inna tuleja, inaczej nowa pozycja. */
export function podpowiedzCelu(src: PozycjaDoPrzeniesienia, cel: CelPrzeniesienia | undefined): string {
  const pasujace = (cel?.lines ?? []).filter(l => takiSamWyrob(src, l))
  return (pasujace.find(l => l.packagingId === src.packagingId) ?? pasujace[0])?.lineId ?? NOWA
}

/**
 * Przeniesienie sztuk z kartonu jednego zamówienia do zamówienia innego klienta
 * (właściciel 26.11.2026: KEVN potrzebował 5×15, 3×18 i 10×10 kg z gotowego
 * kartonu ALI GOLD w mroźni). Karton z mroźni wyjeżdża sam; przy każdym
 * przeniesieniu biuro decyduje, czy zamówienie źródłowe maleje, czy czeka na
 * dorobienie. W zamówieniu docelowym powstaje nowy karton z nowym numerem.
 */
export function PrzeniesSztukiDialog({ palletId, onClose }: { palletId: string; onClose: () => void }) {
  const app = useApp()
  const { refresh } = useOrders()
  const [opcje, setOpcje] = useState<PrzeniesienieOpcje | null>(null)
  const [cel, setCel] = useState('')
  const [q, setQ] = useState('')
  const [ile, setIle] = useState<Record<string, string>>({})
  const [celLinii, setCelLinii] = useState<Record<string, string>>({})
  const [tuleja, setTuleja] = useState<Record<string, boolean>>({})
  const [zrodlo, setZrodlo] = useState<'zmniejsz' | 'dorob' | ''>('')
  const [busy, setBusy] = useState(false)
  const [blad, setBlad] = useState<string | null>(null)
  const [tried, setTried] = useState(false)

  useEffect(() => {
    let zyje = true
    biuroApi.przeniesienieOpcje(palletId).then(o => zyje && setOpcje(o))
      .catch(e => zyje && setBlad(e instanceof Error ? e.message : 'Nie udało się wczytać kartonu'))
    return () => { zyje = false }
  }, [palletId])

  const celZam = opcje?.orders.find(o => o.orderId === cel)
  useEffect(() => {
    if (!opcje) return
    setCelLinii(Object.fromEntries(opcje.items.map(it => [it.lineId, podpowiedzCelu(it, celZam)])))
    setTuleja({})
  }, [cel]) // eslint-disable-line react-hooks/exhaustive-deps

  const widoczne = useMemo(() => {
    const t = q.trim().toLowerCase()
    return (opcje?.orders ?? []).filter(o => !t || `${o.orderNo} ${o.clientName}`.toLowerCase().includes(t))
  }, [opcje, q])

  const pozycje = (opcje?.items ?? []).map(it => {
    const n = Number((ile[it.lineId] ?? '').replace(',', '.'))
    const qty = Number.isFinite(n) ? n : NaN
    const docel = celZam?.lines.find(l => l.lineId === (celLinii[it.lineId] ?? NOWA))
    const blad = (ile[it.lineId] ?? '').trim() === '' || qty === 0 ? null
      : !Number.isInteger(qty) || qty < 0 ? 'Wpisz całą liczbę sztuk'
      : qty > it.qty ? `W kartonie jest ${it.qty} szt.`
      : docel && qty > docel.free ? `W pozycji docelowej wolne ${docel.free} szt. — zwiększ zamówienie albo wybierz „nowa pozycja”`
      : docel && docel.packagingId !== it.packagingId && !tuleja[it.lineId] ? 'Inna tuleja — zaznacz zmianę tulei albo wybierz „nowa pozycja”'
      : null
    return { it, qty: Number.isFinite(qty) && qty > 0 ? qty : 0, docel, blad }
  })
  const doPrzeniesienia = pozycje.filter(p => p.qty > 0)
  const bledy = pozycje.filter(p => p.blad)
  const wszystko = doPrzeniesienia.length > 0 && doPrzeniesienia.every(p => p.qty === p.it.qty) && doPrzeniesienia.length === pozycje.length
  const gotowe = !!cel && doPrzeniesienia.length > 0 && !bledy.length && !!zrodlo

  const zapisz = async () => {
    setTried(true)
    if (!gotowe || busy || !opcje) return
    setBusy(true); setBlad(null)
    try {
      const w = await biuroApi.przenies(palletId, {
        targetOrderId: cel, zrodlo: zrodlo as 'zmniejsz' | 'dorob',
        items: doPrzeniesienia.map(p => ({ lineId: p.it.lineId, qty: p.qty, targetLineId: celLinii[p.it.lineId] ?? NOWA, changePackaging: !!tuleja[p.it.lineId] })),
      })
      await refresh()
      app.toast({ kind: 'ok', title: `Przeniesiono do ${w.targetOrderNo} — nowy karton ${w.cartonNo}`,
        detail: w.sourceWithdrawnFromColdStorage ? `Karton ${w.sourceCartonNo} wycofany z mroźni — po zmianie zawartości zważ go ponownie przy wjeździe.` : undefined })
      onClose()
    } catch (e) { setBlad(e instanceof Error ? e.message : 'Serwer odmówił') } finally { setBusy(false) }
  }

  const sztuk = doPrzeniesienia.reduce((a, p) => a + p.qty, 0)
  const masa = doPrzeniesienia.reduce((a, p) => a + p.qty * p.it.kgPerUnit, 0)
  return (
    <Dialog xl title={opcje ? `Przenieś sztuki z kartonu ${opcje.cartonNo}` : 'Przenieś sztuki'} icon={<ArrowRightLeft size={20} color="var(--accent)" />} onClose={() => { if (!busy) onClose() }}
      footer={<><span className="left">{sztuk ? <>Przenosisz <b className="num">{num(sztuk)} szt.</b> · {kg(masa)}{celZam ? <> do <b>{celZam.orderNo}</b></> : null}</> : 'Wpisz, ile sztuk przenieść'}</span>
        <button className="btn" onClick={onClose} disabled={busy}>Anuluj</button>
        <button className="btn primary" onClick={() => void zapisz()} disabled={busy || !opcje}>{busy ? 'Zapisywanie…' : 'Przenieś sztuki'}</button></>}>
      {!opcje && !blad && <span className="muted">Wczytywanie…</span>}
      {opcje && <>
        <div className="box" style={{ padding: '8px 12px' }}><dl className="kv">
          <dt>Z zamówienia</dt><dd><b>{opcje.orderNo}</b> · {opcje.clientName}</dd>
          <dt>Karton</dt><dd><span className="code">{opcje.cartonNo}</span> · paleta {opcje.palletNo}</dd>
        </dl></div>
        {opcje.status === 'cold_storage' && <div className="note info"><FlagIcon level="info" size={15} /><div>Karton stoi w mroźni — po przeniesieniu sam z niej wyjedzie (zawartość się zmienia, ważenie traci ważność). Przy ponownym wjeździe zostanie zważony.</div></div>}

        <div style={{ display: 'grid', gridTemplateColumns: '250px minmax(0, 1fr)', gap: 16, alignItems: 'start' }}>
          <div>
            <span className="label">1. Do zamówienia</span>
            <div className="field-wrap search" style={{ margin: '4px 0 6px' }}>
              <Search size={15} />
              <input className="field" autoFocus placeholder="Klient albo numer zamówienia…" value={q} onChange={e => setQ(e.target.value)} aria-label="Szukaj zamówienia docelowego" />
            </div>
            <div className="box" style={{ maxHeight: 340, overflow: 'auto' }} role="listbox" aria-label="Zamówienie docelowe">
              {widoczne.length === 0 && <div className="empty" style={{ padding: 10 }}>Brak otwartych zamówień bez wystawionych dokumentów.</div>}
              {widoczne.map(o => (
                <div key={o.orderId} role="option" aria-selected={cel === o.orderId} tabIndex={0}
                  className={`row click${cel === o.orderId ? ' sel' : ''}`}
                  style={{ padding: '6px 10px', borderBottom: '1px solid var(--line)', borderLeft: `3px solid ${cel === o.orderId ? 'var(--accent)' : 'transparent'}`,
                    background: cel === o.orderId ? 'var(--accent-tint, var(--info-tint))' : undefined }}
                  onClick={() => setCel(o.orderId)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setCel(o.orderId) } }}>
                  <div className="strong" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>{cel === o.orderId && <Check size={14} color="var(--accent)" aria-hidden="true" />}{o.clientName}</div>
                  <div className="sub">{o.orderNo}{o.delivery ? ` · wyjazd ${fmtDate(dataZApi(o.delivery))}` : ''}</div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <span className="label">2. Ile sztuk i do której pozycji</span>
            <div className="box" style={{ marginTop: 4 }}>
              <table className="tbl">
                <thead><tr><th>W kartonie</th><th className="num" style={{ width: 56 }}>Jest</th><th className="num" style={{ width: 84 }}>Przenieś</th><th style={{ width: '42%' }}>Do pozycji{celZam ? ` w ${celZam.orderNo}` : ''}</th></tr></thead>
                <tbody>{pozycje.map(({ it, docel, blad: b }, i) => {
                  const pasujace = (celZam?.lines ?? []).filter(l => takiSamWyrob(it, l))
                  const innaTuleja = docel && docel.packagingId !== it.packagingId
                  return (
                    <React.Fragment key={it.lineId}>
                      <tr className="row editing">
                        <td style={{ whiteSpace: 'normal' }}><b>{it.recipeName} {num(it.kgPerUnit)} kg</b><span className="sub" style={{ display: 'block' }}>{it.productTypeName}{it.packagingName ? ` · ${it.packagingName}` : ''}</span></td>
                        <td className="num">{num(it.qty)}</td>
                        <td className="num"><input className={`field num${tried && b ? ' invalid' : ''}`} inputMode="numeric" placeholder="0" value={ile[it.lineId] ?? ''}
                          onChange={e => setIle(x => ({ ...x, [it.lineId]: e.target.value }))} aria-label={`Przenieś sztuk: ${opisPozycji(it)}`} autoFocus={i === 0 && !!cel} /></td>
                        <td style={{ whiteSpace: 'normal' }}>
                          <select className="field" style={{ width: '100%' }} disabled={!celZam} value={celLinii[it.lineId] ?? NOWA} onChange={e => setCelLinii(x => ({ ...x, [it.lineId]: e.target.value }))}
                            aria-label={`Pozycja docelowa: ${opisPozycji(it)}`}>
                            {!celZam && <option value="">najpierw wybierz zamówienie</option>}
                            {pasujace.map(l => <option key={l.lineId} value={l.lineId}>{l.packagingName || 'bez tulei'} — wolne {l.free} z {l.qty} szt.</option>)}
                            {celZam && <option value={NOWA}>nowa pozycja (dopisze się do zamówienia)</option>}
                          </select>
                          {innaTuleja && <label className="warn-ink" style={{ display: 'flex', gap: 6, alignItems: 'flex-start', marginTop: 4, fontSize: 'var(--fs-sm)' }}>
                            <input type="checkbox" className="cbx" style={{ marginTop: 2 }} checked={!!tuleja[it.lineId]} onChange={e => setTuleja(x => ({ ...x, [it.lineId]: e.target.checked }))}
                              aria-label={`zmień tuleję w tej pozycji na ${it.packagingName || '—'}`} />
                            <span>zamówiono {docel!.packagingName || '—'} — zmień tuleję w pozycji na {it.packagingName || '—'}</span>
                          </label>}
                        </td>
                      </tr>
                      {tried && b && <tr className="err-row"><td colSpan={4}><span className="crit-ink" style={{ fontSize: 'var(--fs-sm)' }}>{b}</span></td></tr>}
                    </React.Fragment>
                  )
                })}</tbody>
              </table>
            </div>

            <span className="label" style={{ display: 'block', marginTop: 12 }}>3. Co z zamówieniem {opcje.orderNo}?</span>
            <div className="seg" role="radiogroup" aria-label="Co z zamówieniem źródłowym" style={{ marginTop: 4 }}>
              <button role="radio" aria-checked={zrodlo === 'dorob'} aria-pressed={zrodlo === 'dorob'} onClick={() => setZrodlo('dorob')}>Zostaje — dorobimy brakujące sztuki</button>
              <button role="radio" aria-checked={zrodlo === 'zmniejsz'} aria-pressed={zrodlo === 'zmniejsz'} onClick={() => setZrodlo('zmniejsz')}>Zmniejsz zamówienie o te sztuki</button>
            </div>
            {tried && !zrodlo && <div className="crit-ink" style={{ fontSize: 'var(--fs-sm)', marginTop: 4 }}>Wybierz, co z zamówieniem źródłowym.</div>}
            {zrodlo === 'dorob' && <p className="muted" style={{ fontSize: 'var(--fs-sm)', margin: '6px 0 0' }}>{opcje.clientName} dalej czeka na te sztuki — plan produkcji pokaże je jako brak.</p>}
            {zrodlo === 'zmniejsz' && <p className="muted" style={{ fontSize: 'var(--fs-sm)', margin: '6px 0 0' }}>Pozycje zamówienia {opcje.orderNo} zmaleją o przeniesione sztuki.</p>}
          </div>
        </div>
        {wszystko && <div className="note warn"><FlagIcon level="warn" size={15} /><div>Przenosisz całą zawartość — karton {opcje.cartonNo} zostanie pusty (numer zostaje zablokowany).</div></div>}
        {tried && !cel && <div className="note crit"><FlagIcon level="crit" size={15} /><div>Wybierz zamówienie docelowe.</div></div>}
        {tried && cel && !doPrzeniesienia.length && <div className="note crit"><FlagIcon level="crit" size={15} /><div>Wpisz ilość przynajmniej dla jednej pozycji.</div></div>}
      </>}
      {blad && <div className="note crit" role="alert"><FlagIcon level="crit" size={15} /><div><b>Serwer odmówił:</b> {blad}</div></div>}
    </Dialog>
  )
}
