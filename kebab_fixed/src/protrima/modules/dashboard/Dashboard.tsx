import React, { useEffect, useMemo } from 'react'
import { ArrowRight, SlidersHorizontal, Clock3 } from 'lucide-react'
import { useApp, CommandBar, type Cmd, type DetailTab } from '../../shell/context'
import { useOrders } from '../../data/store'
import { computeMetrics, isClosed, kg, num, pct, longDate, TODAY, BUCKET_LABEL, fmtDay, fmtDate, weekday, addDays, mixingByRecipe, type Bucket, type Order, type Level } from '../../data/model'
import { dataZApi } from '../../data/mapuj'
import { posKg } from '../../data/stock'
import { FlagIcon, StageNode, LEVEL_WORD } from '../../ui/Glyphs'
import { useApi } from '@/hooks/useApi'
import { useLiveRefresh } from '@/hooks/useLiveRefresh'
import { deboningApi, meatStockApi, productionPlansApi, productionSessionsApi, rawBatchesApi, receptionChecksApi, seasonedMeatApi, zaladunkiApi, type ZaladunekDoWydruku } from '@/lib/api'
import { filterDeboningBatches } from '@/features/dashboard/dashboardLists'
import { computeDisplayStatus } from '@/components/ui/badge'
import type { RawBatch } from '@/types'
import { fig } from '../../ui/Fig'

type Open = Array<{ o: Order; m: ReturnType<typeof computeMetrics> }>
interface PlanLite { id: string; planNo: string; planDate: string; status: string; lines: Array<{ qty: number; kgPerUnit: number; qtyDone: number; recipeName: string }> }
interface SeasonedLite { recipeId: string; recipeName: string; kgAvailable: number; kgReserved: number }

/**
 * Pulpit zakładu — te same źródła co stary pulpit (DashboardPage): zamówienia,
 * wyrób gotowy, plany produkcji, mięso przyprawione, sesje i kontrole HACCP
 * do potwierdzenia, kursy do wydruku. Tylko odczyt; zatwierdzenia — faza 5.
 */
export function Dashboard({ active, setCtx, setCmds }: { active: boolean; setCtx: (n: React.ReactNode) => void; setCmds: (c: Cmd[]) => void }) {
  const app = useApp()
  const { orders, stock, stamp } = useOrders()
  const open = useMemo(() => orders.filter(o => !isClosed(o)).map(o => ({ o, m: computeMetrics(o) })), [orders])

  const plansRes = useApi(() => productionPlansApi.list() as Promise<PlanLite[]>)
  const seasonedRes = useApi(() => seasonedMeatApi.list() as Promise<SeasonedLite[]>)
  const pendingRes = useApi(() => productionSessionsApi.pending())
  const haccpRes = useApi(() => receptionChecksApi.pending(14))
  const kursyRes = useApi(() => zaladunkiApi.doWydruku())
  const batchRes = useApi(() => rawBatchesApi.list({ active_only: true, limit: 500 }))
  const matTypesRes = useApi(() => rawBatchesApi.materialTypes())
  const debRes = useApi(() => deboningApi.list())
  const meatRes = useApi(() => meatStockApi.list())
  useLiveRefresh({ plansRes, seasonedRes, pendingRes, haccpRes, kursyRes, batchRes, debRes, meatRes }, 30_000)
  const raw = useMemo(() => surowiec(batchRes.data?.data ?? [], (matTypesRes.data ?? []) as never[], (debRes.data?.data ?? []) as unknown[], (meatRes.data?.data ?? []) as Array<{ status?: string; kgAvailable: number; expiryDate?: string }>), [batchRes.data, matTypesRes.data, debRes.data, meatRes.data])

  const ext: Ext = {
    plans: plansRes.data ?? [], seasoned: seasonedRes.data ?? [],
    pending: pendingRes.data?.length ?? 0, haccp: haccpRes.data?.length ?? 0, kursy: kursyRes.data ?? [],
    stockKg: stock.reduce((a, p) => a + posKg(p), 0), allocKg: stock.reduce((a, p) => a + (p.orderNo ? posKg(p) : 0), 0),
    raw,
  }

  const cmds = useMemo<Cmd[]>(() => [
  ], [app])
  useEffect(() => { setCmds(cmds) }, [cmds, setCmds])

  useEffect(() => {
    if (!active) return
    const kgSum = open.reduce((a, x) => a + x.m.orderedKg, 0)
    const prob = open.filter(x => x.m.level === 'crit' || x.m.level === 'warn').length
    setCtx(<><span>Otwarte zamówienia: <b>{open.length}</b> · <b>{kg(kgSum)}</b></span><span>Z problemem: <b className="crit-ink">{prob}</b></span><span className="hide-m">Pulpit odświeża się co 30 s</span></>)
  }, [active, open, setCtx])

  return (
    <>
      <CommandBar title="Pulpit zakładu" count={`${longDate(TODAY)}${stamp ? ` · stan na ${stamp.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}` : ''}`} cmds={cmds} />
      <div className="dash">
        <ProcessPanel open={open} ext={ext} />
        <RawPanel raw={raw} />
        <AttentionPanel open={open} ext={ext} />
        <ProductionPanel plans={ext.plans} />
        <DuePanel open={open} />
        <ShipmentsPanel kursy={ext.kursy} />
        <MaterialsPanel open={open} seasoned={ext.seasoned} />
      </div>
    </>
  )
}

interface Ext {
  plans: PlanLite[]; seasoned: SeasonedLite[]; pending: number; haccp: number; kursy: ZaladunekDoWydruku[]
  stockKg: number; allocKg: number; raw: Surowiec
}

// ─── Ćwiartka i rozbiór — te same reguły co stary pulpit (DashboardPage) ──
/** Ćwiartka pakowana po 15 kg na pojemnik (jak w starym MES). */
const KG_POJEMNIK = 15
interface Surowiec {
  partie: RawBatch[]; kgCwiartki: number; pojemniki: number
  dzisPobrano: number; dzisWpisow: number; dzisOtwarte: number; dzisMieso: number; wydajnosc: number | null
  kgMiesa: number; kgMiesaPoTerminie: number; partiiPoTerminie: number; najblizszyTermin: string | null
}
const num0 = (v: unknown) => Number(v ?? 0) || 0
function surowiec(batches: RawBatch[], typy: never[], deb: unknown[], meat: Array<{ status?: string; kgAvailable: number; expiryDate?: string }>): Surowiec {
  // Partie, które idą na rozbiór (mięso z/s, filet itp. omija rozbiór) i nie są zużyte.
  const partie = filterDeboningBatches(batches, typy).filter(b => computeDisplayStatus(b.expiryDate, Number(b.kgAvailable)) !== 'used')
    .sort((a, b) => (a.expiryDate || '9').localeCompare(b.expiryDate || '9'))
  const kgCwiartki = partie.reduce((s, b) => s + Number(b.kgAvailable), 0)
  const dzis = new Date().toISOString().slice(0, 10)
  const wpisy = deb.map(d => d as Record<string, unknown>).filter(d => String(d.createdAt ?? d.created_at ?? '').slice(0, 10) === dzis)
  // Wydajność tylko z domkniętych wpisów — otwarte pobranie (mięso czeka na wagę) zaniżałoby procent.
  const domkniete = wpisy.filter(d => (d.status ?? 'complete') === 'complete')
  const pobranoDomk = domkniete.reduce((s, d) => s + num0(d.kgTaken ?? d.kg_taken), 0)
  const mieso = domkniete.reduce((s, d) => s + num0(d.kgMeat ?? d.kg_meat), 0)
  return {
    partie, kgCwiartki, pojemniki: Math.ceil(kgCwiartki / KG_POJEMNIK),
    dzisPobrano: wpisy.reduce((s, d) => s + num0(d.kgTaken ?? d.kg_taken), 0), dzisWpisow: wpisy.length,
    dzisOtwarte: wpisy.length - domkniete.length, dzisMieso: mieso, wydajnosc: pobranoDomk > 0 ? mieso / pobranoDomk * 100 : null,
    // Stan mięsa z/s jak w starym pulpicie, ale rozdzielony: partie po terminie, które nadal figurują jako dostępne, to sprawa do wyjaśnienia, nie zapas.
    ...(() => {
      const dost = meat.filter(m => m.status === 'AVAILABLE' && Number(m.kgAvailable) > 0)
      const po = dost.filter(m => m.expiryDate && m.expiryDate.slice(0, 10) < dzis)
      return { kgMiesa: dost.reduce((s, m) => s + Number(m.kgAvailable), 0) - po.reduce((s, m) => s + Number(m.kgAvailable), 0), kgMiesaPoTerminie: po.reduce((s, m) => s + Number(m.kgAvailable), 0), partiiPoTerminie: po.length }
    })(),
    najblizszyTermin: partie.find(b => b.expiryDate)?.expiryDate ?? null,
  }
}

function RawPanel({ raw }: { raw: Surowiec }) {
  const app = useApp()
  const dzis = new Date(); dzis.setHours(0, 0, 0, 0)
  const dniDo = (iso: string) => { const d = dataZApi(iso); return d ? Math.round((d.getTime() - dzis.getTime()) / 86_400_000) : null }
  return (
    <section className="panel p-raw" aria-label="Ćwiartka i rozbiór">
      <div className="panel-h"><h2>Ćwiartka i rozbiór</h2><span className="sub">stan ćwiartki, rozbiór dziś, mięso z/s gotowe do masowania</span>
        <span className="tools"><button className="btn sm ghost" onClick={() => app.openModule('rozbior')}>Rozbiór<ArrowRight size={14} /></button></span>
      </div>
      <div className="raw-grid">
        <div className="raw-kpis">
          <div className="kpi"><span className="k">Ćwiartka na stanie</span><span className="v fig">{fig(kg(raw.kgCwiartki))}</span><span className="s">≈ {num(raw.pojemniki)} pojemników · {raw.partie.length} {raw.partie.length === 1 ? 'partia' : 'partii'}</span></div>
          <div className="kpi"><span className="k">Pobrano dziś do rozbioru</span><span className="v fig">{fig(kg(raw.dzisPobrano))}</span><span className="s">{raw.dzisWpisow} {raw.dzisWpisow === 1 ? 'pobranie' : 'pobrań'}{raw.dzisOtwarte > 0 ? ` · ${raw.dzisOtwarte} w toku` : ''}</span></div>
          <div className="kpi"><span className="k">Mięso z/s dziś</span><span className="v fig">{fig(kg(raw.dzisMieso))}</span><span className="s">{raw.wydajnosc === null ? 'brak domkniętych wpisów' : <>wydajność <b className={raw.wydajnosc < 60 || raw.wydajnosc > 71 ? 'warn-ink' : ''}>{raw.wydajnosc.toFixed(1).replace('.', ',')}%</b></>}</span></div>
          <div className="kpi"><span className="k">Mięso z/s w terminie</span><span className="v fig">{fig(kg(raw.kgMiesa))}</span><span className="s">{raw.partiiPoTerminie > 0
            ? <span className="warn-ink" data-tip="Partie z datą przydatności w przeszłości, które w ewidencji nadal są dostępne — do wyjaśnienia w magazynie (korekta stanu w starym MES)">+ {kg(raw.kgMiesaPoTerminie)} po terminie ({raw.partiiPoTerminie} partii)</span>
            : 'gotowe do masowania'}</span></div>
        </div>
        <div className="raw-tbl">
          <table className="tbl">
            <thead><tr><th>Partia</th><th>Dostawca</th><th className="num">Przyjęto</th><th className="num">Zostało</th><th>Zużycie</th><th>Termin</th></tr></thead>
            <tbody>
              {raw.partie.length === 0 && <tr><td colSpan={6}><div className="empty">Brak ćwiartki na stanie.</div></td></tr>}
              {raw.partie.map(b => {
                const rec = Number(b.kgReceived) || 0, av = Number(b.kgAvailable) || 0
                const used = rec > 0 ? Math.min(100, Math.max(0, (rec - av) / rec * 100)) : 0
                const dd = b.expiryDate ? dniDo(b.expiryDate) : null
                return (
                  <tr key={b.id} className="row">
                    <td className="code strong">{b.internalBatchNo || '—'}</td>
                    <td className="ell" style={{ maxWidth: 200 }}>{b.supplierDisplayName || b.supplierName || '—'}</td>
                    <td className="num">{kg(rec)}</td>
                    <td className="num strong">{kg(av)}</td>
                    <td><span className="reach ok"><span className="rt" aria-hidden="true"><i style={{ width: `${used}%` }} /></span><span className="rv">{pct(used)}</span></span></td>
                    <td>{b.expiryDate ? <span className={dd !== null && dd < 0 ? 'crit-ink strong' : dd !== null && dd <= 3 ? 'warn-ink strong' : ''}>{fmtDate(dataZApi(b.expiryDate))}{dd !== null && <span className="sub">{dd < 0 ? `${-dd} dni po terminie` : dd === 0 ? 'dziś' : `za ${dd} dni`}</span>}</span> : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}
const planKg = (p: PlanLite) => p.lines.reduce((a, l) => a + l.qty * l.kgPerUnit, 0)
const planDoneKg = (p: PlanLite) => p.lines.reduce((a, l) => a + Math.min(l.qtyDone, l.qty) * l.kgPerUnit, 0)
/** Plany „w toku”: aktywne, nie zakończone; od najnowszej daty. */
const activePlans = (plans: PlanLite[]) => plans.filter(p => p.status === 'active').sort((a, b) => b.planDate.localeCompare(a.planDate))

// ─── Linia procesu ────────────────────────────────────────────────────────
function ProcessPanel({ open, ext }: { open: Open; ext: Ext }) {
  const app = useApp()
  const plans = activePlans(ext.plans)
  const pk = plans.reduce((a, p) => a + planKg(p), 0), pd = plans.reduce((a, p) => a + planDoneKg(p), 0)
  const seasonedFree = ext.seasoned.reduce((a, s) => a + Math.max(0, s.kgAvailable - s.kgReserved), 0)
  const seasonedAll = ext.seasoned.reduce((a, s) => a + s.kgAvailable, 0)
  const toMix = mixingByRecipe(open.filter(x => x.o.status !== 'draft').flatMap(x => x.o.lines.map(line => ({ line, orderNo: x.o.no }))))
  const meat = toMix.reduce((a, r) => a + (r.meatKg ?? 0), 0)
  const missing = open.filter(x => x.o.status !== 'draft').reduce((a, x) => a + x.m.missingKg, 0)
  const stages: Array<{ key: string; name: string; value: string; unit?: string; sub: string; level: 'ok' | 'warn' | 'crit' | 'idle'; progress?: number }> = [
    { key: 'przyjecia', name: 'Przyjęcie surowca', value: String(ext.haccp), unit: ext.haccp === 1 ? 'dostawa' : 'dostaw', sub: ext.haccp ? 'bez kompletu HACCP (14 dni)' : 'kontrole HACCP kompletne', level: ext.haccp ? 'warn' : 'ok' },
    { key: 'masowanie', name: 'Masowanie', value: num(meat), unit: 'kg', sub: `mięsa do zmasowania · przyprawione wolne ${num(seasonedFree)} z ${num(seasonedAll)} kg`, level: meat > 0 ? 'warn' : 'ok' },
    { key: 'realizacja', name: 'Produkcja', value: num(pd), unit: 'kg', sub: plans.length ? `z planów w toku ${num(pk)} kg · ${ext.pending} sesji do potwierdzenia` : 'brak planów w toku', level: ext.pending ? 'warn' : plans.length ? 'ok' : 'idle', progress: pk ? pd / pk : undefined },
    { key: 'magazyn-wg', name: 'Magazyn wyrobu', value: num(ext.stockKg), unit: 'kg', sub: `z zamówieniem ${num(ext.allocKg)} kg · wolne ${num(ext.stockKg - ext.allocKg)} kg`, level: 'ok' },
    { key: 'zamowienia', name: 'Zamówienia', value: num(missing), unit: 'kg', sub: `brak wyrobu w ${open.filter(x => x.m.missingKg > 0 && x.o.status !== 'draft').length} otwartych zamówieniach`, level: missing > 0 ? 'warn' : 'ok' },
    { key: 'wysylki', name: 'Wysyłka', value: String(ext.kursy.length), unit: ext.kursy.length === 1 ? 'kurs' : 'kursy', sub: ext.kursy.length ? `po załadunku · ${ext.kursy.filter(k => k.doWystawienia).length} do wystawienia dokumentów` : 'brak kursów do wydruku', level: ext.kursy.some(k => k.rozjazd) ? 'crit' : ext.kursy.some(k => k.doWystawienia) ? 'warn' : 'ok' },
  ]
  return (
    <section className="panel p-line" aria-label="Przebieg dnia">
      <div className="panel-h">
        <h2>Przebieg dnia</h2>
        <span className="sub">od przyjęcia surowca do wysyłki — kliknij etap, aby przejść do modułu</span>
        <span className="tools legend">
          <span><StageNode level="ok" size={11} /> w normie</span>
          <span><StageNode level="warn" size={11} /> wymaga uwagi</span>
          <span><StageNode level="crit" size={11} /> krytyczne</span>
        </span>
      </div>
      <div className="pline">
        {stages.map(s => (
          <button key={s.key} className={`pstage ${s.level}`} onClick={() => s.key === 'zamowienia' ? app.gotoOrders({ view: 'active' }) : app.openModule(s.key)}
            aria-label={`${s.name}: ${s.value} ${s.unit ?? ''}, ${LEVEL_WORD[s.level]}. ${s.sub}`}>
            <span className="rail" />
            <span className="ph"><span className="node"><StageNode level={s.level} /></span><span className="pn">{s.name}</span></span>
            <span className="pv num">{s.value}<small>{s.unit}</small></span>
            <span className="ps" title={s.sub}>{s.sub}</span>
            {s.progress !== undefined && <span className="pb"><i style={{ width: `${Math.min(100, s.progress * 100)}%` }} /></span>}
          </button>
        ))}
      </div>
    </section>
  )
}

// ─── Wymaga uwagi ─────────────────────────────────────────────────────────
interface AttnItem { key: string; level: Level; title: React.ReactNode; detail: string; tags: React.ReactNode[]; action: string; run: () => void }

function AttentionPanel({ open, ext }: { open: Open; ext: Ext }) {
  const app = useApp()
  const items: AttnItem[] = []
  const rank: Record<Level, number> = { crit: 0, warn: 1, info: 2 }

  for (const { o, m } of open) {
    const serious = m.flags.filter(f => f.level !== 'info')
    if (!serious.length) continue
    const top = serious[0]
    const tab: DetailTab = top.code === 'pallets' ? 'pallets' : top.code === 'material' ? 'production' : 'coverage'
    items.push({
      key: o.id, level: serious.some(f => f.level === 'crit') ? 'crit' : 'warn',
      title: <><span className="num">{o.no}</span> · {o.client.name}</>,
      detail: serious.map(f => f.detail).join(' '),
      tags: serious.map(f => <span key={f.code} className={`tag ${f.level}`}>{f.label}</span>),
      action: tab === 'pallets' ? 'Rozpisz palety' : tab === 'production' ? 'Sprawdź produkcję' : 'Pokaż pokrycie',
      run: () => app.gotoOrders({ select: o.id, tab, view: 'active' }),
    })
  }
  if (ext.pending > 0) items.push({ key: 'sesje', level: 'warn', title: `${ext.pending} ${ext.pending === 1 ? 'sesja produkcyjna czeka' : 'sesje produkcyjne czekają'} na potwierdzenie`, detail: 'Bez potwierdzenia biura raport dzienny jest niepełny. Potwierdzenie — w starym MES (faza 5 próby).', tags: [], action: 'Realizacja', run: () => app.openModule('realizacja') })
  if (ext.haccp > 0) items.push({ key: 'haccp', level: 'warn', title: `${ext.haccp} ${ext.haccp === 1 ? 'dostawa' : 'dostaw'} bez kompletu kontroli HACCP`, detail: 'Ostatnie 14 dni. Uzupełnij w Przyjęciach surowca — widok „Bez HACCP”, zakładka Kontrola HACCP.', tags: [], action: 'Przyjęcia', run: () => app.openModule('przyjecia') })
  for (const k of ext.kursy.filter(k => k.rozjazd || k.doWystawienia)) {
    items.push({ key: `kurs-${k.id}`, level: k.rozjazd ? 'crit' : 'info', title: `Kurs ${k.plate || '—'} · ${k.klienci.join(', ')}`, detail: k.rozjazd ? 'Rozjazd między dokumentem a załadunkiem — sprawdź przed wydrukiem.' : 'Załadunek zakończony, dokumenty do wystawienia.', tags: [], action: 'Papiery kursu', run: () => app.openKurs(k.id, k.plate) })
  }
  items.sort((a, b) => rank[a.level] - rank[b.level])
  const crit = items.filter(i => i.level === 'crit').length

  return (
    <section className="panel" aria-label="Wymaga uwagi">
      <div className="panel-h">
        <h2>Wymaga uwagi</h2>
        <span className="sub">{items.length} spraw · {crit} krytyczne</span>
      </div>
      <div className="panel-b">
        <ul className="attn">
          {items.map(it => (
            <li key={it.key} className={it.level}>
              <span className={`ai alert-ico ${it.level}`}><FlagIcon level={it.level} size={17} /></span>
              <span className="at">{it.title}</span>
              <span className="ad">{it.detail}</span>
              {it.tags.length > 0 && <span className="am">{it.tags}</span>}
              <button className="btn sm act" onClick={it.run}>{it.action}<ArrowRight size={14} /></button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

// ─── Produkcja: plany w toku ──────────────────────────────────────────────
function ProductionPanel({ plans }: { plans: PlanLite[] }) {
  const act = activePlans(plans)
  const byRecipe = new Map<string, { plannedKg: number; reportedKg: number; plans: Set<string> }>()
  for (const p of act) for (const l of p.lines) {
    const x = byRecipe.get(l.recipeName) ?? { plannedKg: 0, reportedKg: 0, plans: new Set<string>() }
    x.plannedKg += l.qty * l.kgPerUnit; x.reportedKg += Math.min(l.qtyDone, l.qty) * l.kgPerUnit; x.plans.add(p.planNo)
    byRecipe.set(l.recipeName, x)
  }
  const rows = [...byRecipe.entries()].map(([recipe, x]) => ({ recipe, ...x })).sort((a, b) => b.plannedKg - a.plannedKg)
  const plan = rows.reduce((a, r) => a + r.plannedKg, 0)
  const rep = rows.reduce((a, r) => a + r.reportedKg, 0)
  const max = Math.max(1, ...rows.map(r => r.plannedKg))
  const newest = act[0]
  return (
    <section className="panel" aria-label="Produkcja — plany w toku">
      <div className="panel-h">
        <h2>Produkcja</h2>
        <span className="sub">plany w toku · zgłoszono / zaplanowano</span>
      </div>
      <div className="panel-b" style={{ display: 'flex', flexDirection: 'column' }}>
        {rows.length === 0 ? <div className="empty">Brak aktywnych planów produkcji.</div> : <>
          <div style={{ padding: '12px 14px 2px', display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap' }}>
            <div className="hero-fig"><span className="v">{num(rep)}</span><span className="of">z {kg(plan)}</span></div>
            <span className="tag info">{pct(plan ? (rep / plan) * 100 : 0)} planów</span>
            <span className="tag outline" data-tip={act.map(p => `${p.planNo} (${fmtDate(dataZApi(p.planDate))})`).join('\n')}>{act.length} {act.length === 1 ? 'plan' : 'planów'} · najnowszy {newest ? fmtDay(dataZApi(newest.planDate)) : '—'}</span>
          </div>
          <div className="bullets">
            {rows.map(r => (
              <div key={r.recipe} className={`bullet${r.reportedKg === 0 ? ' idle' : ''}`}>
                <span className="bn">{r.recipe}<small>{[...r.plans].join(', ')}</small></span>
                <span className="bt" data-tip={`${r.recipe}: zgłoszono ${kg(r.reportedKg)} z ${kg(r.plannedKg)} (${pct(r.plannedKg ? r.reportedKg / r.plannedKg * 100 : 0)})`}>
                  <i className="plan" style={{ width: `${(r.plannedKg / max) * 100}%` }} />
                  {r.reportedKg > 0 && <i className="rep" style={{ width: `${(r.reportedKg / max) * 100}%` }} />}
                </span>
                <span className="bv">{r.reportedKg === 0 ? <span className="muted">nie rozpoczęto</span> : <><b>{num(r.reportedKg)}</b> / {num(r.plannedKg)} kg</>}</span>
              </div>
            ))}
          </div>
        </>}
      </div>
    </section>
  )
}

// ─── Terminy ──────────────────────────────────────────────────────────────
function DuePanel({ open }: { open: Open }) {
  const app = useApp()
  const buckets: Bucket[] = ['overdue', 'today', 'tomorrow', 'week', 'later', 'nodate']
  const sub: Partial<Record<Bucket, string>> = {
    today: `${weekday(TODAY)} ${fmtDay(TODAY)}`, tomorrow: `${weekday(addDays(TODAY, 1))} ${fmtDay(addDays(TODAY, 1))}`,
    week: `do ${fmtDay(addDays(TODAY, 7))}`, later: `od ${fmtDay(addDays(TODAY, 8))}`, nodate: 'bez daty wyjazdu', overdue: 'termin minął',
  }
  const rows = buckets.map(b => {
    const xs = open.filter(x => x.m.bucket === b)
    return { b, n: xs.length, ordered: xs.reduce((a, x) => a + x.m.orderedKg, 0), missing: xs.reduce((a, x) => a + x.m.missingKg, 0) }
  })
  const tot = rows.reduce((a, r) => ({ n: a.n + r.n, ordered: a.ordered + r.ordered, missing: a.missing + r.missing }), { n: 0, ordered: 0, missing: 0 })
  return (
    <section className="panel" aria-label="Terminy zamówień">
      <div className="panel-h"><h2>Terminy zamówień</h2><span className="sub">otwarte, wg terminu wyjazdu</span></div>
      <div className="panel-b">
        <table className="ladder">
          <thead><tr><th>Termin</th><th className="num" style={{ textAlign: 'right' }}>Zam.</th><th style={{ textAlign: 'right' }}>Zamówiono</th><th style={{ textAlign: 'right' }}>Brak wyrobu</th></tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.b} className={`click ${r.b}`} tabIndex={0} onClick={() => app.gotoOrders({ view: 'active', bucket: r.b })}
                onKeyDown={e => { if (e.key === 'Enter') app.gotoOrders({ view: 'active', bucket: r.b }) }}
                data-tip={`Pokaż zamówienia: ${BUCKET_LABEL[r.b].toLowerCase()}`}>
                <td><span className="lb">{BUCKET_LABEL[r.b]}<small>{sub[r.b]}</small></span></td>
                <td className="num strong">{r.n}</td>
                <td className="num">{kg(r.ordered)}</td>
                <td className="num">{r.missing > 0
                  ? <span className={r.b === 'overdue' || r.b === 'today' ? 'crit-ink strong' : r.b === 'tomorrow' ? 'warn-ink strong' : ''}>{kg(r.missing)}</span>
                  : <span className="ok-ink">komplet</span>}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr><td className="strong" style={{ height: 34 }}>Razem</td><td className="num strong">{tot.n}</td><td className="num strong">{kg(tot.ordered)}</td><td className="num strong">{kg(tot.missing)}</td></tr></tfoot>
        </table>
      </div>
    </section>
  )
}

// ─── Wysyłki: kursy po załadunku ──────────────────────────────────────────
function ShipmentsPanel({ kursy }: { kursy: ZaladunekDoWydruku[] }) {
  const app = useApp()
  return (
    <section className="panel p-ship" aria-label="Kursy po załadunku">
      <div className="panel-h"><h2>Kursy po załadunku</h2><span className="sub">dokumenty dla kierowcy do wydruku</span>
        <span className="tools"><button className="btn sm ghost" onClick={() => app.openModule('wysylki')}>Wszystkie kursy<ArrowRight size={14} /></button></span>
      </div>
      <div className="panel-b">
        <table className="tbl">
          <thead><tr><th>Załadunek</th><th>Pojazd</th><th>Odbiorcy</th><th className="r">Dokumenty</th><th>Stan</th></tr></thead>
          <tbody>
            {kursy.length === 0 && <tr><td colSpan={5}><div className="empty">Brak kursów czekających na wydruk dokumentów.</div></td></tr>}
            {kursy.map(k => {
              const d = k.finishedAt ? new Date(k.finishedAt) : null
              return (
                <tr key={k.id} className="row click" onClick={() => app.openKurs(k.id, k.plate)} data-tip="Otwórz papiery kursu">
                  <td className="num strong">{d && !Number.isNaN(d.getTime()) ? d.toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                  <td className="num">{k.plate || '—'}</td>
                  <td className="ell" style={{ maxWidth: 320 }}>{k.klienci.join(', ') || '—'}</td>
                  <td className="num">{k.dokumentow}</td>
                  <td>{k.rozjazd ? <span className="tag crit">Rozjazd</span> : k.doWystawienia ? <span className="tag warn">Do wystawienia</span> : <span className="tag ok">Wystawione</span>}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}

// ─── Półprodukty: mięso przyprawione a potrzeby zamówień ─────────────────
function MaterialsPanel({ open, seasoned }: { open: Open; seasoned: SeasonedLite[] }) {
  // Wyrób do zmasowania liczy backend z POKRYCIA zamówień; porównujemy go z wolnym mięsem przyprawionym tej receptury.
  const need = mixingByRecipe(open.filter(x => x.o.status !== 'draft').flatMap(x => x.o.lines.map(line => ({ line, orderNo: x.o.no }))))
  const byId = new Map<string, { name: string; free: number; all: number }>()
  for (const s of seasoned) {
    const x = byId.get(s.recipeId) ?? { name: s.recipeName, free: 0, all: 0 }
    x.free += Math.max(0, s.kgAvailable - s.kgReserved); x.all += s.kgAvailable
    byId.set(s.recipeId, x)
  }
  const names = new Set([...need.map(n => n.recipe), ...[...byId.values()].map(v => v.name)])
  const rows = [...names].map(name => {
    const n = need.find(x => x.recipe === name)
    const s = [...byId.values()].find(v => v.name === name)
    const req = n?.remainingKg ?? 0
    const free = s?.free ?? 0
    const level = req > 0 && free < req ? (free <= 0 ? 'crit' : 'warn') : 'ok'
    return { name, req, free, all: s?.all ?? 0, level, known: n?.known ?? true }
  }).sort((a, b) => (b.req - b.free) - (a.req - a.free))
  return (
    <section className="panel" aria-label="Mięso przyprawione">
      <div className="panel-h"><h2>Mięso przyprawione</h2><span className="sub">wolne w magazynie a wyrób do zrobienia z zamówień</span></div>
      <div className="panel-b">
        <table className="tbl">
          <thead><tr><th>Receptura</th><th className="r">Wolne</th><th className="r hide-m" data-tip="Wyrób do zmasowania z otwartych zamówień (backend, z pokrycia)">Potrzeba</th><th>Pokrycie</th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={4}><div className="empty">Brak mięsa przyprawionego i potrzeb.</div></td></tr>}
            {rows.map(r => (
              <tr key={r.name} className="row" data-tip={`${r.name}\nW magazynie ${num(r.all)} kg, wolne (bez rezerwacji) ${num(r.free)} kg\nPotrzeba z zamówień: ${r.known ? `${num(r.req)} kg` : 'nieznana (receptura bez składu)'}`}>
                <td className="ell" style={{ width: '100%' }}><span className={r.level === 'crit' ? 'strong' : ''}>{r.name}</span></td>
                <td className="num">{num(r.free)} kg</td>
                <td className="num hide-m">{r.known ? `${num(r.req)} kg` : '—'}</td>
                <td>
                  {r.req > 0 ? <span className={`reach ${r.level}`}>
                    <span className="rt" aria-hidden="true"><i style={{ width: `${Math.min(100, (r.free / r.req) * 100)}%` }} /></span>
                    <span className="rv">{pct(Math.min(999, (r.free / r.req) * 100))}</span>
                  </span> : <span className="faint">bez potrzeb</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="panel-f"><span>Rezerwacje pod plany produkcji nie są „wolne”.</span></div>
    </section>
  )
}
