import React, { useEffect, useMemo, useState } from 'react'
import { PackagePlus, Printer, RefreshCw, Search, Trash2 } from 'lucide-react'
import { CommandBar, Dialog, Menu, useApp, wierszMenu, type Cmd } from '../../../shell/context'
import { FlagIcon } from '../../../ui/Glyphs'
import { SzkieletWierszy } from '../../../ui/Szkielet'
import { Pusto } from '../../../ui/Pusto'
import { fmtDate, num } from '../../../data/model'
import { dataZApi } from '../../../data/mapuj'
import { stockCartonsApi, type StockCarton } from '@/lib/api'
import { useClientNames } from '@/lib/clientNames'
import { STAN_KARTONU, nrKartonu, skladKartonu, stanKartonu, type StanKartonu } from './model'

type Filtr = 'wszystkie' | StanKartonu
const FILTRY: Array<{ v: Filtr; t: string }> = [
  { v: 'wszystkie', t: 'Wszystkie' }, { v: 'pusty', t: 'Do zapakowania' }, { v: 'pakowany', t: 'W pakowaniu' }, { v: 'spakowany', t: 'Spakowane' },
]
const TAG: Record<StanKartonu, string> = { pusty: 'warn', pakowany: 'info', spakowany: 'ok' }

/**
 * Kartony magazynowe w Wyrobie gotowym — wszystkie kartony biura ze stanem
 * pakowania; karton znika, gdy jego sztuki wyjadą (lista z serwera).
 * Kosz tylko przy kartonie bez żadnej sztuki: karton ze sztuką niesie śledzenie
 * partii — serwer i tak go nie usunie (25.09.2026).
 */
export function KartonyMagazynowe({ widoki, active, setCmds, setCtx, kartony, ladowanie, blad, odswiez, wybrany, setWybrany, onNowy, onKartka }: {
  widoki: React.ReactNode; active: boolean; setCmds: (c: Cmd[]) => void; setCtx: (n: React.ReactNode) => void
  kartony: StockCarton[]; ladowanie: boolean; blad: string | null; odswiez: () => void
  wybrany: string | null; setWybrany: (id: string | null) => void; onNowy: () => void; onKartka: (c: StockCarton) => void
}) {
  const app = useApp()
  const klientNa = useClientNames()
  const [filtr, setFiltr] = useState<Filtr>('wszystkie')
  const [q, setQ] = useState('')
  const [usun, setUsun] = useState<StockCarton | null>(null)
  const [usuwam, setUsuwam] = useState(false)
  const [ctxMenu, setCtxMenu] = useState<{ id: string; anchor: Element } | null>(null)

  const liczby = useMemo(() => {
    const n: Record<Filtr, number> = { wszystkie: kartony.length, pusty: 0, pakowany: 0, spakowany: 0 }
    kartony.forEach(c => { n[stanKartonu(c)]++ })
    return n
  }, [kartony])
  const widoczne = useMemo(() => {
    const t = q.trim().toLowerCase()
    return kartony.filter(c => (filtr === 'wszystkie' || stanKartonu(c) === filtr)
      && (!t || [nrKartonu(c), c.clientName, klientNa(c.clientName), skladKartonu(c), c.linkedOrderNo ?? '', ...c.lines.map(l => l.recipeName)].join(' ').toLowerCase().includes(t)))
  }, [kartony, filtr, q, klientNa])
  const wyb = kartony.find(c => c.id === wybrany) ?? null

  const usunTeraz = async () => {
    if (!usun || usuwam) return
    setUsuwam(true)
    try {
      await stockCartonsApi.removeEmpty(usun.id)
      app.toast({ kind: 'ok', title: `Usunięto pusty karton ${nrKartonu(usun)}` })
      if (wybrany === usun.id) setWybrany(null)
      setUsun(null); odswiez()
    } catch (e) {
      app.toast({ kind: 'warn', title: 'Nie usunięto kartonu', detail: e instanceof Error ? e.message : '' })
    } finally { setUsuwam(false) }
  }

  const cmds = useMemo<Cmd[]>(() => [
    { id: 'new', group: 1, label: 'Nowy karton', icon: <PackagePlus size={17} />, primary: true, run: onNowy },
    { id: 'print', group: 2, label: 'Kartka kartonu', icon: <Printer size={17} />, kbd: 'Ctrl+P', disabled: !wyb, run: () => wyb && onKartka(wyb) },
    { id: 'delete', group: 9, label: 'Usuń pusty karton…', icon: <Trash2 size={15} />, menuOnly: true, danger: true, disabled: !wyb || wyb.packedQty > 0,
      tip: wyb && wyb.packedQty > 0 ? 'karton ze sztukami niesie śledzenie partii — nie usuwa się go' : undefined, run: () => wyb && setUsun(wyb) },
    { id: 'refresh', group: 3, label: 'Odśwież', icon: <RefreshCw size={17} />, opt: true, run: odswiez },
  ], [wyb, onNowy, onKartka, odswiez])
  useEffect(() => { if (active) setCmds(cmds) }, [active, cmds, setCmds])
  useEffect(() => {
    if (!active) return
    setCtx(<span>Kartony magazynowe <b>{liczby.wszystkie}</b> · do zapakowania <b>{liczby.pusty}</b> · w pakowaniu <b>{liczby.pakowany}</b> · spakowane <b>{liczby.spakowany}</b></span>)
  }, [active, liczby, setCtx])

  const onKey = (e: React.KeyboardEvent) => {
    const i = widoczne.findIndex(c => c.id === wybrany)
    if (e.key === 'ArrowDown') { e.preventDefault(); const c = widoczne[Math.min(widoczne.length - 1, i + 1)]; if (c) setWybrany(c.id) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); const c = widoczne[Math.max(0, i - 1)]; if (c) setWybrany(c.id) }
    else if (e.key === 'Enter' && wyb) { e.preventDefault(); onKartka(wyb) }
  }

  return (
    <>
      <CommandBar title="Wyrób gotowy" count={`${liczby.wszystkie} kartonów magazynowych`} cmds={cmds} />
      <div className="toolbar" role="toolbar" aria-label="Widoki i filtry">
        {widoki}
        <span className="vsep" />
        <div className="seg" role="group" aria-label="Stan kartonów">
          {FILTRY.map(f => <button key={f.v} aria-pressed={filtr === f.v} onClick={() => setFiltr(f.v)}>{f.t}<span className="count">{liczby[f.v]}</span></button>)}
        </div>
        <div className="field-wrap search">
          <Search size={15} />
          <input className="field" placeholder="Numer kartonu, klient, receptura, zamówienie…" value={q} onChange={e => setQ(e.target.value)} aria-label="Szukaj kartonu" />
        </div>
      </div>
      <div className="workarea">
        <div className="list-pane">
          <div className="tbl-wrap" tabIndex={0} onKeyDown={onKey} aria-label="Lista kartonów magazynowych"
            onContextMenu={e => { const w = wierszMenu(e); if (w) { setWybrany(w.id); setCtxMenu(w) } }}>
            {blad && <div className="note crit" role="alert" style={{ margin: 12 }}><FlagIcon level="crit" size={15} /><div>Nie udało się pobrać kartonów: {blad}</div></div>}
            <table className="tbl" role="grid">
              <thead><tr>
                <th style={{ width: 96 }}>Karton</th><th>Klient</th><th>Skład</th><th className="num" style={{ width: 150 }}>Spakowano</th>
                <th style={{ width: 130 }}>Stan</th><th>Zamówienie</th><th className="num hide-m" style={{ width: 110 }}>Utworzono</th>
              </tr></thead>
              <tbody>
                {ladowanie && !kartony.length && <SzkieletWierszy kolumny={7} wiersze={6} />}
                {!(ladowanie && !kartony.length) && !widoczne.length && <tr><td colSpan={7} style={{ height: 'auto' }}>
                  <Pusto ikona={<PackagePlus size={20} />} tytul={kartony.length ? 'Żaden karton nie pasuje do filtrów' : 'Brak kartonów magazynowych'}
                    akcja={kartony.length ? <button className="btn sm" onClick={() => { setFiltr('wszystkie'); setQ('') }}>Pokaż wszystkie</button> : <button className="btn sm primary" onClick={onNowy}><PackagePlus size={15} />Nowy karton</button>}>
                    {kartony.length ? 'Zmień stan albo wyczyść wyszukiwanie.' : 'Karton magazynowy to jednostka pakowa bez zamówienia — dla klienta albo na magazyn. Magazyn skanuje do niego sztuki, a zamówienie przypina się później.'}
                  </Pusto></td></tr>}
                {widoczne.map((c, i) => {
                  const st = stanKartonu(c)
                  const proc = c.targetQty ? Math.min(100, Math.round((c.packedQty / c.targetQty) * 100)) : 0
                  return (
                    <tr key={c.id} data-id={c.id} className={`row click${i % 2 ? ' zebra' : ''}${wybrany === c.id ? ' sel' : ''}`} aria-selected={wybrany === c.id}
                      onClick={() => setWybrany(c.id)} onDoubleClick={() => onKartka(c)}>
                      <td className="strong code">{nrKartonu(c)}</td>
                      <td>{c.clientName ? klientNa(c.clientName) : <span className="muted">na magazyn</span>}</td>
                      <td className="ell" style={{ maxWidth: 380 }} title={skladKartonu(c)}>{skladKartonu(c)}{c.lines.length > 1 && <span className="tag info" style={{ marginLeft: 8 }}>mieszany</span>}</td>
                      <td className="num"><span className="karton-meter" aria-hidden><i style={{ width: `${proc}%` }} /></span><b>{num(c.packedQty)}</b> / {num(c.targetQty)} <span className="sub">szt.</span></td>
                      <td><span className={`tag ${TAG[st]}`}>{STAN_KARTONU[st]}</span></td>
                      <td>{c.linkedOrderNo ? <span className="code">{c.linkedOrderNo}</span> : <span className="faint">—</span>}</td>
                      <td className="num hide-m muted">{fmtDate(dataZApi(c.createdAt))}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      {ctxMenu && (() => {
        const c = kartony.find(x => x.id === ctxMenu.id)
        if (!c) return null
        return <Menu anchor={ctxMenu.anchor} onClose={() => setCtxMenu(null)} items={[
          { header: `Karton ${nrKartonu(c)}` },
          { label: 'Kartka kartonu…', icon: <Printer size={15} />, onSelect: () => onKartka(c) },
          { label: c.linkedOrderNo ? `Otwórz zamówienie ${c.linkedOrderNo}` : 'Bez zamówienia', disabled: !c.linkedOrderId, onSelect: () => c.linkedOrderId && app.openOrder(c.linkedOrderId) },
          { sep: true },
          { label: 'Usuń pusty karton…', danger: true, disabled: c.packedQty > 0, onSelect: () => setUsun(c) },
        ]} />
      })()}
      {usun && <Dialog title={`Usunąć pusty karton ${nrKartonu(usun)}?`} onClose={() => setUsun(null)}
        footer={<><button className="btn" onClick={() => setUsun(null)} data-autofocus>Wróć</button>
          <button className="btn primary" style={{ background: 'var(--crit)', borderColor: 'var(--crit)' }} disabled={usuwam} onClick={() => void usunTeraz()}>{usuwam ? 'Usuwanie…' : 'Usuń karton'}</button></>}>
        <p>Karton zniknie też z panelu magazynu. Do kartonu nie spakowano żadnej sztuki — nic nie traci śledzenia partii.</p>
      </Dialog>}
    </>
  )
}
