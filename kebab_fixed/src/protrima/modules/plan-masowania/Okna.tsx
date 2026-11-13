import React, { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { CheckCheck, RotateCcw, XCircle, CalendarClock, Printer } from 'lucide-react'
import { Dialog } from '../../shell/context'
import { FlagIcon } from '../../ui/Glyphs'
import { useApi } from '@/hooks/useApi'
import { mixingOrdersApi, settingsApi } from '@/lib/api'
import type { Recipe } from '@/features/ingredients/types'
import { buildSplit, proposeMixingSplit, splitToBatches, validateMixingSplit, type SplitLotInput } from '@/features/products/lib/mixingSplit'
import { buildLotRows, roundIngredientDose } from '@/lib/mixingPlanPrint'
import { logoDokumentu } from '../../zaklad/zaklad'
import {
  dataPl, dzisIso, fmt, fmt2, kgWiersza, liczba, nazwaDnia, opisWsadow, polprodukt, przesunDzien, przyprawyPlanu, zPlanu,
  type PozycjaSerwera, type Przyprawa, type Wiersz,
} from './model'

function useZapis() {
  const [busy, setBusy] = useState(false)
  const [blad, setBlad] = useState<string | null>(null)
  const zapisz = async (fn: () => Promise<void>) => {
    if (busy) return
    setBusy(true); setBlad(null)
    try { await fn() } catch (e) { setBlad(e instanceof Error ? e.message : 'Nie udało się zapisać') } finally { setBusy(false) }
  }
  return { busy, blad, zapisz }
}
const Odmowa = ({ blad }: { blad: string | null }) => (blad
  ? <div className="note crit" role="alert"><FlagIcon level="crit" size={15} /><div><b>Serwer odmówił:</b> {blad}</div></div> : null)

const Pozycja = ({ w, nazwa }: { w: Wiersz; nazwa: string }) => (
  <div className="pm-okno-poz"><b>{nazwa || '—'}</b> · {fmt(kgWiersza(w))} kg mięsa{w.orderNo ? <> · <span className="code">{w.orderNo}</span></> : null}
    {w.lots.length > 0 && <div className="muted">partie: {w.lots.map(l => `${l.lotNo ?? '?'} (${fmt(l.kgPlanned || l.kgActual || 0)} kg)`).join(', ')}</div>}</div>
)

/**
 * Potwierdzenie wykonania bez panelu masowni: biuro kwituje, że pozycja została
 * zmasowana w całości. Przy ≥2 partiach mięsa — podział jak w starym MES
 * (partie czyste + jedna mieszana z resztek), ta sama biblioteka i ta sama
 * sekwencja `finish-session`, mieszana na końcu.
 */
export function PotwierdzDialog({ w, receptura, braki, onClose, onDone }: {
  w: Wiersz; receptura?: Recipe; braki: Przyprawa[]; onClose: () => void; onDone: (partii: number) => void
}) {
  const kg = kgWiersza(w)
  const lots = useMemo<SplitLotInput[]>(() => w.lots.filter(l => l.kgPlanned > 0).map(l => ({ meatLotId: l.meatLotId, lotNo: l.lotNo ?? '?', kgPlanned: l.kgPlanned })), [w.lots])
  const zPodzialem = lots.length >= 2
  const [miesz, setMiesz] = useState<Record<string, string>>(() => {
    const m: Record<string, string> = {}
    lots.forEach(l => { m[l.meatLotId] = '0' })
    proposeMixingSplit(lots).mixed.forEach(e => { m[e.meatLotId] = String(e.kg).replace('.', ',') })
    return m
  })
  const split = useMemo(() => buildSplit(lots, Object.fromEntries(lots.map(l => [l.meatLotId, liczba(miesz[l.meatLotId] ?? '0') || 0]))), [lots, miesz])
  const v = zPodzialem ? validateMixingSplit(split, lots, kg) : { ok: true as const }
  const partie = zPodzialem ? splitToBatches(split) : [{ kg, lotAllocations: [] as Array<{ meatLotId: string; kg: number }> }]
  const { busy, blad, zapisz } = useZapis()
  const [zrobione, setZrobione] = useState(0)
  const potwierdz = () => void zapisz(async () => {
    // Sekwencja sesji: po błędzie w połowie część partii już jest na magazynie — mówimy to wprost.
    let i = 0
    try {
      for (const b of partie) { await mixingOrdersApi.finishSession(w.id!, b.kg, '', b.lotAllocations); i++; setZrobione(i) }
    } catch (e) {
      if (i > 0) throw new Error(`${e instanceof Error ? e.message : 'błąd'} — zapisano ${i} z ${partie.length} partii; odśwież plan i dokończ albo cofnij potwierdzenie.`)
      throw e
    }
    onDone(partie.length)
  })
  return (
    <Dialog wide={zPodzialem} title="Potwierdź wykonanie masowania" icon={<CheckCheck size={20} />} onClose={() => { if (!busy) onClose() }}
      footer={<><button className="btn" disabled={busy} onClick={onClose}>Anuluj</button>
        <button className="btn primary" data-autofocus disabled={busy || !v.ok} data-tip={v.ok ? undefined : v.error} onClick={potwierdz}>
          {busy ? `Zapisuję… ${zrobione}/${partie.length}` : partie.length > 1 ? `Potwierdź — ${partie.length} partie` : 'Potwierdź wykonanie'}</button></>}>
      <Pozycja w={w} nazwa={receptura?.name ?? ''} />
      <p className="muted pm-okno-opis">Mięso przyprawione ({fmt(polprodukt(receptura, kg))} kg) wejdzie na magazyn, partie mięsa i przyprawy zejdą ze stanu.
        Dopóki nic nie pójdzie na produkcję, potwierdzenie da się cofnąć.</p>
      {zPodzialem && <>
        <table className="tbl pm-podzial">
          <thead><tr><th>Partia mięsa</th><th className="num">W pozycji</th><th className="num">Do wsadu mieszanego</th><th className="num">Partia czysta</th></tr></thead>
          <tbody>{lots.map(l => {
            const m = liczba(miesz[l.meatLotId] ?? '0') || 0
            return <tr key={l.meatLotId} className="row"><td className="code strong">{l.lotNo}</td><td className="num">{fmt(l.kgPlanned)} kg</td>
              <td className="num"><input className="field num" inputMode="decimal" value={miesz[l.meatLotId] ?? '0'} disabled={busy} aria-label={`Kg mieszane z partii ${l.lotNo}`}
                onFocus={e => e.target.select()} onChange={e => setMiesz(s => ({ ...s, [l.meatLotId]: e.target.value.replace(/[^\d.,]/g, '') }))} /></td>
              <td className="num strong">{fmt(Math.max(0, l.kgPlanned - m))} kg</td></tr>
          })}</tbody>
        </table>
        <div className="note"><FlagIcon level="info" size={15} /><div><b>Powstaną partie:</b> {split.pure.map(p => `${p.lotNo} (${fmt(p.kg)} kg)`).join(', ')}
          {split.mixed.length > 0 && <>{split.pure.length ? ', ' : ''}mieszana ({fmt(split.mixed.reduce((s, e) => s + e.kg, 0))} kg: {split.mixed.map(m => `${fmt(m.kg)} z ${m.lotNo}`).join(' + ')})</>}.
          {' '}„Do wsadu mieszanego” to resztki partii połączone w ostatnim wsadzie — wpisz tyle, ile operator zapisał na kartce.</div></div>
        {v.ok && 'warning' in v && v.warning && <div className="note warn"><FlagIcon level="warn" size={15} /><div>{v.warning}</div></div>}
        {!v.ok && <div className="note crit" role="alert"><FlagIcon level="crit" size={15} /><div>{v.error}</div></div>}
      </>}
      {braki.length > 0 && <div className="note warn"><FlagIcon level="warn" size={15} /><div><b>Na stanie brakuje przypraw:</b> {braki.map(b => `${b.nazwa} (brak ${fmt2(b.brak)} ${b.jedn})`).join(', ')}.
        Skoro masowanie się odbyło, przyprawy były — najpierw przyjmij je na magazyn. Inaczej ze stanu zejdzie tylko to, co jest, i rozchód przypraw tej partii będzie niepełny.</div></div>}
      <Odmowa blad={blad} />
    </Dialog>
  )
}

export function CofnijDialog({ w, nazwa, onClose, onDone }: { w: Wiersz; nazwa: string; onClose: () => void; onDone: () => void }) {
  const { busy, blad, zapisz } = useZapis()
  return (
    <Dialog title="Cofnij potwierdzenie masowania" icon={<RotateCcw size={20} />} onClose={onClose}
      footer={<><button className="btn" onClick={onClose} data-autofocus>Zostaw</button>
        <button className="btn danger" disabled={busy} onClick={() => void zapisz(async () => { await mixingOrdersApi.undoConfirm(w.id!); onDone() })}>{busy ? 'Cofam…' : 'Cofnij potwierdzenie'}</button></>}>
      <Pozycja w={w} nazwa={nazwa} />
      <p className="muted pm-okno-opis">Partia mięsa przyprawionego zniknie z magazynu, mięso i przyprawy wrócą na stan, a pozycja wróci do kolejki.
        Działa tylko wtedy, gdy z tej partii nic jeszcze nie poszło na produkcję.</p>
      <Odmowa blad={blad} />
    </Dialog>
  )
}

export function AnulujDialog({ w, nazwa, dzien, onClose, onDone }: { w: Wiersz; nazwa: string; dzien?: string; onClose: () => void; onDone: () => void }) {
  const { busy, blad, zapisz } = useZapis()
  return (
    <Dialog title="Anuluj zlecenie masowania" icon={<XCircle size={20} />} onClose={onClose}
      footer={<><button className="btn" onClick={onClose} data-autofocus>Zostaw</button>
        <button className="btn danger" disabled={busy} onClick={() => void zapisz(async () => { await mixingOrdersApi.cancel(w.id!); onDone() })}>{busy ? 'Anuluję…' : 'Anuluj zlecenie'}</button></>}>
      <Pozycja w={w} nazwa={nazwa} />
      <p className="muted pm-okno-opis">{dzien ? `Zlecenie z planu na ${dataPl(dzien)} zniknie z kolejki` : 'Zlecenie zniknie z kolejki'}, a zarezerwowane mięso wróci do puli.
        Rób to, gdy masowania <b>nie było</b>. Jeśli było — potwierdź wykonanie, inaczej stan mięsa i przypraw się nie zgodzi.</p>
      <Odmowa blad={blad} />
    </Dialog>
  )
}

/** Przeniesienie niewykonanego zlecenia na inny dzień — razem z jego rezerwacją mięsa. */
export function PrzeniesDialog({ w, nazwa, zDnia, onClose, onDone }: { w: Wiersz; nazwa: string; zDnia: string; onClose: () => void; onDone: (naDzien: string) => void }) {
  const dzis = dzisIso()
  const [cel, setCel] = useState(zDnia < dzis ? dzis : przesunDzien(zDnia, 1))
  const { busy, blad, zapisz } = useZapis()
  const zle = !cel || cel < dzis ? 'Wybierz dziś albo przyszły dzień' : cel === zDnia ? 'Zlecenie jest już w planie tego dnia' : null
  return (
    <Dialog title="Przenieś zlecenie na inny dzień" icon={<CalendarClock size={20} />} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Anuluj</button>
        <button className="btn primary" disabled={busy || !!zle} data-tip={zle ?? undefined} data-autofocus
          onClick={() => void zapisz(async () => { await mixingOrdersApi.move(w.id!, cel); onDone(cel) })}>{busy ? 'Przenoszę…' : `Przenieś na ${nazwaDnia(cel, dzis)} (${dataPl(cel)})`}</button></>}>
      <Pozycja w={w} nazwa={nazwa} />
      <div className="pm-dzien-wybor">
        <div className="seg" role="group" aria-label="Dzień docelowy">
          <button type="button" aria-pressed={cel === dzis} disabled={zDnia === dzis} onClick={() => setCel(dzis)}>Dziś</button>
          <button type="button" aria-pressed={cel === przesunDzien(dzis, 1)} disabled={zDnia === przesunDzien(dzis, 1)} onClick={() => setCel(przesunDzien(dzis, 1))}>Jutro</button>
        </div>
        <input type="date" className="field" value={cel} min={dzis} onChange={e => setCel(e.target.value)} aria-label="Inny dzień" />
      </div>
      <p className="muted pm-okno-opis">Zlecenie przejdzie na koniec kolejki wybranego dnia. Przypisane partie mięsa zostają przy nim — nic nie trzeba dobierać od nowa.</p>
      <Odmowa blad={blad} />
    </Dialog>
  )
}

// ─── Wydruk dla operatora ────────────────────────────────────────────────────

const WSADY_KG = [200, 600]
const STATUS_DRUK: Record<string, string> = { planned: 'w kolejce', confirmed: 'w kolejce', in_progress: 'W MASOWNICY', done: 'gotowe' }

/**
 * Plan dla operatora (na masowni nie ma monitora przy każdej maszynie): kolejka
 * z partiami i wsadami, przepisy na wsad 200 i 600 kg, przyprawy łącznie.
 * Drukuje ZAPISANY plan z serwera — to samo, co widzi panel masowni.
 */
export function DrukPlanuDialog({ dzien, receptury, onClose }: { dzien: string; receptury: Map<string, Recipe>; onClose: () => void }) {
  const planRes = useApi(() => mixingOrdersApi.dayPlan(dzien), [dzien])
  const firmaRes = useApi(() => settingsApi.getCompany() as Promise<{ name?: string }>)
  const [druk, setDruk] = useState(false)
  const plan = (planRes.data?.items ?? null) as unknown as PozycjaSerwera[] | null
  useEffect(() => {
    if (!druk) return
    const prev = document.title
    document.title = `Plan masowania ${dzien}`
    const done = () => { setDruk(false); document.title = prev }
    window.addEventListener('afterprint', done)
    const t = window.setTimeout(() => window.print(), 60)
    return () => { window.clearTimeout(t); window.removeEventListener('afterprint', done); document.title = prev }
  }, [druk, dzien])
  const gotowe = !!plan && plan.length > 0
  const doc = gotowe ? <KartkaPlanu dzien={dzien} plan={plan!} receptury={receptury} firma={firmaRes.data ?? null} /> : null
  return (
    <>
      <Dialog xl title={`Plan dla operatora — ${dataPl(dzien)}`} icon={<Printer size={20} />} onClose={onClose}
        footer={<><span className="left muted">Drukuje zapisany plan — taki, jaki widzi panel masowni</span><button className="btn" onClick={onClose}>Zamknij</button>
          <button className="btn primary" disabled={!gotowe} onClick={() => setDruk(true)} data-autofocus><Printer size={15} />Drukuj</button></>}>
        {planRes.error && <div className="note crit" role="alert"><FlagIcon level="crit" size={15} /><div>Nie udało się pobrać planu: {planRes.error}</div></div>}
        {!plan && !planRes.error && <div className="note">Przygotowuję wydruk…</div>}
        {plan && plan.length === 0 && <div className="note">Na {dataPl(dzien)} nie ma zapisanego planu masowania.</div>}
        {doc && <div className="doc-preview"><div className="doc-paper">{doc}</div></div>}
      </Dialog>
      {druk && doc && createPortal(<div className="print-sheet doc-print">{doc}</div>, document.body)}
    </>
  )
}

export function KartkaPlanu({ dzien, plan, receptury, firma }: { dzien: string; plan: PozycjaSerwera[]; receptury: Map<string, Recipe>; firma: { name?: string } | null }) {
  const wiersze = useMemo(() => zPlanu(plan), [plan])
  const lotRows = useMemo(() => buildLotRows(plan.map(p => ({ id: p.id, recipeName: receptury.get(p.recipeId)?.name ?? (p as { recipeName?: string }).recipeName, meatKg: p.meatKg, status: p.status,
    meatLots: (p.meatLots ?? []).map(l => ({ meatLotNo: l.meatLotNo, materialName: l.materialName, supplierName: l.supplierName, kgPlanned: l.kgPlanned, kgActual: l.kgActual })) }))), [plan, receptury])
  const uzyte = useMemo(() => {
    const out: Array<{ r: Recipe; kg: number }> = []
    plan.forEach(p => { const r = receptury.get(p.recipeId); if (!r) return; const f = out.find(x => x.r.id === r.id); if (f) f.kg += p.meatKg; else out.push({ r, kg: p.meatKg }) })
    return out
  }, [plan, receptury])
  const przyprawy = useMemo(() => przyprawyPlanu(wiersze, receptury, null, false), [wiersze, receptury])
  const mieso = plan.reduce((s, p) => s + (p.meatKg || 0), 0)
  const pol = plan.reduce((s, p) => s + polprodukt(receptury.get(p.recipeId), p.meatKg || 0), 0)
  const logo = logoDokumentu(firma as never)
  const uwagi = new Map(plan.filter(p => (p.notes ?? '').trim()).map(p => [p.id, String(p.notes).trim()]))
  return (
    <article className="pm-druk" aria-label="Plan masowania do druku">
      <header className="pmd-head">
        {logo && <img src={logo} alt="" />}
        <div><h1>Plan masowania</h1><div className="pmd-sub">{nazwaDnia(dzien) !== 'dziś' ? `${nazwaDnia(dzien)}, ` : ''}<b>{dataPl(dzien)}</b>{firma?.name ? ` · ${firma.name}` : ''}</div></div>
        <div className="pmd-sumy">mięso <b>{fmt(mieso)} kg</b> → półprodukt <b>{fmt(pol)} kg</b><span>wydrukowano {new Date().toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' })}</span></div>
      </header>

      <h2>Kolejka masowania</h2>
      <table>
        <thead><tr><th className="c" style={{ width: 24 }}>Lp.</th><th>Receptura</th><th className="num" style={{ width: 58 }}>Mięso kg</th><th style={{ width: 96 }}>Wsady</th><th style={{ width: 62 }}>Partia</th><th className="num" style={{ width: 56 }}>Kg</th><th>Rodzaj · dostawca</th><th style={{ width: 62 }}>Stan</th></tr></thead>
        <tbody>
          {lotRows.map(row => (
            <React.Fragment key={row.rowKey}>
              <tr className={row.zebra ? 'z' : undefined}>
                {row.isFirstRow && <>
                  <td className="c" rowSpan={row.rowSpan}><b>{row.lp}</b></td>
                  <td rowSpan={row.rowSpan}><b>{row.recipeName}</b>{uwagi.has(row.positionId) && <div className="pmd-uwagi">Uwaga: {uwagi.get(row.positionId)}</div>}</td>
                  <td className="num" rowSpan={row.rowSpan}><b>{fmt(row.meatKg)}</b></td>
                  <td rowSpan={row.rowSpan}>{opisWsadow(row.meatKg)}</td>
                </>}
                <td><b>{row.lotNo}</b></td>
                <td className="num">{row.lotKg == null ? '—' : fmt(row.lotKg)}</td>
                <td>{row.lotKg == null ? 'partia do wskazania' : [row.materialName, row.supplierName].filter(Boolean).join(' · ') || '—'}</td>
                {row.isFirstRow && <td rowSpan={row.rowSpan}>{STATUS_DRUK[row.status] ?? row.status}</td>}
              </tr>
            </React.Fragment>
          ))}
        </tbody>
        <tfoot><tr><td colSpan={2}>Razem</td><td className="num">{fmt(mieso)}</td><td colSpan={5} /></tr></tfoot>
      </table>

      <div className="pmd-przepisy">
        {uzyte.map(({ r, kg }) => (
          <section key={r.id}>
            <h2>{r.name} <span>w planie {fmt(kg)} kg mięsa{r.mixingMinutes ? ` · masowanie ${r.mixingMinutes} min` : ''}</span></h2>
            <table>
              <thead><tr><th>Składnik (w tej kolejności)</th>{WSADY_KG.map(x => <th key={x} className="num" style={{ width: 92 }}>Wsad {x} kg</th>)}</tr></thead>
              <tbody>{r.ingredients.map(i => <tr key={i.id}><td>{i.ingredientName}</td>{WSADY_KG.map(x => <td key={x} className="num"><b>{fmt2(roundIngredientDose((i.qtyPer100kg * x) / 100))}</b> {i.unit}</td>)}</tr>)}</tbody>
              <tfoot><tr><td>Półprodukt</td>{WSADY_KG.map(x => <td key={x} className="num">{fmt(polprodukt(r, x))} kg</td>)}</tr></tfoot>
            </table>
          </section>
        ))}
      </div>

      <section className="pmd-lacznie">
        <h2>Do przygotowania — przyprawy łącznie na cały plan</h2>
        <table>
          <thead><tr><th>Składnik</th><th className="num" style={{ width: 110 }}>Ilość</th></tr></thead>
          <tbody>{przyprawy.map(p => <tr key={p.ingredientId}><td>{p.nazwa}</td><td className="num"><b>{fmt2(roundIngredientDose(p.potrzeba))}</b> {p.jedn}</td></tr>)}</tbody>
        </table>
      </section>
      <footer>Kolejność pozycji = kolejność masowania. Dawki na wsad 200 / 600 kg mięsa, zaokrąglone w górę do 0,05 — przy innym wsadzie licz proporcjonalnie.</footer>
    </article>
  )
}
