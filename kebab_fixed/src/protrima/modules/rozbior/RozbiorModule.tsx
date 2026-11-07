import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Scissors, RefreshCw, ChevronDown, ChevronRight, UserCog, PencilLine, Trash2, RotateCcw, Search, History } from 'lucide-react'
import { useApp, CommandBar, Dialog, type Cmd } from '../../shell/context'
import { kg as kgCale, num } from '../../data/model'
import { FlagIcon } from '../../ui/Glyphs'
import { Pusto } from '../../ui/Pusto'
import { SzkieletWierszy } from '../../ui/Szkielet'
import { useApi } from '@/hooks/useApi'
import { deboningEntriesApi, errStatus, usersApi, type DeboningPanelBatch, type EntryCorrection } from '@/lib/api'
import {
  ETYKIETA_STANU, akcjeWpisu, bilansWpisu, mapujWpis, opisKorekty, pracownicyRozbioru,
  type UsunietyWpis, type WpisRozbioru,
} from './model'

type Widok = 'partie' | 'usuniete'
type Okno = { rodzaj: 'pracownik' | 'kg' | 'usun'; w: WpisRozbioru } | { rodzaj: 'przywroc'; u: UsunietyWpis } | null

const czas = (iso: string) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}
/** Kilogramy z jednym miejscem po przecinku — waga rozbioru idzie co 0,5 kg, zaokrąglenie do całych przekłamuje akord. */
const kg = (v: number) => {
  const r = Math.round(v * 10) / 10, cale = Math.trunc(r), d = Math.round(Math.abs(r - cale) * 10)
  return d ? `${kgCale(cale).replace(' kg', '')},${d} kg` : kgCale(r)
}
const proc = (v: number | null) => (v == null ? '—' : `${v.toLocaleString('pl-PL', { maximumFractionDigits: 1 })}%`)
const liczba = (s: string) => { const v = parseFloat(s.replace(/\s/g, '').replace(',', '.')); return Number.isFinite(v) ? v : NaN }

/**
 * Rozbiór — korekty biura (port Panelu rozbioru ze starego MES, ulepszony):
 * partie z aktywnością rozbioru, wpisy z ubocznymi i bilansem, zmiana pracownika
 * także w pobraniu rozliczonym per pracownik, usuwanie z powodem, usunięte wpisy
 * z wagami i przywracaniem (także na innego pracownika). Każda zmiana ma powód
 * i trafia do historii wpisu — rusza wstecz akord pracownika.
 */
export function RozbiorModule({ active, setCtx, setCmds }: { active: boolean; setCtx: (n: React.ReactNode) => void; setCmds: (c: Cmd[]) => void }) {
  const app = useApp()
  const [widok, setWidok] = useState<Widok>('partie')
  const [szukaj, setSzukaj] = useState('')
  const panelRes = useApi(() => deboningEntriesApi.panel(60))
  const usunieteRes = useApi(() => deboningEntriesApi.deleted(14) as Promise<UsunietyWpis[]>)
  const ludzieRes = useApi(() => usersApi.list())
  const [otwarta, setOtwarta] = useState<string | null>(null)
  const [wpisy, setWpisy] = useState<Record<string, WpisRozbioru[] | 'blad' | 'laduje'>>({})
  const [okno, setOkno] = useState<Okno>(null)

  const wczytajWpisy = useCallback((rawBatchId: string) => {
    setWpisy(s => ({ ...s, [rawBatchId]: 'laduje' }))
    deboningEntriesApi.listByBatch(rawBatchId)
      .then(l => setWpisy(s => ({ ...s, [rawBatchId]: (l as Array<Record<string, unknown>>).map(mapujWpis) })))
      .catch(() => setWpisy(s => ({ ...s, [rawBatchId]: 'blad' })))
  }, [])
  const odswiez = useCallback(() => {
    void panelRes.refetch(); void usunieteRes.refetch()
    if (otwarta) wczytajWpisy(otwarta)
  }, [panelRes, usunieteRes, otwarta, wczytajWpisy])
  const przelacz = (b: DeboningPanelBatch) => {
    const n = otwarta === b.rawBatchId ? null : b.rawBatchId
    setOtwarta(n)
    if (n && !Array.isArray(wpisy[n])) wczytajWpisy(n)
  }

  const partie = useMemo(() => {
    const q = szukaj.trim().toLowerCase()
    const l = panelRes.data ?? []
    return q ? l.filter(b => b.batchNo.toLowerCase().includes(q) || (b.supplierName || '').toLowerCase().includes(q)) : l
  }, [panelRes.data, szukaj])
  const usuniete = useMemo(() => {
    const q = szukaj.trim().toLowerCase()
    const l = usunieteRes.data ?? []
    return q ? l.filter(u => u.rawBatchNo.toLowerCase().includes(q) || u.workerName.toLowerCase().includes(q)) : l
  }, [usunieteRes.data, szukaj])
  const doPrzywrocenia = (usunieteRes.data ?? []).filter(u => u.restorable).length

  const cmds = useMemo<Cmd[]>(() => [
    { id: 'reload', group: 1, label: 'Odśwież', icon: <RefreshCw size={17} />, run: odswiez },
  ], [odswiez])
  useEffect(() => { if (active) setCmds(cmds) }, [active, cmds, setCmds])
  useEffect(() => {
    if (!active) return
    setCtx(<span>Partie z rozbiorem <b>{num(partie.length)}</b> · usunięte (14 dni) <b>{num((usunieteRes.data ?? []).length)}</b>{doPrzywrocenia ? <> · do przywrócenia <b>{doPrzywrocenia}</b></> : null}</span>)
  }, [active, partie.length, usunieteRes.data, doPrzywrocenia, setCtx])

  const poZapisie = (tytul: string, detail?: string) => { app.toast({ kind: 'ok', title: tytul, detail }); setOkno(null); odswiez() }
  const ludzie = (ludzieRes.data ?? []) as Array<{ id: string; name: string; role?: string; active?: boolean }>

  return (
    <>
      <CommandBar title="Rozbiór" count="korekty biura — pracownik, usunięcie, przywrócenie" cmds={cmds} />
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <div className="dock-pad rz">
          <div className="rz-bar">
            <div className="seg" role="group" aria-label="Widok rozbioru">
              <button type="button" aria-pressed={widok === 'partie'} onClick={() => setWidok('partie')}>Partie i wpisy</button>
              <button type="button" aria-pressed={widok === 'usuniete'} onClick={() => setWidok('usuniete')}>Usunięte wpisy{doPrzywrocenia ? <span className="count warn"> {doPrzywrocenia}</span> : null}</button>
            </div>
            <label className="rz-search"><Search size={15} aria-hidden />
              <input className="field" value={szukaj} onChange={e => setSzukaj(e.target.value)} placeholder={widok === 'partie' ? 'Partia lub dostawca…' : 'Partia lub pracownik…'} aria-label="Szukaj w rozbiorze" /></label>
          </div>

          {widok === 'partie' && (panelRes.error
            ? <div className="note crit" role="alert"><FlagIcon level="crit" size={15} /><div><b>Serwer odmówił:</b> {panelRes.error}</div></div>
            : <div className="box"><table className="tbl rz-tbl">
              <thead><tr><th style={{ width: 28 }} /><th>Partia</th><th>Dostawca</th><th>Rozbiór</th><th className="num">Ćwiartka</th><th className="num">Mięso</th><th className="num">Grzbiety</th><th className="num">Kości</th><th className="num">Bilans</th><th className="num">Na stanie</th><th>Wpisy</th></tr></thead>
              <tbody>
                {panelRes.loading && !panelRes.data && <SzkieletWierszy kolumny={11} wiersze={6} />}
                {partie.map(b => <Partia key={b.rawBatchId} b={b} otwarta={otwarta === b.rawBatchId} wpisy={wpisy[b.rawBatchId]} onToggle={() => przelacz(b)} onAkcja={setOkno} onPonow={() => wczytajWpisy(b.rawBatchId)} />)}
                {!panelRes.loading && !partie.length && <tr><td colSpan={11} className="docs-empty">{szukaj ? 'Żadna partia nie pasuje do wyszukiwania.' : 'Brak partii z aktywnością rozbioru.'}</td></tr>}
              </tbody>
            </table></div>)}

          {widok === 'usuniete' && (usunieteRes.error
            ? <div className="note crit" role="alert"><FlagIcon level="crit" size={15} /><div><b>Serwer odmówił:</b> {usunieteRes.error}</div></div>
            : usuniete.length === 0 && !usunieteRes.loading
              ? <Pusto ikona={<Trash2 size={22} />} tytul="Brak usuniętych wpisów">W ostatnich 14 dniach nikt nie usunął wpisu rozbioru{szukaj ? ' pasującego do wyszukiwania' : ''}.</Pusto>
              : <div className="box"><table className="tbl rz-tbl">
                <thead><tr><th>Usunięto</th><th>Kto · powód</th><th>Pracownik</th><th>Partia</th><th className="num">Ćwiartka</th><th className="num">Mięso</th><th className="num">Grzbiety</th><th className="num">Kości</th><th /></tr></thead>
                <tbody>{usuniete.map((u, i) => (
                  <tr key={u.id} className={`row${i % 2 ? ' zebra' : ''}`}>
                    <td className="tnum">{czas(u.deletedAt)}</td>
                    <td className="ell" style={{ maxWidth: 260 }} title={u.reason}><b>{u.bySubject || '—'}</b>{u.reason ? <span className="sub">{u.reason}</span> : null}</td>
                    <td className="strong">{u.workerName || '—'}</td>
                    <td className="code">{u.rawBatchNo}</td>
                    <td className="num">{kg(u.kgQuarter)}</td><td className="num">{u.kgMeat ? kg(u.kgMeat) : '—'}</td>
                    <td className="num">{u.kgBacks ? kg(u.kgBacks) : '—'}</td><td className="num">{u.kgBones ? kg(u.kgBones) : '—'}</td>
                    <td className="r">{u.restoredEntryId
                      ? <span className="tag ok">przywrócony{u.restoredWorkerName ? ` → ${u.restoredWorkerName}` : ''}</span>
                      : u.restorable ? <button className="btn sm" onClick={() => setOkno({ rodzaj: 'przywroc', u })}><RotateCcw size={14} />Przywróć…</button>
                        : <span className="faint">—</span>}</td>
                  </tr>
                ))}</tbody>
              </table></div>)}
        </div>
      </div>

      {okno?.rodzaj === 'pracownik' && <ZmienPracownika w={okno.w} ludzie={ludzie} onClose={() => setOkno(null)} onDone={(z, na) => poZapisie(`Wpis przeniesiony na ${na}`, `z ${z} · wagi i stany bez zmian`)} />}
      {okno?.rodzaj === 'kg' && <PoprawKg w={okno.w} onClose={() => setOkno(null)} onDone={() => poZapisie('Kilogramy poprawione', 'stany partii i mięsa przeliczone')} />}
      {okno?.rodzaj === 'usun' && <UsunWpis w={okno.w} onClose={() => setOkno(null)} onDone={() => poZapisie('Wpis usunięty', 'ćwiartka wróciła do partii — wpis jest w „Usunięte wpisy”')} />}
      {okno?.rodzaj === 'przywroc' && <Przywroc u={okno.u} ludzie={ludzie} onClose={() => setOkno(null)} onDone={na => poZapisie(`Wpis przywrócony na ${na}`, 'pobranie, mięso, grzbiety i kości zważone ponownie (ręcznie, z powodem)')} />}
    </>
  )
}

function Partia({ b, otwarta, wpisy, onToggle, onAkcja, onPonow }: {
  b: DeboningPanelBatch; otwarta: boolean; wpisy: WpisRozbioru[] | 'blad' | 'laduje' | undefined
  onToggle: () => void; onAkcja: (o: Okno) => void; onPonow: () => void
}) {
  const span = b.firstAt ? `${czas(b.firstAt)}${b.lastAt && b.lastAt.slice(0, 10) !== b.firstAt.slice(0, 10) ? ` – ${czas(b.lastAt)}` : ''}` : '—'
  const zlyBilans = b.balancePct != null && (b.balancePct < 95 || b.balancePct > 105)
  return (
    <>
      <tr className={`row rz-partia${otwarta ? ' sel' : ''}`} onClick={onToggle} aria-expanded={otwarta}>
        <td className="c">{otwarta ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</td>
        <td className="code id-no"><button type="button" className="rz-link" onClick={e => { e.stopPropagation(); onToggle() }} aria-label={`Partia ${b.batchNo}`}>{b.batchNo}</button></td>
        <td className="ell" style={{ maxWidth: 220 }}>{b.supplierName || '—'}</td>
        <td className="tnum">{span}</td>
        <td className="num">{kg(b.kgQuarter)}</td><td className="num">{kg(b.kgMeat)}</td>
        <td className="num">{b.backsKg ? kg(b.backsKg) : '—'}</td><td className="num">{b.bonesKg ? kg(b.bonesKg) : '—'}</td>
        <td className={`num${zlyBilans ? ' crit-ink' : ''}`}>{proc(b.balancePct)}</td>
        <td className="num">{kg(b.kgAvailable)}</td>
        <td>{num(b.entriesCount)}{b.pendingCount ? <span className="tag warn" style={{ marginLeft: 6 }}>{b.pendingCount} w toku</span> : null}</td>
      </tr>
      {otwarta && <tr className="rz-sub"><td colSpan={11}>
        {wpisy === 'laduje' || wpisy === undefined ? <div className="muted rz-pad">Wczytuję wpisy…</div>
          : wpisy === 'blad' ? <div className="note crit rz-pad"><FlagIcon level="crit" size={15} /><div>Nie udało się wczytać wpisów. <button className="btn sm" onClick={onPonow}>Ponów</button></div></div>
            : !wpisy.length ? <div className="muted rz-pad">Brak wpisów.</div>
              : <table className="tbl rz-wpisy">
                <thead><tr><th>Czas</th><th>Pracownik</th><th className="num">Ćwiartka</th><th className="num">Mięso</th><th className="num">Grzbiety</th><th className="num">Kości</th><th className="num">Uzysk</th><th className="num">Bilans</th><th>Stan</th><th className="r">Korekty</th></tr></thead>
                <tbody>{wpisy.map(w => <Wpis key={w.id} w={w} onAkcja={onAkcja} />)}</tbody>
              </table>}
      </td></tr>}
    </>
  )
}

function Wpis({ w, onAkcja }: { w: WpisRozbioru; onAkcja: (o: Okno) => void }) {
  const a = akcjeWpisu(w)
  const rozliczony = w.stan === 'rozliczony'
  return (
    <tr className="row" aria-label={`Wpis ${w.workerName}`}>
      <td className="tnum">{czas(w.at)}</td>
      <td className="strong">{w.workerName || '—'}</td>
      <td className="num">{kg(w.kgQuarter)}</td>
      <td className="num">{rozliczony ? kg(w.kgMeat) : '—'}</td>
      <td className="num">{rozliczony && w.kgBacks ? kg(w.kgBacks) : '—'}</td>
      <td className="num">{rozliczony && w.kgBones ? kg(w.kgBones) : '—'}</td>
      <td className="num">{rozliczony ? proc(w.yieldPct) : '—'}</td>
      <td className="num">{proc(bilansWpisu(w))}</td>
      <td>{rozliczony ? <span className="tag ok">{ETYKIETA_STANU[w.stan]}</span> : <span className="tag warn">{ETYKIETA_STANU[w.stan]}</span>}</td>
      <td className="r rz-akcje">
        <button className="btn sm ghost" disabled={a.zmienPracownika !== true} data-tip={a.zmienPracownika === true ? undefined : a.zmienPracownika} onClick={() => onAkcja({ rodzaj: 'pracownik', w })}><UserCog size={14} />Zmień pracownika…</button>
        {!w.rozliczeniePracownika && <button className="btn sm ghost" disabled={a.poprawKg !== true} data-tip={a.poprawKg === true ? undefined : a.poprawKg} onClick={() => onAkcja({ rodzaj: 'kg', w })}><PencilLine size={14} />Popraw kg…</button>}
        <button className="btn sm ghost danger" onClick={() => onAkcja({ rodzaj: 'usun', w })}><Trash2 size={14} />Usuń…</button>
      </td>
    </tr>
  )
}

function useZapis() {
  const [busy, setBusy] = useState(false)
  const [blad, setBlad] = useState<string | null>(null)
  const zapisz = async (fn: () => Promise<void>, onKonflikt?: (msg: string) => void) => {
    if (busy) return
    setBusy(true); setBlad(null)
    try { await fn() } catch (e) {
      const msg = e instanceof Error ? e.message : 'Nie udało się zapisać'
      if (onKonflikt && errStatus(e) === 409) onKonflikt(msg); else setBlad(msg)
    } finally { setBusy(false) }
  }
  return { busy, blad, zapisz }
}

function Historia({ entryId }: { entryId: string }) {
  const res = useApi(() => deboningEntriesApi.corrections(entryId), [entryId])
  const h = (res.data ?? []) as EntryCorrection[]
  if (!h.length) return null
  return (
    <div className="rz-hist"><span className="label"><History size={13} /> Historia wpisu</span>
      {h.map(x => <div key={x.id} className="rz-hist-it"><span className="faint">{x.at ? czas(x.at) : '—'}{x.bySubject ? ` · ${x.bySubject}` : ''}</span> {opisKorekty(x.changes as Record<string, unknown>)}{x.reason ? <i> — „{x.reason}”</i> : null}</div>)}
    </div>
  )
}

const Podsumowanie = ({ w }: { w: WpisRozbioru }) => (
  <div className="rz-wpis-info"><b>{w.workerName || '—'}</b> · partia <span className="code">{w.rawBatchNo}</span> · {czas(w.at)}
    <div className="muted">ćwiartka {kg(w.kgQuarter)} · mięso {kg(w.kgMeat)}{w.kgBacks ? ` · grzbiety ${kg(w.kgBacks)}` : ''}{w.kgBones ? ` · kości ${kg(w.kgBones)}` : ''}</div></div>
)
const PolePowodu = ({ v, set, placeholder }: { v: string; set: (s: string) => void; placeholder: string }) => (
  <label className="fld"><span className="label">Powód (trafi do historii wpisu)</span>
    <input className="field" value={v} onChange={e => set(e.target.value)} placeholder={placeholder} aria-label="Powód" data-autofocus /></label>
)

function ZmienPracownika({ w, ludzie, onClose, onDone }: { w: WpisRozbioru; ludzie: Array<{ id: string; name: string; role?: string; active?: boolean }>; onClose: () => void; onDone: (z: string, na: string) => void }) {
  const lista = pracownicyRozbioru(ludzie, { id: w.workerId, name: w.workerName })
  const [kto, setKto] = useState(w.workerId)
  const [powod, setPowod] = useState('')
  const { busy, blad, zapisz } = useZapis()
  const na = lista.find(u => u.id === kto)?.name ?? ''
  const ok = kto && kto !== w.workerId && powod.trim().length >= 3
  return (
    <Dialog title="Zmień pracownika we wpisie" icon={<UserCog size={20} />} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Anuluj</button><button className="btn primary" disabled={!ok || busy} onClick={() => void zapisz(async () => { await deboningEntriesApi.correct(w.id, { workerId: kto, reason: powod.trim() }); onDone(w.workerName, na) })}>{busy ? 'Zapisuję…' : `Przenieś na ${na || '…'}`}</button></>}>
      <Podsumowanie w={w} />
      <label className="fld"><span className="label">Pracownik</span>
        <select className="field" value={kto} onChange={e => setKto(e.target.value)} aria-label="Nowy pracownik">
          {lista.map(u => <option key={u.id} value={u.id}>{u.name}{u.id === w.workerId ? ' (obecny)' : ''}</option>)}
        </select></label>
      <PolePowodu v={powod} set={setPowod} placeholder="np. pobranie zapisane na złego pracownika" />
      <div className="note"><FlagIcon level="info" size={15} /><div>Wagi, stany i czas wpisu zostają bez zmian. Zmieni się akord obu pracowników za ten dzień.</div></div>
      {blad && <div className="note crit" role="alert"><FlagIcon level="crit" size={15} /><div><b>Serwer odmówił:</b> {blad}</div></div>}
      <Historia entryId={w.id} />
    </Dialog>
  )
}

function PoprawKg({ w, onClose, onDone }: { w: WpisRozbioru; onClose: () => void; onDone: () => void }) {
  const [cw, setCw] = useState(String(w.kgQuarter).replace('.', ','))
  const [mieso, setMieso] = useState(String(w.kgMeat).replace('.', ','))
  const [powod, setPowod] = useState('')
  const [konflikt, setKonflikt] = useState<string | null>(null)
  const { busy, blad, zapisz } = useZapis()
  const q = liczba(cw), m = liczba(mieso)
  const ok = q > 0 && m > 0 && m <= q && powod.trim().length >= 3
  const wyslij = (override: boolean) => void zapisz(async () => {
    await deboningEntriesApi.correct(w.id, { kgQuarter: q, kgMeat: m, reason: powod.trim(), ...(override ? { overrideWeighings: true } : {}) })
    onDone()
  }, setKonflikt)
  return (
    <Dialog title="Popraw kilogramy wpisu" icon={<PencilLine size={20} />} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Anuluj</button><button className="btn primary" disabled={!ok || busy} onClick={() => wyslij(false)}>{busy ? 'Zapisuję…' : 'Zapisz korektę'}</button></>}>
      <Podsumowanie w={w} />
      <div className="row-wrap" style={{ gap: 12 }}>
        <label className="fld"><span className="label">Ćwiartka (kg)</span><input className="field num" inputMode="decimal" value={cw} onChange={e => setCw(e.target.value)} aria-label="Ćwiartka kg" /></label>
        <label className="fld"><span className="label">Mięso (kg)</span><input className="field num" inputMode="decimal" value={mieso} onChange={e => setMieso(e.target.value)} aria-label="Mięso kg" /></label>
        <span className="muted" style={{ alignSelf: 'flex-end', paddingBottom: 8 }}>uzysk {q > 0 && m > 0 ? proc((m / q) * 100) : '—'}</span>
      </div>
      {m > q && <div className="note warn"><FlagIcon level="warn" size={15} /><div>Mięso nie może przekraczać ćwiartki.</div></div>}
      <PolePowodu v={powod} set={setPowod} placeholder="np. pomyłka operatora przy wpisie" />
      {konflikt && <div className="note crit" role="alert"><FlagIcon level="crit" size={15} /><div><b>{konflikt}</b><br />Waga jest twardszym dowodem niż liczba z pamięci — nadpisuj tylko, gdy pomiar był błędny.
        <div style={{ marginTop: 6 }}><button className="btn sm danger" disabled={busy} onClick={() => wyslij(true)}>Nadpisz pomiar mimo to</button></div></div></div>}
      {blad && <div className="note crit" role="alert"><FlagIcon level="crit" size={15} /><div><b>Serwer odmówił:</b> {blad}</div></div>}
      <Historia entryId={w.id} />
    </Dialog>
  )
}

function UsunWpis({ w, onClose, onDone }: { w: WpisRozbioru; onClose: () => void; onDone: () => void }) {
  const [powod, setPowod] = useState('')
  const { busy, blad, zapisz } = useZapis()
  return (
    <Dialog title="Usuń wpis rozbioru" icon={<Trash2 size={20} />} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Anuluj</button><button className="btn danger" disabled={powod.trim().length < 3 || busy} onClick={() => void zapisz(async () => { await deboningEntriesApi.officeDelete(w.id, powod.trim()); onDone() })}>{busy ? 'Usuwam…' : 'Usuń wpis'}</button></>}>
      <Podsumowanie w={w} />
      <p className="muted" style={{ margin: 0 }}>Ćwiartka wróci do partii, mięso zejdzie z magazynu{w.kgBacks || w.kgBones ? ', grzbiety i kości też' : ''}. Akord pracownika przeliczy się bez tego wpisu.
        Wpis z wagami zostanie w „Usunięte wpisy” — tam można go przywrócić, także na innego pracownika.</p>
      <PolePowodu v={powod} set={setPowod} placeholder="np. wpis testowy operatora" />
      {blad && <div className="note crit" role="alert"><FlagIcon level="crit" size={15} /><div><b>Serwer odmówił:</b> {blad}</div></div>}
    </Dialog>
  )
}

function Przywroc({ u, ludzie, onClose, onDone }: { u: UsunietyWpis; ludzie: Array<{ id: string; name: string; role?: string; active?: boolean }>; onClose: () => void; onDone: (na: string) => void }) {
  const lista = pracownicyRozbioru(ludzie)
  const [kto, setKto] = useState(() => lista.find(x => x.name === u.workerName)?.id ?? '')
  const [powod, setPowod] = useState('')
  const { busy, blad, zapisz } = useZapis()
  const na = lista.find(x => x.id === kto)?.name ?? ''
  const ok = kto && powod.trim().length >= 3
  return (
    <Dialog title="Przywróć usunięty wpis" icon={<RotateCcw size={20} />} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Anuluj</button><button className="btn primary" disabled={!ok || busy} onClick={() => void zapisz(async () => { await deboningEntriesApi.restore(u.entryId, { workerId: kto, reason: powod.trim() }); onDone(na) })}>{busy ? 'Przywracam…' : `Przywróć na ${na || '…'}`}</button></>}>
      <div className="rz-wpis-info"><b>{u.workerName || '—'}</b> · partia <span className="code">{u.rawBatchNo}</span> · usunął {u.bySubject || '—'} {czas(u.deletedAt)}
        <div className="muted">ćwiartka {kg(u.kgQuarter)} · mięso {kg(u.kgMeat)}{u.kgBacks ? ` · grzbiety ${kg(u.kgBacks)}` : ''}{u.kgBones ? ` · kości ${kg(u.kgBones)}` : ''}</div></div>
      <label className="fld"><span className="label">Na pracownika</span>
        <select className="field" value={kto} onChange={e => setKto(e.target.value)} aria-label="Pracownik przywróconego wpisu">
          {!kto && <option value="">— wybierz —</option>}
          {lista.map(x => <option key={x.id} value={x.id}>{x.name}{x.name === u.workerName ? ' (jak w usuniętym)' : ''}</option>)}
        </select></label>
      <PolePowodu v={powod} set={setPowod} placeholder="np. pobranie było na złym pracowniku" />
      <div className="note"><FlagIcon level="info" size={15} /><div>Pobranie wróci do zmiany z dnia {u.workDate.split('-').reverse().join('.')} z tymi samymi wagami (zapisanymi jako ręczne, z Twoim powodem). Zmiana musi być jeszcze otwarta.</div></div>
      {blad && <div className="note crit" role="alert"><FlagIcon level="crit" size={15} /><div><b>Serwer odmówił:</b> {blad}</div></div>}
    </Dialog>
  )
}
