import React, { useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, ChevronDown, Radio, Scale, Hand, HelpCircle, Building2, BarChart3 } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useApi } from '@/hooks/useApi'
import { useLiveRefresh } from '@/hooks/useLiveRefresh'
import { deboningApi, type DeboningStats } from '@/lib/api'
import { num } from '../../../data/model'
import { ile } from '../../../data/tekst'
import { Pusto } from '../../../ui/Pusto'
import { SzkieletBloku } from '../../../ui/Szkielet'
import { FlagIcon } from '../../../ui/Glyphs'
import {
  ETYKIETA_BILANSU, ETYKIETA_OKRESU, delta, okres, opisOkresu, pasekBilansu, przesun, tekstZWagi,
  type Okres, type RodzajOkresu,
} from './model'

/** kg z jednym miejscem (waga rozbioru idzie co 0,5 kg). */
const kg = (v: number | null | undefined) => {
  if (v == null) return '—'
  const r = Math.round(v * 10) / 10
  const cale = Math.trunc(r), d = Math.round(Math.abs(r - cale) * 10)
  return `${num(cale)}${d ? `,${d}` : ''} kg`
}
const proc = (v: number | null | undefined) => v == null ? '—' : `${(Math.round(v * 10) / 10).toLocaleString('pl-PL', { maximumFractionDigits: 1 })}%`
const pp = (v: number | null | undefined) => v == null ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(Math.round(v * 10) / 10).toLocaleString('pl-PL', { maximumFractionDigits: 1 })} p.p.`
const godz = (iso: string | null) => iso ? new Date(iso).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' }) : '—'
const dzienGodz = (iso: string | null) => iso ? new Date(iso).toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'
const FRAKCJA = { meat: 'mięso', backs: 'grzbiety', bones: 'kości' } as const
const PRESETY: RodzajOkresu[] = ['dzis', 'wczoraj', '7dni', 'miesiac']

type Delta = ReturnType<typeof delta>
function Kafel({ k, v, s, d, tip, children }: { k: string; v?: React.ReactNode; s?: React.ReactNode; d?: Delta; tip?: string; children?: React.ReactNode }) {
  return (
    <div className="rs-kpi" data-tip={tip}>
      <span className="k">{k}</span>
      {children ?? <span className="v">{v}</span>}
      <span className="s">{s}{d && <span className={`rs-d ${d.poziom}`}>{d.tekst}</span>}</span>
    </div>
  )
}

/**
 * Statystyki rozbioru dla biura i szefa: dziś na żywo i dowolny okres archiwalny.
 * Liczby z tego samego liczenia co płace i stary raport (`/api/deboning/stats?extended=true`).
 */
export function Statystyki({ active, onPartia }: { active: boolean; onPartia: (batchNo: string) => void }) {
  const [rodzaj, setRodzaj] = useState<RodzajOkresu>('dzis')
  const [o, setO] = useState<Okres>(() => okres('dzis', new Date()))
  const teraz = new Date()
  const naZywo = okres('zakres', teraz, o).naZywo
  // Dane pamiętają swój okres: po zmianie okresu stare liczby nie stoją pod nowym opisem.
  const klucz = `${o.od}|${o.do}`
  const res = useApi(() => deboningApi.stats(o.od, o.do, true).then(s => ({ klucz: `${o.od}|${o.do}`, s })), [o.od, o.do])
  useLiveRefresh(active && naZywo ? { res } : {}, 30_000)
  const reczneRef = useRef<HTMLElement>(null)

  const wybierz = (r: RodzajOkresu) => { setRodzaj(r); setO(okres(r, new Date())) }
  const przesunO = (k: -1 | 1) => { setRodzaj('zakres'); setO(prev => przesun(prev, k, new Date())) }
  const s = res.data && res.data.klucz === klucz ? res.data.s : null
  const pusto = s && s.summary.quarters === 0 && s.summary.kgBacks === 0 && s.summary.kgBones === 0

  return (
    <div className="rs">
      <div className="rs-bar">
        <div className="seg" role="group" aria-label="Okres">
          {PRESETY.map(r => <button key={r} type="button" aria-pressed={rodzaj === r} onClick={() => wybierz(r)}>{ETYKIETA_OKRESU[r]}</button>)}
        </div>
        <div className="rs-nav">
          <button type="button" className="btn sm ghost" aria-label="Poprzedni okres" onClick={() => przesunO(-1)}><ChevronLeft size={15} /></button>
          <label className="rs-date">
            <input type="date" className="field" value={o.od} max={o.do} aria-label="Od dnia" onChange={e => { if (e.target.value) { setRodzaj('zakres'); setO(p => ({ od: e.target.value, do: p.do < e.target.value ? e.target.value : p.do })) } }} /></label>
          <span className="faint">–</span>
          <label className="rs-date">
            <input type="date" className="field" value={o.do} min={o.od} aria-label="Do dnia" onChange={e => { if (e.target.value) { setRodzaj('zakres'); setO(p => ({ od: p.od > e.target.value ? e.target.value : p.od, do: e.target.value })) } }} /></label>
          <button type="button" className="btn sm ghost" aria-label="Następny okres" disabled={przesun(o, 1, teraz) === o} onClick={() => przesunO(1)}><ChevronRight size={15} /></button>
        </div>
        <span className="rs-okres">{opisOkresu(o)}</span>
        {naZywo && <span className="rs-live"><Radio size={13} aria-hidden />na żywo · odświeżane co 30 s</span>}
      </div>

      {res.error && <div className="note crit" role="alert"><FlagIcon level="crit" size={15} /><div><b>Serwer odmówił:</b> {res.error}</div></div>}
      {!s && !res.error && <SzkieletBloku linie={6} opis="Liczę statystyki rozbioru…" />}
      {s && pusto && <Pusto ikona={<BarChart3 size={22} />} tytul={o.od === o.do ? 'W tym dniu nie było rozbioru' : 'W tym okresie nie było rozbioru'}>
        Wybierz inny dzień strzałkami albo okres u góry.</Pusto>}
      {s && !pusto && <>
        <Kafle s={s} onReczne={() => reczneRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })} />
        <Bilans s={s} />
        {s.live && <NaZywo live={s.live} />}
        <Przebieg s={s} jedenDzien={o.od === o.do} />
        <Pracownicy s={s} />
        <Partie s={s} onPartia={onPartia} />
        <Reczne s={s} innerRef={reczneRef} />
        <Stopka s={s} />
      </>}
    </div>
  )
}

function Kafle({ s, onReczne }: { s: DeboningStats; onReczne: () => void }) {
  const p = s.previous
  const zs = s.summary.meatByType?.zs, bs = s.summary.meatByType?.bs
  const okresP = p ? `${p.dateFrom === p.dateTo ? p.dateFrom.split('-').reverse().slice(0, 2).join('.') : `${p.dateFrom.slice(5).split('-').reverse().join('.')}–${p.dateTo.slice(5).split('-').reverse().join('.')}`}${p.untilTime ? ` do ${p.untilTime}` : ''}` : ''
  const nadwyzka = s.summary.missingKg < 0
  return (
    <section className="rs-kpis" aria-label="Najważniejsze liczby">
      <Kafel k="Pobrano ćwiartki" v={kg(s.summary.kgQuarter)} s={`${ile(s.summary.quarters, 'pobranie', 'pobrania', 'pobrań')} `}
        d={delta(s.summary.kgQuarter, p?.kgQuarter, 'brak', '%')} tip="Pobranie liczone nominalnie (pojemniki × kg), nie ważone" />
      <Kafel k="Wydajność z/s" v={proc(zs ? zs.yieldPct : s.summary.avgYield)} s={`mięso z/s ${kg(zs?.kgMeat ?? s.summary.kgMeat)} `}
        d={delta(zs?.yieldPct, p?.yieldZs, 'wiecej', 'pp')} tip={p ? `Porównanie: ${okresP}` : undefined} />
      <Kafel k="Mięso b/s" v={bs && bs.kgMeat > 0 ? kg(bs.kgMeat) : '—'} s={bs && bs.kgMeat > 0 ? `wydajność ${proc(bs.yieldPct)}` : 'bez b/s w okresie'}
        tip="Bez skóry — osobno, żeby nie zaniżało wydajności z/s" />
      <Kafel k="Grzbiety" v={proc(s.summary.backsPct)} s={`${kg(s.summary.kgBacks)} `} d={delta(s.summary.backsPct, p?.backsPct, 'brak', 'pp')} />
      <Kafel k="Kości" v={proc(s.summary.bonesPct)} s={`${kg(s.summary.kgBones)} `} d={delta(s.summary.bonesPct, p?.bonesPct, 'brak', 'pp')} />
      <Kafel k={nadwyzka ? 'Nadwyżka' : 'Ubytek'} v={proc(Math.abs(s.summary.missingPct))} s={`${kg(Math.abs(s.summary.missingKg))} `}
        d={nadwyzka ? null : delta(s.summary.missingPct, p?.missingPct, 'mniej', 'pp')}
        tip="Ćwiartka − (mięso + grzbiety + kości). Nadwyżka = więcej niż w dokumencie dostawcy" />
      <Kafel k="Tempo" v={`${num(s.summary.kgPerHour)} kg/h`} s={`mięsa na osobogodzinę · ${ile(s.summary.headcount, 'osoba', 'osoby', 'osób')} `}
        d={delta(s.summary.kgPerHour, p?.kgPerHour, 'wiecej', '%')} />
      <Kafel k="Ważenie" s={<>{s.weighing && s.weighing.autoPct != null ? 'mięso, grzbiety, kości ' : 'brak zapisu trybu '}</>}
        d={s.weighing ? delta(s.weighing.autoPct, p?.autoPct, 'wiecej', 'pp') : null} tip="Udział kilogramów zważonych na wadze (bez nieznanych i korekt biura)">
        {s.weighing
          ? <button type="button" className={`v rs-link${s.weighing.manualCount ? ' warn-ink' : ''}`} onClick={onReczne}>{tekstZWagi(s.weighing)}</button>
          : <span className="v">—</span>}
      </Kafel>
    </section>
  )
}

function Bilans({ s }: { s: DeboningStats }) {
  const czesci = pasekBilansu(s)
  return (
    <section className="panel rs-panel" aria-label="Bilans masy">
      <div className="panel-h"><h2>Bilans masy</h2><span className="sub">ćwiartka {kg(s.summary.kgQuarter)} = 100%</span></div>
      <div className="rs-stack" role="img" aria-label={czesci.map(c => `${ETYKIETA_BILANSU[c.klucz]} ${proc(c.pct)}`).join(', ')}>
        {czesci.filter(c => c.pct > 0).map(c => <i key={c.klucz} className={`rs-seg ${c.klucz}`} style={{ flexGrow: c.pct }} data-tip={`${ETYKIETA_BILANSU[c.klucz]}: ${kg(c.kg)} · ${proc(c.pct)}`} />)}
      </div>
      <ul className="rs-legend">
        {czesci.map(c => (
          <li key={c.klucz}><i className={`rs-sw ${c.klucz}`} aria-hidden />
            <span>{c.klucz === 'ubytek' && c.kg < 0 ? 'Nadwyżka' : ETYKIETA_BILANSU[c.klucz]}</span>
            <b>{kg(Math.abs(c.kg))}</b><span className="faint">{c.kg < 0 ? 'ponad dokument' : proc(c.pct)}</span></li>
        ))}
      </ul>
    </section>
  )
}

function NaZywo({ live }: { live: NonNullable<DeboningStats['live']> }) {
  return (
    <section className="panel rs-panel" aria-label="Na żywo">
      <div className="panel-h"><h2>Na hali teraz</h2>
        <span className="sub">{ile(live.openTakes.length, 'pobranie', 'pobrania', 'pobrań')} w toku · w ostatniej godzinie ważyło {ile(live.peopleLastHour, 'osoba', 'osoby', 'osób')}</span></div>
      {live.openTakes.length > 0 && <table className="tbl rs-tbl">
        <thead><tr><th>Pracownik</th><th>Partia</th><th className="num">Pobrano</th><th>Od</th></tr></thead>
        <tbody>{live.openTakes.map(t => (
          <tr key={t.entryId} className="row"><td className="strong">{t.workerName}</td><td className="code">{t.batchNo}</td>
            <td className="num">{kg(t.kgQuarter)}</td><td className="tnum">{dzienGodz(t.since)}</td></tr>
        ))}</tbody>
      </table>}
    </section>
  )
}

function TipWykresu({ active, payload, label, opis }: { active?: boolean; payload?: Array<{ value: number; payload: Record<string, number> }>; label?: string; opis: (p: Record<string, number>, l: string) => React.ReactNode }) {
  if (!active || !payload?.length) return null
  return <div className="tip rs-tip">{opis(payload[0].payload, label ?? '')}</div>
}

function Przebieg({ s, jedenDzien }: { s: DeboningStats; jedenDzien: boolean }) {
  const godziny = useMemo(() => s.byHour.map(h => ({ ...h, l: h.hour.slice(11, 13) })), [s.byHour])
  const dni = useMemo(() => s.byDay.map(d => ({ ...d, l: d.date.slice(5).split('-').reverse().join('.') })), [s.byDay])
  const os = { stroke: 'var(--line)', tick: { fill: 'var(--ink-3)', fontSize: 12 } }
  return (
    <section className="panel rs-panel" aria-label="Przebieg">
      <div className="panel-h"><h2>Przebieg</h2><span className="sub">{jedenDzien ? 'kg mięsa w każdej godzinie (wg godziny pobrania)' : 'kg mięsa i wydajność dzień po dniu'}</span></div>
      {jedenDzien ? (
        <div className="rs-chart"><ResponsiveContainer width="100%" height={200}>
          <BarChart data={godziny} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--line-soft)" />
            <XAxis dataKey="l" {...os} tickLine={false} />
            <YAxis {...os} tickLine={false} axisLine={false} width={48} tickFormatter={v => num(v)} />
            <Tooltip cursor={{ fill: 'var(--row-hover)' }} content={<TipWykresu opis={(p, l) => <><b>godz. {l}:00</b><br />{kg(p.kgMeat)} mięsa · {ile(p.quarters, 'pobranie', 'pobrania', 'pobrań')}</>} />} />
            <Bar dataKey="kgMeat" fill="var(--viz-1)" radius={[4, 4, 0, 0]} maxBarSize={36} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer></div>
      ) : (
        <div className="rs-charts2">
          <div className="rs-chart"><h3>kg mięsa</h3><ResponsiveContainer width="100%" height={180}>
            <BarChart data={dni} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--line-soft)" />
              <XAxis dataKey="l" {...os} tickLine={false} minTickGap={12} />
              <YAxis {...os} tickLine={false} axisLine={false} width={52} tickFormatter={v => num(v)} />
              <Tooltip cursor={{ fill: 'var(--row-hover)' }} content={<TipWykresu opis={(p, l) => <><b>{l}</b><br />{kg(p.kgMeat)} mięsa · {ile(p.quarters, 'pobranie', 'pobrania', 'pobrań')}</>} />} />
              <Bar dataKey="kgMeat" fill="var(--viz-1)" radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer></div>
          <div className="rs-chart"><h3>wydajność mięsa (z/s + b/s)</h3><ResponsiveContainer width="100%" height={180}>
            <LineChart data={dni} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--line-soft)" />
              <XAxis dataKey="l" {...os} tickLine={false} minTickGap={12} />
              <YAxis {...os} tickLine={false} axisLine={false} width={44} domain={['dataMin - 2', 'dataMax + 2']} tickFormatter={v => `${Math.round(v)}%`} />
              <Tooltip content={<TipWykresu opis={(p, l) => <><b>{l}</b><br />wydajność {proc(p.avgYield)}</>} />} />
              <Line dataKey="avgYield" stroke="var(--viz-1)" strokeWidth={2} dot={{ r: 4, fill: 'var(--viz-1)', stroke: 'var(--surface)', strokeWidth: 2 }} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer></div>
        </div>
      )}
    </section>
  )
}

type KolPrac = 'workerName' | 'kgQuarter' | 'quarters' | 'kgMeat' | 'avgYield' | 'yieldVsBatchPp' | 'kgPerHour' | 'manualWeighings'
function Pracownicy({ s }: { s: DeboningStats }) {
  const [sort, setSort] = useState<{ k: KolPrac; dir: 1 | -1 }>({ k: 'kgQuarter', dir: -1 })
  const [otwarty, setOtwarty] = useState<string | null>(null)
  const furtki = s.overrides?.byWorker ?? {}
  const wiersze = useMemo(() => [...s.workers].sort((a, b) => {
    const x = a[sort.k] as unknown, y = b[sort.k] as unknown
    return (typeof x === 'string' ? String(x).localeCompare(String(y), 'pl') : (Number(x ?? -1e9) - Number(y ?? -1e9))) * sort.dir
  }), [s.workers, sort])
  const Th = ({ k, children, num: n }: { k: KolPrac; children: React.ReactNode; num?: boolean }) => (
    <th className={n ? 'num' : undefined} aria-sort={sort.k === k ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}>
      <button type="button" className="rs-th" onClick={() => setSort(p => ({ k, dir: p.k === k ? (p.dir === 1 ? -1 : 1) : (k === 'workerName' ? 1 : -1) }))}>{children}</button></th>)
  return (
    <section className="panel rs-panel" aria-label="Pracownicy">
      <div className="panel-h"><h2>Pracownicy</h2><span className="sub">kliknij nagłówek, by sortować · wiersz, by zobaczyć dni</span></div>
      <table className="tbl rs-tbl">
        <thead><tr><th style={{ width: 24 }} /><Th k="workerName">Pracownik</Th><Th k="kgQuarter" num>Pobrano</Th><Th k="quarters" num>Pobrań</Th><Th k="kgMeat" num>Mięso</Th>
          <Th k="avgYield" num>Wydajność</Th><Th k="yieldVsBatchPp" num>vs partia</Th><Th k="kgPerHour" num>kg/h</Th><Th k="manualWeighings" num>Ręcznie</Th><th className="num">Furtka 0099</th></tr></thead>
        <tbody>{wiersze.map(w => {
          const dni = s.workerDaily[w.workerId] ?? []
          const otw = otwarty === w.workerId
          return (
            <React.Fragment key={w.workerId}>
              <tr className={`row${otw ? ' sel' : ''}`} onClick={() => setOtwarty(otw ? null : w.workerId)} aria-expanded={otw}>
                <td className="c">{otw ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</td>
                <td className="strong">{w.workerName}{w.crewSize > 1 && <span className="tag" style={{ marginLeft: 6 }}>para</span>}</td>
                <td className="num">{kg(w.kgQuarter)}</td><td className="num">{num(w.quarters)}</td><td className="num">{kg(w.kgMeat)}</td>
                <td className="num strong">{proc(w.avgYield)}</td>
                <td className={`num${w.yieldVsBatchPp != null && w.yieldVsBatchPp < -2 ? ' warn-ink' : ''}`} data-tip="Wydajność względem średniej własnych partii — zdejmuje wpływ surowca">{pp(w.yieldVsBatchPp)}</td>
                <td className="num">{num(w.kgPerHour)}</td>
                <td className={`num${w.manualWeighings ? ' warn-ink strong' : ' faint'}`} data-tip={w.manualWeighings ? `${kg(w.manualKg)} wpisane ręcznie z ${w.weighings ?? 0} ważeń` : undefined}>{w.manualWeighings ?? '—'}</td>
                <td className={`num${furtki[w.workerId] ? ' warn-ink strong' : ' faint'}`}>{furtki[w.workerId] ?? '—'}</td>
              </tr>
              {otw && <tr className="rs-sub"><td colSpan={10}>
                <table className="tbl rs-dni"><thead><tr><th>Dzień</th><th className="num">Pobrań</th><th className="num">Pobrano</th><th className="num">Mięso</th><th className="num">Wydajność</th></tr></thead>
                  <tbody>{dni.map(d => <tr key={d.date}><td className="tnum">{d.date.split('-').reverse().join('.')}</td><td className="num">{d.quarters}</td>
                    <td className="num">{kg(d.kgQuarter)}</td><td className="num">{kg(d.kgMeat)}</td><td className="num">{proc(d.avgYield)}</td></tr>)}</tbody></table>
              </td></tr>}
            </React.Fragment>
          )
        })}</tbody>
      </table>
    </section>
  )
}

function Partie({ s, onPartia }: { s: DeboningStats; onPartia: (n: string) => void }) {
  const koszt = s.byBatch.some(b => b.meatCostPerKg != null)
  return (
    <section className="panel rs-panel" aria-label="Partie">
      <div className="panel-h"><h2>Partie</h2><span className="sub">wydajność i uboczne każdej partii · klik w numer → korekty partii</span></div>
      <table className="tbl rs-tbl">
        <thead><tr><th>Partia</th><th>Dostawca</th><th className="num">Pobrano</th><th className="num">Mięso</th><th className="num">Wydajność</th>
          <th className="num">Grzbiety</th><th className="num">Kości</th><th className="num">Ubytek</th>{koszt && <th className="num">Koszt 1 kg mięsa</th>}</tr></thead>
        <tbody>{s.byBatch.map(b => (
          <tr key={b.batchNo} className="row">
            <td className="code id-no"><button type="button" className="rs-link" aria-label={`Partia ${b.batchNo}`} onClick={() => onPartia(b.batchNo)}>{b.batchNo}</button></td>
            <td className="ell" style={{ maxWidth: 220 }}>{b.supplierName || '—'}</td>
            <td className="num">{kg(b.kgQuarter)}</td><td className="num">{kg(b.kgMeat)}</td><td className="num strong">{proc(b.yieldPct)}</td>
            <td className="num">{proc(b.backsPct)}</td><td className="num">{proc(b.bonesPct)}</td>
            <td className={`num${b.missingPct != null && b.missingPct > 6 ? ' crit-ink' : ''}`}>{b.missingKg == null ? '—' : b.missingKg < 0 ? `+${kg(-b.missingKg)}` : kg(b.missingKg)}</td>
            {koszt && <td className="num">{b.meatCostPerKg == null ? '—' : `${b.meatCostPerKg.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} zł`}</td>}
          </tr>
        ))}</tbody>
      </table>
    </section>
  )
}

function Reczne({ s, innerRef }: { s: DeboningStats; innerRef: React.RefObject<HTMLElement> }) {
  const w = s.weighing
  const lista = s.manualList ?? []
  return (
    <section ref={innerRef} className="panel rs-panel" aria-label="Ważenia ręczne">
      <div className="panel-h"><h2>Ważenia ręczne{w ? ` (${w.manualCount})` : ''}</h2><span className="sub">kilogramy wpisane na hali z klawiatury zamiast z wagi</span></div>
      {w && <div className="rs-zrodla">{(['meat', 'backs', 'bones'] as const).map(f => (
        <div key={f} className="rs-zrodlo"><b>{FRAKCJA[f]}</b>
          <span data-tip="z wagi"><Scale size={13} aria-hidden />{kg(w[f].auto.kg)}</span>
          <span className={w[f].manual.kg ? 'warn-ink' : undefined} data-tip="ręcznie"><Hand size={13} aria-hidden />{kg(w[f].manual.kg)}</span>
          {w[f].unknown.kg > 0 && <span className="faint" data-tip="tryb nieznany — hala nie zapisała, jak ważono"><HelpCircle size={13} aria-hidden />{kg(w[f].unknown.kg)}</span>}
          {w[f].office.kg !== 0 && <span className="faint" data-tip="korekta biura względem ważeń"><Building2 size={13} aria-hidden />{w[f].office.kg > 0 ? '+' : ''}{kg(w[f].office.kg)}</span>}
        </div>
      ))}</div>}
      {lista.length === 0
        ? <div className="muted rs-pad">Wszystko z wagi — w tym okresie nikt nie wpisał kilogramów ręcznie.</div>
        : <table className="tbl rs-tbl">
          <thead><tr><th>Kiedy</th><th>Pracownik</th><th>Partia</th><th>Co</th><th className="num">kg</th><th>Powód</th></tr></thead>
          <tbody>{lista.map((m, i) => (
            <tr key={i} className="row"><td className="tnum">{dzienGodz(m.at)}</td><td className="strong">{m.workerName ?? 'partia zbiorczo'}</td>
              <td className="code">{m.batchNo}</td><td>{FRAKCJA[m.fraction]}</td><td className="num">{kg(m.kg)}</td><td className="ell" style={{ maxWidth: 260 }}>{m.reason || '—'}</td></tr>
          ))}</tbody>
        </table>}
    </section>
  )
}

function Stopka({ s }: { s: DeboningStats }) {
  if (!s.corrections && !s.overrides) return null
  return (
    <p className="rs-stopka faint">
      Korekty wpisów: <b>{s.corrections?.edits ?? 0}</b> · usunięte wpisy (ze śladem): <b>{s.corrections?.deleted ?? 0}</b> ·
      furtka 0099: <b>{s.overrides?.total ?? 0}</b>{s.previous ? <> · porównanie z {s.previous.dateFrom === s.previous.dateTo ? s.previous.dateFrom.split('-').reverse().join('.') : `${s.previous.dateFrom.split('-').reverse().join('.')} – ${s.previous.dateTo.split('-').reverse().join('.')}`}{s.previous.untilTime ? ` do ${s.previous.untilTime}` : ''}</> : null}
      {' · '}ostatnie ważenie: {godz(Object.values(s.live?.lastWeighByWorker ?? {}).sort().pop() ?? null)}
    </p>
  )
}
