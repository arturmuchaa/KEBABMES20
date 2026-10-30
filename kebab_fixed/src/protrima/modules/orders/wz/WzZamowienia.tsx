import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FileText, Trash2, X, FileDown, RefreshCw, CheckCircle2 } from 'lucide-react'
import { useApp, CommandBar, Dialog, type Cmd } from '../../../shell/context'
import { useOrders } from '../../../data/store'
import { kg, num } from '../../../data/model'
import { FlagIcon } from '../../../ui/Glyphs'
import { downloadDocPdf, fxApi, wzApi, type WzDoc } from '@/lib/api'
import { STAWKI_VAT } from '@/features/wz/wzVat'
import { OTHER_CARRIER_KINDS } from '@/lib/containers'
import { cenaDlaWszystkich, cudzeRezerwacje, doDto, ilosc, masa, sumy, walidacja, wartosc, wspolnaCena, zPicks, type FormWz, type WierszWz } from './model'

const dzisIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const zl = (n: number, cur: string) => `${new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)} ${cur === 'EUR' ? '€' : 'zł'}`

/**
 * WZ z zamówienia — karta robocza. Pozycje: `wzApi.fromOrderPicks` (wiersze
 * magazynu wg FEFO), zapis: `wzApi.createManual` z orderId — tak jak stary MES.
 * Dokument zdejmuje towar ze stanu (rozchód i ruchy robi serwer).
 */
export function WzZamowienia({ orderId, active, setCmds, onDone }: { orderId: string; active: boolean; setCmds: (c: Cmd[]) => void; onDone: () => void }) {
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
  const [cenaWsz, setCenaWsz] = useState('')
  const cenaRef = useRef<HTMLInputElement>(null)

  const wczytaj = useCallback(() => {
    setLoadErr(null)
    wzApi.fromOrderPicks(orderId).then(d => { const z = zPicks(d, dzisIso()); setF(z.form); setMeta({ orderNo: z.orderNo, brakuje: z.brakuje }) })
      .catch(e => setLoadErr(e instanceof Error ? e.message : 'Nie udało się wczytać pozycji zamówienia'))
    wzApi.nextNumber().then(n => setNextNo(n.number)).catch(() => undefined)
  }, [orderId])
  useEffect(() => { wczytaj() }, [wczytaj])

  const upd = (p: Partial<FormWz>) => setF(x => x ? { ...x, ...p } : x)
  const setRow = (i: number, p: Partial<WierszWz>) => setF(x => x ? { ...x, rows: x.rows.map((r, j) => j === i ? { ...r, ...p } : r) } : x)
  // Jedna cena za kg na wszystkie pozycje — wpisana raz, a nie w każdym wierszu.
  const ustawWszystkim = (v = cenaWsz) => { if (v.trim()) setF(x => x ? cenaDlaWszystkich(x, v.trim()) : x) }
  const wartosciowy = (on: boolean) => {
    upd({ valued: on })
    if (on) { setCenaWsz(f ? wspolnaCena(f) : ''); requestAnimationFrame(() => cenaRef.current?.focus()) }
  }

  const zapisz = useCallback(async (potwierdzone = false) => {
    if (!f || lock.current) return
    const v = walidacja(f)
    if (v) { setBlad(v); return }
    const cudze = cudzeRezerwacje(f)
    if (cudze.length && !potwierdzone) { setPytanie(cudze); return }
    lock.current = true; setSaving(true); setBlad(null); setPytanie(null)
    try {
      const doc = await wzApi.createManual(doDto(f, orderId))
      setSaved(doc)
      await refresh().catch(() => undefined)
      app.toast({ kind: 'ok', title: `Wystawiono ${doc.number}`, detail: `${f.rows.length} poz. · ${kg(sumy(f).kg)} — towar zdjęty ze stanu.` })
    } catch (e) {
      setBlad(e instanceof Error ? e.message : 'Błąd wystawiania WZ')
    } finally { lock.current = false; setSaving(false) }
  }, [f, orderId, refresh, app])

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

  const title = `WZ — ${meta?.orderNo ?? 'zamówienie'}`
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

            <div className="sect-h"><h3>Pozycje z magazynu</h3><span className="sub">wiersze magazynu wg FEFO dobrane przez serwer · {num(s!.szt)} szt. · {kg(s!.kg)}</span>
              <div className="tools">
                <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><input type="checkbox" className="cbx" checked={f.valued} onChange={e => wartosciowy(e.target.checked)} />Dokument wartościowy</label>
                {f.valued && <>
                  <span className="wz-bulk">
                    <input ref={cenaRef} className="field num w-num" inputMode="decimal" placeholder="cena / kg" value={cenaWsz} aria-label="Cena za kg dla wszystkich pozycji"
                      onChange={e => setCenaWsz(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.ctrlKey) { e.preventDefault(); ustawWszystkim() } }} />
                    <button className="btn sm primary" disabled={!cenaWsz.trim()} onClick={() => ustawWszystkim()} data-tip="Ta sama cena za kg w każdej pozycji (Enter). Pojedyncze wiersze możesz potem zmienić.">Ustaw wszystkim</button>
                  </span>
                  <select className="field" style={{ width: 'auto', height: 28 }} value={f.currency} onChange={e => upd({ currency: e.target.value as 'PLN' | 'EUR' })} aria-label="Waluta"><option>PLN</option><option>EUR</option></select>
                  {f.currency === 'EUR' && <><input className="field num w-num" placeholder="kurs" value={f.eurRateStr} onChange={e => upd({ eurRateStr: e.target.value })} aria-label="Kurs EUR" /><button className="btn sm" onClick={() => void kurs()}>Kurs NBP</button></>}
                </>}
              </div>
            </div>
            <div className="box"><table className="tbl">
              <thead><tr><th>Pozycja</th><th>Partia</th><th className="num">Na stanie</th><th className="num">Wydać</th><th className="num">Masa</th>
                {f.valued && <><th className="num">Cena / kg</th><th className="num">VAT</th><th className="num">Wartość</th></>}<th style={{ width: 40 }} /></tr></thead>
              <tbody>
                {f.rows.length === 0 && <tr><td colSpan={9}><div className="empty">Na magazynie nie ma wyrobu dla tego zamówienia.</div></td></tr>}
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
            {f.valued && s!.vat && <div className="box" style={{ padding: '8px 14px', alignSelf: 'flex-end', minWidth: 300 }}><dl className="kv">
              {s!.vat.wiersze.map(w => <React.Fragment key={w.stawka}><dt>VAT {w.stawka}%</dt><dd className="num">{zl(w.netto, cur)} + {zl(w.vat, cur)}</dd></React.Fragment>)}
              <dt className="strong">Brutto</dt><dd className="num strong">{zl(s!.vat.brutto, cur)}</dd>
            </dl></div>}

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
