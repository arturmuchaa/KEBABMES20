import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FileText, Trash2, X, FileDown, RefreshCw, CheckCircle2 } from 'lucide-react'
import { useApp, CommandBar, Dialog, type Cmd } from '../../../shell/context'
import { useOrders } from '../../../data/store'
import { kg, num } from '../../../data/model'
import { FlagIcon } from '../../../ui/Glyphs'
import { clientsApi, downloadDocPdf, fxApi, wzApi, type WzDoc } from '@/lib/api'
import { STAWKI_VAT } from '@/features/wz/wzVat'
import { OTHER_CARRIER_KINDS } from '@/lib/containers'
import {
  bezCeny, cenaDlaGrupy, cenaDlaWszystkich, cudzeRezerwacje, doDto, grupyCen, ilosc, masa, sumy, vatDlaWszystkich, walidacja, wartosc,
  wspolnaCena, wspolnyVat, zPicks, klientZWyboru, nabywcaZKlienta, zMagazynu, zNabywca, zNazwami,
  type FgStock, type FormWz, type KlientWz, type WierszWz, type Wybor,
} from './model'

const dzisIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
// Spacja tysięcy także w liczbach 4-cyfrowych (pl-PL jej tam nie stawia) — „7 500,00” obok „15 000,00”.
const zl = (n: number, cur: string) => `${new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n).replace(/^(-?\d)(\d{3})(?=,)/, '$1 $2')} ${cur === 'EUR' ? '€' : 'zł'}`

/**
 * WZ — karta robocza, dwa źródła pozycji:
 *  - z zamówienia (`orderId`): `wzApi.fromOrderPicks` (wiersze magazynu wg FEFO),
 *    zapis z orderId — dokument wiąże się z zamówieniem;
 *  - z magazynu (`wybor`): zaznaczone wiersze Wyrobu gotowego, odbiorca z kartoteki,
 *    nazwy pozycji wg kartoteki odbiorcy, zapis BEZ orderId (jak stary „Wystaw WZ”).
 * Zapis: `wzApi.createManual` — rozchód i ruchy magazynowe robi serwer.
 */
export function WzZamowienia({ orderId, wybor, active, setCmds, onDone }: { orderId?: string; wybor?: Wybor[]; active: boolean; setCmds: (c: Cmd[]) => void; onDone: () => void }) {
  const app = useApp()
  const { refresh } = useOrders()
  const [f, setF] = useState<FormWz | null>(null)
  const [meta, setMeta] = useState<{ orderNo: string; brakuje: number } | null>(null)
  const [nextNo, setNextNo] = useState('')
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [blad, setBlad] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [pytanie, setPytanie] = useState<ReturnType<typeof cudzeRezerwacje> | null>(null)
  const [saved, setSaved] = useState<WzDoc | null>(null)
  const lock = useRef(false)
  const cenaRef = useRef<HTMLInputElement>(null)
  const zMag = !orderId
  const [klienci, setKlienci] = useState<KlientWz[]>([])
  const [klientId, setKlientId] = useState('')
  const wyborKey = (wybor ?? []).map(w => `${w.id}:${w.qty}`).join(',')

  // Nazwy pozycji zależą od kartoteki odbiorcy — po jego wyborze magazyn czytamy na nowo.
  const nazwyDla = useCallback((id: string) => {
    wzApi.stockFg(id).then(fg => setF(x => (x ? zNazwami(x, fg as FgStock[]) : x))).catch(() => undefined)
  }, [])
  const wczytaj = useCallback(() => {
    setLoadErr(null)
    if (orderId) {
      wzApi.fromOrderPicks(orderId).then(d => { const z = zPicks(d, dzisIso()); setF(z.form); setMeta({ orderNo: z.orderNo, brakuje: z.brakuje }) })
        .catch(e => setLoadErr(e instanceof Error ? e.message : 'Nie udało się wczytać pozycji zamówienia'))
    } else {
      Promise.all([clientsApi.list(), wzApi.stockFg()]).then(([cl, fg]) => {
        const kl = (cl as Array<KlientWz & { active?: boolean }>).filter(c => c.active !== false)
          .sort((a, b) => (a.displayName || a.name).localeCompare(b.displayName || b.name, 'pl'))
        setKlienci(kl)
        const w = wybor ?? []
        let form = zMagazynu(fg as FgStock[], w, dzisIso())
        const k = klientZWyboru(fg as FgStock[], w, kl)
        if (k) { form = zNabywca(form, nabywcaZKlienta(k)); setKlientId(k.id); nazwyDla(k.id) }
        setF(form)
      }).catch(e => setLoadErr(e instanceof Error ? e.message : 'Nie udało się wczytać magazynu'))
    }
    wzApi.nextNumber().then(n => setNextNo(n.number)).catch(() => undefined)
  }, [orderId, wyborKey, nazwyDla]) // eslint-disable-line react-hooks/exhaustive-deps
  const wybierzKlienta = (id: string) => {
    setKlientId(id)
    const c = klienci.find(x => x.id === id)
    if (!c) return
    setF(x => (x ? zNabywca(x, nabywcaZKlienta(c)) : x))
    nazwyDla(id)
  }
  useEffect(() => { wczytaj() }, [wczytaj])

  const upd = (p: Partial<FormWz>) => setF(x => x ? { ...x, ...p } : x)
  const setRow = (i: number, p: Partial<WierszWz>) => setF(x => x ? { ...x, rows: x.rows.map((r, j) => j === i ? { ...r, ...p } : r) } : x)
  const wartosciowy = (on: boolean) => {
    upd({ valued: on })
    if (on) requestAnimationFrame(() => cenaRef.current?.focus())
  }

  const zapisz = useCallback(async (potwierdzone = false) => {
    if (!f || lock.current) return
    const v = walidacja(f)
    if (v) { setBlad(v); return }
    const kl = klienci.find(c => c.id === klientId)
    const cudze = cudzeRezerwacje(f, kl ? [kl.name, kl.displayName ?? ''] : [])
    if (cudze.length && !potwierdzone) { setPytanie(cudze); return }
    lock.current = true; setSaving(true); setBlad(null); setPytanie(null)
    try {
      const doc = await wzApi.createManual(doDto(f, orderId || undefined))
      setSaved(doc)
      await refresh().catch(() => undefined)
      app.toast({ kind: 'ok', title: `Wystawiono ${doc.number}`, detail: `${f.rows.length} poz. · ${kg(sumy(f).kg)} — towar zdjęty ze stanu.` })
    } catch (e) {
      setBlad(e instanceof Error ? e.message : 'Błąd wystawiania WZ')
    } finally { lock.current = false; setSaving(false) }
  }, [f, orderId, refresh, app, klienci, klientId])

  const pdf = async () => {
    if (!saved) return
    try { await downloadDocPdf(wzApi.pdfUrl(saved.id), `${saved.number.replace(/\//g, '-')}.pdf`) }
    catch (e) { app.toast({ kind: 'warn', title: 'Nie udało się pobrać PDF', detail: e instanceof Error ? e.message : '' }) }
  }
  const kurs = async () => {
    try { const r = await fxApi.eurRate(f?.issuedDate); if (r.rate) upd({ eurRateStr: String(r.rate).replace('.', ',') }) ; app.toast({ kind: 'info', title: `Kurs NBP ${r.rate ?? '—'}`, detail: r.date ? `tabela ${r.table ?? ''} z ${r.date}` : undefined }) }
    catch (e) { app.toast({ kind: 'warn', title: 'Nie udało się pobrać kursu NBP', detail: e instanceof Error ? e.message : '' }) }
  }

  const zapiszRef = useRef(zapisz); zapiszRef.current = zapisz
  const cmds = useMemo<Cmd[]>(() => saved ? [
    { id: 'pdf', group: 1, label: 'Otwórz PDF', icon: <FileDown size={17} />, primary: true, run: () => void pdf() },
    { id: 'close', group: 2, label: 'Zamknij', icon: <X size={17} />, run: onDone },
  ] : [
    { id: 'issue', group: 1, label: 'Wystaw WZ', icon: <FileText size={17} />, primary: true, kbd: 'Ctrl+Enter', disabled: !f || saving || !f.rows.length, run: () => void zapiszRef.current() },
    { id: 'reload', group: 2, label: 'Wczytaj ponownie', icon: <RefreshCw size={17} />, opt: true, disabled: saving, run: wczytaj },
    { id: 'close', group: 3, label: 'Zamknij bez wystawienia', icon: <X size={17} />, run: onDone },
  ], [saved, f, saving, wczytaj, onDone]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setCmds(cmds) }, [cmds, setCmds])
  useEffect(() => {
    if (!active || saved) return
    const key = (e: KeyboardEvent) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void zapiszRef.current() } }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [active, saved])

  const title = zMag ? 'WZ z magazynu' : `WZ — ${meta?.orderNo ?? 'zamówienie'}`
  if (saved) return (
    <>
      <CommandBar title={title} count="wystawiony" cmds={cmds} />
      <div className="placeholder"><div className="ph-card">
        <CheckCircle2 size={34} color="var(--ok)" />
        <h2>Wystawiono {saved.number}</h2>
        <p className="muted">{saved.buyer_name} · {f?.rows.length ?? 0} poz. · {f ? kg(sumy(f).kg) : ''}{saved.valued ? ` · ${zl(saved.total_value ?? 0, saved.currency ?? 'PLN')}` : ' · bez cen'}</p>
        <div className="note info"><FlagIcon level="info" size={15} /><div>Dokument jest na KOPII bazy — nie używaj go w obrocie. Towar zszedł ze stanu kopii.</div></div>
        <div className="row-wrap"><button className="btn primary" onClick={() => void pdf()}><FileDown size={15} />Otwórz PDF</button><button className="btn" onClick={onDone}>Zamknij</button></div>
      </div></div>
    </>
  )

  const s = f ? sumy(f) : null
  const cur = f?.currency ?? 'PLN'
  return (
    <>
      <CommandBar title={title} count={nextNo ? `numer nada serwer (następny: ${nextNo})` : 'numer nada serwer'} cmds={cmds} />
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <div className="dock-pad" style={{ maxWidth: 1320 }}>
          {loadErr && <div className="note crit" role="alert"><FlagIcon level="crit" size={15} /><div>{loadErr} <button className="btn sm" onClick={wczytaj}>Ponów</button></div></div>}
          {!f && !loadErr && <div className="note">Wczytywanie pozycji z magazynu…</div>}
          {blad && <div className="note crit" role="alert"><FlagIcon level="crit" size={15} /><div><b>Nie wystawiono:</b> {blad}</div></div>}
          {f && <>
            {meta && meta.brakuje > 0 && <div className="note warn"><FlagIcon level="warn" size={15} /><div>Na magazynie brakuje <b>{num(meta.brakuje)} szt.</b> do pełnego zamówienia — WZ będzie częściowy (na stan faktyczny).</div></div>}
            <div className="ov-grid" style={{ gridTemplateColumns: 'minmax(0, 1.2fr) minmax(0, 1fr)' }}>
              <div className="box ov-card"><h4>Odbiorca</h4>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 180px', gap: '8px 12px' }}>
                  {zMag && <label className="fld" style={{ gridColumn: '1 / -1' }}><span className="label">Z kartoteki odbiorców</span>
                    <select className={`field${!f.buyer.name.trim() ? ' invalid' : ''}`} value={klientId} onChange={e => wybierzKlienta(e.target.value)} aria-label="Odbiorca z kartoteki" autoFocus={!klientId}>
                      <option value="">Wybierz odbiorcę…</option>
                      {klienci.map(c => <option key={c.id} value={c.id}>{c.displayName || c.name}{c.city ? ` — ${c.city}` : ''}</option>)}
                    </select></label>}
                  <label className="fld" style={{ gridColumn: '1 / -1' }}><span className="label">Nazwa</span><input className="field" value={f.buyer.name} onChange={e => upd({ buyer: { ...f.buyer, name: e.target.value } })} aria-label="Nazwa odbiorcy" /></label>
                  <label className="fld"><span className="label">Adres</span><input className="field" value={f.buyer.address} onChange={e => upd({ buyer: { ...f.buyer, address: e.target.value } })} /></label>
                  <label className="fld"><span className="label">NIP / VAT</span><input className="field" value={f.buyer.nip} onChange={e => upd({ buyer: { ...f.buyer, nip: e.target.value } })} /></label>
                </div>
              </div>
              <div className="box ov-card"><h4>Dokument</h4>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 12px' }}>
                  <label className="fld"><span className="label">Data wystawienia</span><input type="date" className="field" value={f.issuedDate} onChange={e => upd({ issuedDate: e.target.value })} /></label>
                  <label className="fld"><span className="label">Data wydania</span><input type="date" className="field" value={f.releaseDate} onChange={e => upd({ releaseDate: e.target.value })} /></label>
                  <label className="fld"><span className="label">Miejsce wystawienia</span><input className="field" value={f.place} onChange={e => upd({ place: e.target.value })} placeholder="z ustawień firmy" /></label>
                  <label className="fld"><span className="label">Uwagi</span><input className="field" value={f.notes} onChange={e => upd({ notes: e.target.value })} /></label>
                </div>
              </div>
            </div>

            <div className="sect-h"><h3>Pozycje z magazynu</h3><span className="sub">{zMag ? 'zaznaczone w Wyrobie gotowym' : 'wiersze magazynu wg FEFO dobrane przez serwer'} · {num(s!.szt)} szt. · {kg(s!.kg)}</span>
              <div className="tools">
                <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><input type="checkbox" className="cbx" checked={f.valued} onChange={e => wartosciowy(e.target.checked)} />Dokument wartościowy</label>
              </div>
            </div>
            {f.valued && <KartaCen f={f} setF={setF} cenaRef={cenaRef} onKurs={() => void kurs()} />}
            <div className="box"><table className="tbl">
              <thead><tr><th>Pozycja</th><th>Partia</th><th className="num">Na stanie</th><th className="num">Wydać</th><th className="num">Masa</th>
                {f.valued && <><th className="num">Cena / kg</th><th className="num">VAT</th><th className="num">Wartość</th></>}<th style={{ width: 40 }} /></tr></thead>
              <tbody>
                {f.rows.length === 0 && <tr><td colSpan={9}><div className="empty">{zMag ? 'Zaznaczonych wierszy nie ma już na magazynie.' : 'Na magazynie nie ma wyrobu dla tego zamówienia.'}</div></td></tr>}
                {f.rows.map((r, i) => {
                  const za = ilosc(r) > r.available
                  return (
                    <tr key={r.stockId} className="row editing">
                      <td className="strong">{r.name}</td>
                      <td className="code">{r.batchNo ?? '—'}</td>
                      <td className="num">{num(r.available)} szt.</td>
                      <td className="num"><input className={`field num w-num${za ? ' invalid' : ''}`} inputMode="numeric" value={r.qtyStr} onChange={e => setRow(i, { qtyStr: e.target.value })} aria-label={`Ilość do wydania, ${r.name}, partia ${r.batchNo ?? ''}`} /> <span className="sub">szt.</span></td>
                      <td className="num">{kg(masa(r))}</td>
                      {f.valued && <>
                        <td className="num"><input className="field num w-num" inputMode="decimal" value={r.priceStr} onChange={e => setRow(i, { priceStr: e.target.value })} aria-label={`Cena za kg, ${r.name}`} /></td>
                        <td className="num"><select className="field" style={{ width: 'auto', height: 28 }} value={r.vatRate} onChange={e => setRow(i, { vatRate: Number(e.target.value) })} aria-label={`VAT, ${r.name}`}>{STAWKI_VAT.map(v => <option key={v} value={v}>{v}%</option>)}</select></td>
                        <td className="num">{zl(wartosc(r), cur)}</td>
                      </>}
                      <td><button className="btn ghost icon sm" style={{ width: 28 }} onClick={() => upd({ rows: f.rows.filter((_, j) => j !== i) })} aria-label={`Usuń z dokumentu: ${r.name}`}><Trash2 size={15} /></button></td>
                    </tr>
                  )
                })}
              </tbody>
              {f.rows.length > 0 && <tfoot><tr><td colSpan={3}>Razem</td><td className="num">{num(s!.szt)} szt.</td><td className="num">{kg(s!.kg)}</td>
                {f.valued && <><td /><td /><td className="num">{s!.vat ? zl(s!.vat.netto, cur) : ''}</td></>}<td /></tr></tfoot>}
            </table></div>

            <div className="sect-h"><h3>Transport</h3><span className="sub">palety na całym dokumencie; pojemniki puste = suma z pozycji</span></div>
            <div className="box" style={{ padding: 12, display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'end' }}>
              <label className="fld"><span className="label">Palety H1</span><input className="field num w-num" inputMode="numeric" value={f.palletsH1Str} onChange={e => upd({ palletsH1Str: e.target.value })} /></label>
              <label className="fld"><span className="label">Inne nośniki</span><input className="field num w-num" inputMode="numeric" value={f.palletsOtherStr} onChange={e => upd({ palletsOtherStr: e.target.value })} /></label>
              <label className="fld"><span className="label">Rodzaj</span><select className="field" style={{ width: 'auto' }} value={f.palletsOtherKind} onChange={e => upd({ palletsOtherKind: e.target.value })}>{OTHER_CARRIER_KINDS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}</select></label>
              <label className="fld"><span className="label">Pojemniki (razem)</span><input className="field num w-num" inputMode="numeric" value={f.containersStr} onChange={e => upd({ containersStr: e.target.value })} placeholder="auto" /></label>
            </div>
            <div className="note info"><FlagIcon level="info" size={15} /><div>Wystawienie WZ <b>zdejmuje towar ze stanu</b> (ruchy magazynowe robi serwer). W wersji próbnej — ze stanu KOPII bazy.</div></div>
          </>}
        </div>
      </div>
      {pytanie && <Dialog title="Wydajesz towar zarezerwowany pod inne zamówienia" icon={<FlagIcon level="warn" size={20} />} onClose={() => setPytanie(null)}
        footer={<><button className="btn" onClick={() => setPytanie(null)} data-autofocus>Wróć</button><button className="btn primary" disabled={saving} onClick={() => void zapisz(true)}>Wystaw mimo to</button></>}>
        <ul style={{ margin: 0, paddingLeft: 18 }}>{pytanie.map(r => <li key={r.orderNo}>{r.qty} szt. pod <b>{r.orderNo}</b>{r.clientName ? ` (${r.clientName})` : ''}</li>)}</ul>
        <div className="note warn"><FlagIcon level="warn" size={15} /><div>Te sztuki zostaną zdjęte z pokrycia tamtych zamówień — pokażą brak i trzeba będzie dorobić.</div></div>
      </Dialog>}
    </>
  )
}

/**
 * Karta „Ceny” nad pozycjami dokumentu wartościowego: jedna cena za kg dla
 * wszystkich pozycji, ceny według wyrobu (rodzaj + receptura, bez gramatury),
 * waluta z kursem NBP, wspólna stawka VAT i podsumowanie. Pola są POCHODNĄ
 * cen w wierszach — wpisanie od razu ustawia wiersze, a pojedynczą cenę
 * poprawia się w tabeli (wtedy pole „wszystkie” pokazuje „różne ceny”).
 */
function KartaCen({ f, setF, cenaRef, onKurs }: {
  f: FormWz; setF: React.Dispatch<React.SetStateAction<FormWz | null>>; cenaRef: React.RefObject<HTMLInputElement>; onKurs: () => void
}) {
  const grupy = grupyCen(f)
  const s = sumy(f)
  const brak = bezCeny(f)
  const vat = wspolnyVat(f)
  const cur = f.currency
  const jedn = cur === 'EUR' ? '€/kg' : 'zł/kg'
  const ustaw = (fn: (x: FormWz) => FormWz) => setF(x => (x ? fn(x) : x))
  return (
    <div className="box wz-prices" aria-label="Ceny dokumentu">
      <div className="wz-p-main">
        <label className="fld"><span className="label">Cena za kg — wszystkie pozycje</span>
          <span className="wz-p-in big"><input ref={cenaRef} className="field num" inputMode="decimal" placeholder={f.rows.some(r => r.priceStr.trim()) ? 'różne ceny' : '0,00'}
            value={wspolnaCena(f)} onChange={e => ustaw(x => cenaDlaWszystkich(x, e.target.value))} aria-label="Cena za kg dla wszystkich pozycji" /><span>{jedn}</span></span></label>
        <span className="sub">Wpisz raz — trafi do każdej pozycji. Pojedynczą cenę zmienisz w tabeli niżej.</span>
      </div>
      {grupy.length > 1 && <div className="wz-p-groups">
        <span className="label">Według wyrobu</span>
        {grupy.map(g => (
          <label key={g.key} className="wz-p-row">
            <span className="nm"><b>{g.key}</b><span className="sub">{g.pozycji} poz. · {num(g.szt)} szt. · {kg(g.kg)}</span></span>
            <span className="wz-p-in"><input className="field num" inputMode="decimal" placeholder="—" value={g.priceStr}
              onChange={e => ustaw(x => cenaDlaGrupy(x, g.key, e.target.value))} aria-label={`Cena za kg, ${g.key}`} /><span>{jedn}</span></span>
          </label>
        ))}
      </div>}
      <div className="wz-p-side">
        <div className="fld"><span className="label">Waluta</span>
          <div className="seg" role="group" aria-label="Waluta">
            {(['PLN', 'EUR'] as const).map(c => <button key={c} type="button" aria-pressed={cur === c} onClick={() => ustaw(x => ({ ...x, currency: c }))}>{c}</button>)}
          </div></div>
        {cur === 'EUR' && <div className="fld"><span className="label">Kurs EUR</span>
          <span style={{ display: 'flex', gap: 6 }}><input className="field num w-num" placeholder="4,25" value={f.eurRateStr} onChange={e => ustaw(x => ({ ...x, eurRateStr: e.target.value }))} aria-label="Kurs EUR" />
            <button className="btn sm" type="button" onClick={onKurs}>Kurs NBP</button></span></div>}
        <label className="fld"><span className="label">VAT — wszystkie pozycje</span>
          <select className="field" value={vat ?? ''} onChange={e => ustaw(x => vatDlaWszystkich(x, Number(e.target.value)))} aria-label="Stawka VAT dla wszystkich pozycji">
            {vat === null && <option value="">różne</option>}
            {STAWKI_VAT.map(v => <option key={v} value={v}>{v}%</option>)}
          </select></label>
      </div>
      <div className="wz-p-sum">
        <div className="f"><span className="k">Netto</span><span className="v">{zl(s.vat?.netto ?? 0, cur)}</span></div>
        <div className="f"><span className="k">VAT</span><span className="v">{zl(s.vat ? s.vat.brutto - s.vat.netto : 0, cur)}</span></div>
        <div className="f big"><span className="k">Brutto</span><span className="v">{zl(s.vat?.brutto ?? 0, cur)}</span></div>
        {s.vat && s.vat.wiersze.length > 1 && <span className="sub">{s.vat.wiersze.map(w => `${w.stawka}%: ${zl(w.netto, cur)}`).join(' · ')}</span>}
        {brak > 0 ? <span className="warn-ink strong">{brak} {brak === 1 ? 'pozycja' : brak < 5 ? 'pozycje' : 'pozycji'} bez ceny</span> : <span className="ok-ink">wszystkie pozycje mają cenę</span>}
      </div>
    </div>
  )
}
