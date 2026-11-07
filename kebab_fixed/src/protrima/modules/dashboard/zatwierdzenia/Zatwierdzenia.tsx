import React, { useMemo, useState } from 'react'
import { CheckCircle2, ClipboardCheck, Factory } from 'lucide-react'
import { useApp, Dialog } from '../../../shell/context'
import { useAuth } from '@/features/auth/AuthContext'
import { productionPlansApi, productionSessionsApi, seasonedMeatApi } from '@/lib/api'
import { kg, num } from '../../../data/model'
import { FlagIcon } from '../../../ui/Glyphs'
import { doZatwierdzenia, korektyReszty, porownaniePlanu, resztyDoRozliczenia, type PartiaLite, type PlanZ, type ResztaReceptury, type SesjaLite } from './model'

const dataPl = (iso: string) => { const [r, m, d] = iso.slice(0, 10).split('-'); return d && m && r ? `${d}.${m}.${r}` : iso }
const godz = (iso?: string | null) => (iso ? new Date(iso).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Warsaw' }) : '')
const kgPl = (v: number) => String(Math.round(v * 1000) / 1000).replace('.', ',')
const blad = (e: unknown) => (e instanceof Error ? e.message : String(e))

/**
 * Pulpit: praca hali, którą domyka biuro — zamknięte sesje (rozbiór, masowanie, produkcja) i plany
 * zakończone na tablecie. Panel jest tylko wtedy, gdy jest co zatwierdzić; zaległe na górze.
 */
export function ZatwierdzeniaPanel({ sesje, plany, dzis, onZmiana }: { sesje: SesjaLite[]; plany: PlanZ[]; dzis: string; onZmiana: () => void }) {
  const lista = useMemo(() => doZatwierdzenia(sesje, plany, dzis), [sesje, plany, dzis])
  const [sesja, setSesja] = useState<SesjaLite | null>(null)
  const [plan, setPlan] = useState<PlanZ | null>(null)
  // Okna żyją poza listą: po potwierdzeniu Pulpit odświeża dane i ostatnia pozycja znika z listy,
  // a okno musi jeszcze zapytać o resztę mięsa (inaczej pytanie przepadało razem z panelem).
  const okna = <>
    {sesja && <SesjaDialog sesja={sesja} onClose={() => setSesja(null)} onDone={() => { setSesja(null); onZmiana() }} />}
    {plan && <PlanDialog plan={plan} onClose={() => setPlan(null)} onDone={onZmiana} />}
  </>
  // Stały układ (lista, potem okna): przeniesienie okna w inne miejsce drzewa montuje je od nowa i gubi krok.
  return (<>
    {lista.length > 0 && <section className="panel p-zatw" aria-label="Do zatwierdzenia przez biuro">
      <div className="panel-h"><h2>Do zatwierdzenia przez biuro</h2><span className="sub">hala zakończyła — biuro domyka dzień i przyjmuje wyrób na magazyn</span></div>
      <div className="zatw-lista">
        {lista.map(p => (
          <div key={p.key} className={`zatw-it${p.zalegla ? ' zalegla' : ''}`}>
            <span className="zi-ico">{p.rodzaj === 'plan' ? <Factory size={16} /> : <ClipboardCheck size={16} />}</span>
            <span className="zi-t">{p.tytul}</span>
            <span className="zi-d">{dataPl(p.data)}{p.sesja?.endedAt ? ` · zakończona ${godz(p.sesja.endedAt)}` : ''}
              {p.plan && ` · ${num(porownaniePlanu(p.plan).suma.szt)} szt. z tabletu`}</span>
            {p.zalegla && <span className="tag warn">zaległa</span>}
            {p.rodzaj === 'sesja'
              ? <button className="btn sm" onClick={() => setSesja(p.sesja!)}><CheckCircle2 size={15} />Zatwierdź…</button>
              : <button className="btn sm primary" onClick={() => setPlan(p.plan!)}><CheckCircle2 size={15} />Sprawdź i potwierdź…</button>}
          </div>
        ))}
      </div>
    </section>}
    {okna}
  </>)
}

function SesjaDialog({ sesja, onClose, onDone }: { sesja: SesjaLite; onClose: () => void; onDone: () => void }) {
  const app = useApp()
  const { user } = useAuth()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const proces = sesja.processType === 'deboning' ? 'Rozbiór' : sesja.processType === 'mixing' ? 'Masowanie' : 'Produkcja'
  const zatwierdz = async () => {
    setBusy(true); setErr(null)
    try {
      // Kto zatwierdził — nazwisko z konta biura (stary MES zapisywał anonimowe „office”).
      await productionSessionsApi.approve(sesja.id, { approvedBy: user?.name || 'biuro' })
      app.toast({ kind: 'ok', title: `${proces} ${dataPl(sesja.sessionDate)} zatwierdzony`, detail: 'Dzień domknięty — raport dzienny jest kompletny.' })
      onDone()
    } catch (e) { setErr(blad(e)) } finally { setBusy(false) }
  }
  return (
    <Dialog title="Zatwierdź dzień pracy hali" icon={<ClipboardCheck size={20} color="var(--accent)" />} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Anuluj</button><button className="btn primary" disabled={busy} onClick={() => void zatwierdz()}>{busy ? 'Zatwierdzam…' : 'Zatwierdź dzień'}</button></>}>
      <p><b>{proces} z dnia {dataPl(sesja.sessionDate)}</b>{sesja.endedAt ? `, zakończony na hali o ${godz(sesja.endedAt)}` : ''}.</p>
      <p className="muted" style={{ marginTop: 6 }}>Zatwierdzenie domyka dzień: raport dzienny i karty liczą się z zatwierdzonych dni.
        {sesja.processType === 'deboning' && ' Późniejsze poprawki wpisów rozbioru tylko przez korektę biura z podanym powodem.'}</p>
      {err && <div className="note crit" role="alert" style={{ marginTop: 8 }}>{err}</div>}
    </Dialog>
  )
}

function PlanDialog({ plan, onClose, onDone }: { plan: PlanZ; onClose: () => void; onDone: () => void }) {
  const app = useApp()
  const por = useMemo(() => porownaniePlanu(plan), [plan])
  const [krok, setKrok] = useState<'sprawdz' | 'reszta'>('sprawdz')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [reszty, setReszty] = useState<ResztaReceptury[]>([])
  const [wpisy, setWpisy] = useState<Record<string, string>>({})

  const potwierdz = async () => {
    setBusy(true); setErr(null)
    try {
      await productionPlansApi.officeConfirm(plan.id)
      app.toast({ kind: 'ok', title: `Plan ${plan.planNo} potwierdzony`, detail: `${num(por.suma.szt)} szt. · ${kg(por.suma.kg)} przyjęte na magazyn wyrobu.` })
      onDone()
      // Reszta mięsa: jeden pomiar po produkcji. Bez niego karta 2.5.1 podaje teorię jako pomiar.
      let r: ResztaReceptury[] = []
      try { r = resztyDoRozliczenia(plan, (await seasonedMeatApi.all()) as PartiaLite[]) } catch { r = [] }
      if (r.length === 0) { onClose(); return }
      setReszty(r)
      setWpisy(Object.fromEntries(r.map(x => [x.recipeId, kgPl(x.teoria)])))
      setKrok('reszta')
    } catch (e) { setErr(blad(e)) } finally { setBusy(false) }
  }

  const zapiszReszte = async () => {
    const podane: Record<string, number> = {}
    for (const [k, v] of Object.entries(wpisy)) { const n = parseFloat(v.replace(',', '.')); if (Number.isFinite(n) && n >= 0) podane[k] = n }
    setBusy(true); setErr(null)
    try {
      for (const k of korektyReszty(reszty, podane)) {
        await seasonedMeatApi.reconcile(k.id, { targetKg: k.targetKg, close: k.close, reason: `rozliczenie produkcji ${plan.planNo} — ubytek masowania/produkcji` })
      }
      app.toast({ kind: 'ok', title: 'Pozostałość zapisana', detail: 'Stan mięsa przyprawionego = pomiar po produkcji.' })
      onDone(); onClose()
    } catch (e) { setErr(blad(e)) } finally { setBusy(false) }
  }

  if (krok === 'reszta') return (
    <Dialog title={`Ile mięsa zostało po ${plan.planNo}?`} icon={<Factory size={20} color="var(--accent)" />} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Rozliczę później</button><button className="btn primary" disabled={busy} onClick={() => void zapiszReszte()}>{busy ? 'Zapisuję…' : 'Zapisz pozostałość'}</button></>}>
      <p className="muted">Wpisz, ile mięsa przyprawionego każdej receptury realnie zostało (waga). Podpowiedź = stan wg księgi. Różnica to ubytek produkcji.</p>
      <table className="tbl" style={{ marginTop: 8 }}>
        <thead><tr><th>Receptura</th><th className="num">Wg księgi</th><th className="num">Zostało (kg)</th><th /></tr></thead>
        <tbody>{reszty.map(r => (
          <tr key={r.recipeId}>
            <td className="strong">{r.recipeName}<span className="sub">{r.batches.map(b => b.batchNo).join(', ')}</span></td>
            <td className="num">{kg(r.teoria)}</td>
            <td className="num"><input className="field num w-num" inputMode="decimal" aria-label={`Zostało mięsa ${r.recipeName} (kg)`} value={wpisy[r.recipeId] ?? ''}
              onChange={e => setWpisy(w => ({ ...w, [r.recipeId]: e.target.value }))} /></td>
            <td><button className="btn sm ghost" onClick={() => setWpisy(w => ({ ...w, [r.recipeId]: '0' }))}>Nic nie zostało</button></td>
          </tr>))}</tbody>
      </table>
      {err && <div className="note crit" role="alert" style={{ marginTop: 8 }}>{err}</div>}
    </Dialog>
  )

  return (
    <Dialog wide title={`Potwierdź produkcję ${plan.planNo}`} icon={<Factory size={20} color="var(--accent)" />} onClose={onClose}
      footer={<><span className="left">Do magazynu wyrobu: <b>{num(por.suma.szt)} szt. · {kg(por.suma.kg)}</b></span>
        <button className="btn" onClick={onClose}>Anuluj</button>
        <button className="btn primary" disabled={busy || por.pusty} onClick={() => void potwierdz()}>{busy ? 'Potwierdzam…' : 'Potwierdź i przyjmij na magazyn'}</button></>}>
      <p className="muted">Tablet zakończył plan z dnia {dataPl(plan.planDate)}. Po potwierdzeniu zgłoszone sztuki trafiają do magazynu wyrobu gotowego, a rezerwacje mięsa się rozliczają.</p>
      <table className="tbl" style={{ marginTop: 8 }}>
        <thead><tr><th>Wyrób</th><th>Klient</th><th className="num">Plan</th><th className="num">Zgłoszono</th><th className="num">Masa</th><th className="hide-m">Pracownicy</th></tr></thead>
        <tbody>{por.wiersze.map(w => (
          <tr key={w.lineId} className={w.stan === 'ok' ? '' : 'row-warn'}>
            <td><b>{w.recipeName}</b> {w.kgPerUnit} kg<span className="sub">{w.productTypeName}{w.packagingName ? ` · ${w.packagingName}` : ''}</span></td>
            <td>{w.clientName || <span className="muted">na magazyn</span>}</td>
            <td className="num">{num(w.planowano)}</td>
            <td className={`num${w.stan === 'ok' ? '' : ' warn-ink'}`}><b>{num(w.zgloszono)}</b> <span className="sub">szt.</span></td>
            <td className="num">{kg(w.kg)}</td>
            <td className="hide-m muted">{w.pracownicy.join(', ') || '—'}</td>
          </tr>))}</tbody>
        <tfoot><tr><td colSpan={3}>Razem</td><td className="num" colSpan={2}>{num(por.suma.szt)} szt. · {kg(por.suma.kg)}</td><td className="hide-m" /></tr></tfoot>
      </table>
      {por.ostrzezenia.map(o => <div key={o} className="note warn" style={{ marginTop: 8 }}><FlagIcon level="warn" size={15} /><div>{o}</div></div>)}
      {por.pusty && <div className="note crit" style={{ marginTop: 8 }}>Tablet nie przekazał żadnych wpisów — nie ma czego przyjąć na magazyn. Sprawdź plan na hali.</div>}
      {err && <div className="note crit" role="alert" style={{ marginTop: 8 }}>{err}</div>}
    </Dialog>
  )
}
