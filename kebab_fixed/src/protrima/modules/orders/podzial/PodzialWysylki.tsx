import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Split, Save, FileText, X, Ban, FileDown } from 'lucide-react'
import { useApp, CommandBar, Dialog, type Cmd } from '../../../shell/context'
import { useOrders } from '../../../data/store'
import { FlagIcon } from '../../../ui/Glyphs'
import { cmrApi, downloadDocPdf, errStatus, hdiApi, orderSplitApi, palletScanApi, wzApi, carriersApi,
  type Carrier, type SplitDocuments, type SplitPreview, type SplitSaved } from '@/lib/api'
import { DOMYSLNE_DANE_TRANSPORTU, brakujeDanychPrzewoznika, type DaneTransportu } from '@/components/cmr/CmrDaneTransportu'

/**
 * Podział wysyłki na fakturę i WZ — port zasad starego SplitDialog
 * (features/orders/split/SplitDialog.tsx) na kartę roboczą PROTRIMA:
 *  - całą matematykę liczy backend (preview/save), okno niczego nie przelicza;
 *  - „Wystaw komplet” tylko gdy ekran = podział zapisany w bazie (matchesSaved),
 *    a tuż przed wystawieniem jeszcze raz czytamy bazę (ktoś mógł zmienić);
 *  - przy nieudanym odczycie zapisanego podziału nie wolno ani zapisać, ani wystawić;
 *  - spóźnione odpowiedzi podglądu są pomijane (licznik);
 *  - odmowa „najpierw anuluj dokumenty podziału” od razu proponuje anulowanie
 *    (WM + WZ wracają na stan, HDI i CMR zostają z numerami).
 */
const WYMAGA_ANULOWANIA = /anuluj dokument(y|ów) podzia/i
const kgT = (n: number) => new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 3 }).format(n)
const odchylkaTekst = (o: number | null | undefined) => o == null ? '—' : `${o > 0 ? '+' : ''}${kgT(o)} kg`

type Korekta = number | 'brak' | 'blad'
export function parseOverride(raw: string | undefined): Korekta {
  if (raw === undefined) return 'brak'
  if (raw.trim() === '') return 0
  const n = Number(raw)
  return Number.isInteger(n) ? n : 'blad'
}
export function perLineEqual(a: Record<string, number>, b: Record<string, number>): boolean {
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if ((a[k] ?? 0) !== (b[k] ?? 0)) return false
  return true
}
interface SavedSplit { celKg: number; perLine: Record<string, number> }
export function naEkranie(p: SplitPreview, o: Record<string, string>): Record<string, number> | null {
  const out: Record<string, number> = {}
  for (const l of p.lines) {
    const k = parseOverride(o[l.id])
    if (k === 'blad') return null
    const v = k === 'brak' ? l.qty_invoice : k
    if (v === null) return null
    out[l.id] = v
  }
  return out
}
export function savedZ(z: SplitSaved): SavedSplit | null {
  if (!z.istnieje || !z.kompletny || z.cel_kg == null) return null
  return { celKg: z.cel_kg, perLine: Object.fromEntries(z.lines.map(l => [l.id, l.qty_invoice ?? 0])) }
}

export function PodzialWysylki({ orderId, orderNo, clientName, kgCalosc, active, setCmds, onDone }: {
  orderId: string; orderNo: string; clientName: string; kgCalosc: number; active: boolean; setCmds: (c: Cmd[]) => void; onDone: () => void
}) {
  const app = useApp()
  const { refresh } = useOrders()
  const [celKgInput, setCelKgInput] = useState('')
  const [tabela, setTabela] = useState<{ dane: SplitPreview; zrodlo: 'podglad' | 'zapisany' } | null>(null)
  const [zaladowane, setZaladowane] = useState<{ loaded: number; total: number } | null>(null)
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [overrides, setOverrides] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [issuing, setIssuing] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [hdiFv, setHdiFv] = useState(false)
  const [transport, setTransport] = useState<DaneTransportu>(DOMYSLNE_DANE_TRANSPORTU)
  const [carriers, setCarriers] = useState<Carrier[]>([])
  const [err, setErr] = useState('')
  const [needsCancel, setNeedsCancel] = useState(false)
  const [info, setInfo] = useState('')
  const [documents, setDocuments] = useState<SplitDocuments | null>(null)
  const [bladOdczytu, setBladOdczytu] = useState('')
  const [savedSplit, setSavedSplit] = useState<SavedSplit | null>(null)
  const [pytanie, setPytanie] = useState<null | 'issue' | 'cancel'>(null)
  const previewSeq = useRef(0)
  const zywe = useRef(true)

  const preview = tabela?.dane ?? null
  const zZapisu = tabela?.zrodlo === 'zapisany'
  const hasPendingOverrides = Object.keys(overrides).length > 0
  const celKgTeraz = parseFloat(celKgInput.replace(',', '.'))
  const ekran = preview === null ? null : naEkranie(preview, overrides)
  const matchesSaved = ekran !== null && savedSplit !== null && !Number.isNaN(celKgTeraz) && celKgTeraz === savedSplit.celKg && perLineEqual(ekran, savedSplit.perLine)
  const niepelnyZapis = preview !== null && preview.lines.some(l => l.qty_invoice === null)
  const busy = saving || issuing || cancelling

  useEffect(() => { carriersApi.list().then(setCarriers).catch(() => undefined) }, [])
  useEffect(() => {
    let off = false
    palletScanApi.loadingStatus(orderId)
      .then(st => { if (!off) setZaladowane({ loaded: Number(st?.totals?.loadedPallets ?? 0), total: Number(st?.totals?.totalPallets ?? 0) }) })
      .catch(() => { if (!off) setZaladowane(null) })
    return () => { off = true }
  }, [orderId])

  const wczytajZapisany = useCallback(async () => {
    const seq = previewSeq.current
    setBladOdczytu('')
    try {
      const z = await orderSplitApi.saved(orderId)
      if (!zywe.current) return
      setSavedSplit(prev => prev ?? savedZ(z))
      if (seq !== previewSeq.current || !z.istnieje) return
      if (z.cel_kg != null) setCelKgInput(String(z.cel_kg))
      setTabela({ dane: z, zrodlo: 'zapisany' })
    } catch (e) {
      if (!zywe.current) return
      if (errStatus(e) === 404) return
      setBladOdczytu(e instanceof Error ? e.message : 'błąd połączenia')
    }
  }, [orderId])
  useEffect(() => { zywe.current = true; void wczytajZapisany(); return () => { zywe.current = false } }, [wczytajZapisany])

  const runPreview = async (celKg: number) => {
    const seq = ++previewSeq.current
    setLoadingPreview(true); setDocuments(null); setInfo('')
    try {
      const r = await orderSplitApi.preview(orderId, celKg)
      if (seq !== previewSeq.current) return
      setTabela({ dane: r, zrodlo: 'podglad' }); setOverrides({})
    } catch (e) {
      if (seq !== previewSeq.current) return
      setErr(e instanceof Error ? e.message : 'Nie udało się policzyć podziału'); setTabela(null)
    } finally { if (seq === previewSeq.current) setLoadingPreview(false) }
  }
  const onCel = (raw: string) => {
    setCelKgInput(raw); setErr(''); setNeedsCancel(false)
    const n = parseFloat(raw.replace(',', '.'))
    if (raw.trim() === '' || Number.isNaN(n) || n < 0) { previewSeq.current++; setTabela(null); setLoadingPreview(false); return }
    void runPreview(n)
  }
  const pol = () => { const p = kgCalosc / 2; setCelKgInput(String(p)); setErr(''); setNeedsCancel(false); void runPreview(p) }

  const zapisz = async () => {
    if (!preview || bladOdczytu) return
    const celKg = parseFloat(celKgInput.replace(',', '.'))
    if (Number.isNaN(celKg)) return
    const perLine: Record<string, number> = {}
    for (const line of preview.lines) {
      const k = parseOverride(overrides[line.id])
      if (k === 'blad') { setErr(`Pozycja ${line.recipe_name}: sztuki na fakturę muszą być liczbą całkowitą.`); return }
      const n = k === 'brak' ? line.qty_invoice : k
      if (n !== null) perLine[line.id] = n
    }
    setSaving(true); setErr(''); setNeedsCancel(false); setInfo('')
    try {
      const r = await orderSplitApi.save(orderId, celKg, Object.keys(perLine).length ? perLine : undefined)
      setTabela({ dane: r, zrodlo: 'zapisany' }); setOverrides({})
      setSavedSplit({ celKg: r.cel_kg ?? celKg, perLine: Object.fromEntries(r.lines.map(l => [l.id, l.qty_invoice ?? 0])) })
      setInfo('Podział zapisany.')
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Nie udało się zapisać podziału'
      setErr(msg); setNeedsCancel(WYMAGA_ANULOWANIA.test(msg))
    } finally { setSaving(false) }
  }

  const wystaw = async () => {
    const zapisane = savedSplit
    setPytanie(null)
    if (issuing || !matchesSaved || zapisane === null) return
    setIssuing(true); setErr(''); setNeedsCancel(false); setInfo('')
    try {
      let wBazie: SplitSaved
      try { wBazie = await orderSplitApi.saved(orderId) }
      catch { setErr('Nie udało się potwierdzić, że podział w bazie nadal zgadza się z ekranem — dokumentów NIE wystawiono. Spróbuj jeszcze raz.'); return }
      const teraz = savedZ(wBazie)
      if (teraz === null || teraz.celKg !== zapisane.celKg || !perLineEqual(teraz.perLine, zapisane.perLine)) {
        setOverrides({}); setSavedSplit(teraz)
        setCelKgInput(wBazie.cel_kg != null ? String(wBazie.cel_kg) : '')
        setTabela(wBazie.istnieje ? { dane: wBazie, zrodlo: 'zapisany' } : null)
        setErr('Ktoś zmienił podział tego zamówienia, odkąd otwarto to okno. Na ekranie jest teraz to, co naprawdę leży w bazie — sprawdź go i wystaw jeszcze raz.')
        return
      }
      const r = await orderSplitApi.documents(orderId, hdiFv, { ...transport })
      setDocuments(r)
      await refresh().catch(() => undefined)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Nie udało się wystawić dokumentów'
      setErr(msg); setNeedsCancel(WYMAGA_ANULOWANIA.test(msg))
    } finally { setIssuing(false) }
  }
  const anuluj = async () => {
    setPytanie(null); setCancelling(true)
    try {
      const r = await orderSplitApi.cancelDocuments(orderId)
      setNeedsCancel(false); setErr(''); setDocuments(null)
      setInfo(`Dokumenty podziału anulowane, towar wrócił na stan (${r?.returned_qty ?? 0} szt.). Popraw podział i zapisz ponownie.`)
      await refresh().catch(() => undefined)
    } catch (e) { setErr(e instanceof Error ? e.message : 'Nie udało się anulować dokumentów') }
    finally { setCancelling(false) }
  }

  const pdf = async (typ: 'wz' | 'hdi' | 'cmr', d: { id: string; number: string }) => {
    const url = typ === 'wz' ? wzApi.pdfUrl(d.id) : typ === 'hdi' ? hdiApi.pdfUrl(d.id) : cmrApi.pdfUrl(d.id)
    try { await downloadDocPdf(url, `${typ.toUpperCase()}-${d.number.replace(/\//g, '-')}.pdf`) }
    catch (e) { app.toast({ kind: 'warn', title: 'Nie udało się pobrać PDF', detail: e instanceof Error ? e.message : '' }) }
  }

  const zapiszRef = useRef(zapisz); zapiszRef.current = zapisz
  const cmds = useMemo<Cmd[]>(() => [
      { id: 'save', group: 1, label: 'Zapisz podział', icon: <Save size={17} />, primary: !matchesSaved, disabled: !preview || busy || !!bladOdczytu, run: () => void zapiszRef.current() },
      { id: 'issue', group: 1, label: 'Wystaw komplet dokumentów', icon: <FileText size={17} />, primary: matchesSaved, disabled: issuing || !matchesSaved, tip: 'Najpierw zapisz podział', run: () => setPytanie('issue') },
      { id: 'close', group: 3, label: 'Zamknij', icon: <X size={17} />, disabled: busy, run: onDone },
  ], [preview, busy, bladOdczytu, matchesSaved, issuing, onDone])
  useEffect(() => { setCmds(cmds) }, [cmds, setCmds])
  void active

  const listaDok = hdiFv ? 'WZ wewnętrzny (WM), WZ dla klienta, 2× CMR, HDI na całość i HDI do faktury' : 'WZ wewnętrzny (WM), WZ dla klienta, 2× CMR i HDI na całość'
  return (
    <>
      <CommandBar title="Podział wysyłki — faktura i WZ" count={`${orderNo} · ${clientName} · razem ${kgT(kgCalosc)} kg`} cmds={cmds} />
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <div className="dock-pad" style={{ maxWidth: 1100 }}>
          <div className="box" style={{ padding: 12, display: 'flex', gap: 12, alignItems: 'end', flexWrap: 'wrap' }}>
            <label className="fld"><span className="label">Na fakturę [kg]</span>
              <input className="field num w-num" style={{ width: 140 }} inputMode="decimal" value={celKgInput} onChange={e => onCel(e.target.value)} aria-label="Na fakturę kg" autoFocus /></label>
            <button className="btn" onClick={pol} data-tip="Połowa całości na fakturę">50/50</button>
            {loadingPreview && <span className="muted">Liczę…</span>}
            <span className="grow" style={{ flex: 1 }} />
            <span className="muted" style={{ fontSize: 'var(--fs-sm)', maxWidth: 420 }}>Faktura wystawiana w Subiekcie, reszta jedzie na WZ. Sztuki liczy serwer — tutaj tylko je widać i można poprawić pozycję.</span>
          </div>

          {bladOdczytu && <div className="note crit" role="alert"><FlagIcon level="crit" size={15} /><div>
            Nie udało się sprawdzić, czy to zamówienie ma już zapisany podział ({bladOdczytu}). Puste okno wygląda teraz jak zamówienie bez podziału, ale nim NIE JEST — zapis na ślepo nadpisałby ręczną korektę z poprzedniej sesji.
            <div style={{ marginTop: 6 }}><button className="btn sm" onClick={() => void wczytajZapisany()}>Spróbuj ponownie</button></div>
          </div></div>}

          {preview && <>
            {niepelnyZapis && <div className="note warn"><FlagIcon level="warn" size={15} /><div>Zapisany podział nie obejmuje wszystkich pozycji — któraś doszła po jego zapisaniu. Uzupełnij ją i zapisz podział.</div></div>}
            {preview.trafiono === false && <div className="note warn"><FlagIcon level="warn" size={15} /><div>{zZapisu
              ? <>Zapisany podział jest o <b>{odchylkaTekst(preview.odchylka)}</b> od celu — na fakturę idzie <b>{kgT(preview.kg_fv)} kg</b>. Zwykle znaczy to, że pozycja została poprawiona ręcznie.</>
              : <>Nie da się trafić dokładnie w podany cel całymi sztukami — najbliższy możliwy podział to <b>{kgT(preview.kg_fv)} kg</b> na fakturę (odchyłka <b>{odchylkaTekst(preview.odchylka)}</b>).</>}</div></div>}
            <div className="box"><table className="tbl">
              <thead><tr><th>Receptura</th><th className="num">kg/szt</th><th className="num">Zamówiono</th><th className="num">Na FV</th><th className="num">Na WZ</th></tr></thead>
              <tbody>{preview.lines.map(line => {
                const raw = overrides[line.id]
                const k = parseOverride(raw)
                const naWz = k === 'blad' ? null : k === 'brak' ? line.qty_wz : line.qty - k
                return (
                  <tr key={line.id} className="row editing">
                    <td><b>{line.recipe_name}</b>{line.product_type_name && <span className="sub">{line.product_type_name}</span>}</td>
                    <td className="num">{kgT(line.kg_per_unit)}</td>
                    <td className="num">{line.qty}</td>
                    <td className="num"><input className={`field num w-num${k === 'blad' ? ' invalid' : ''}`} inputMode="numeric" value={raw ?? (line.qty_invoice == null ? '' : String(line.qty_invoice))}
                      onChange={e => setOverrides(o => ({ ...o, [line.id]: e.target.value }))} aria-label={`na FV — ${line.recipe_name} ${line.kg_per_unit} kg`} /></td>
                    <td className={`num${naWz != null && naWz < 0 ? ' crit-ink strong' : ''}`}>{naWz ?? '—'}</td>
                  </tr>
                )
              })}</tbody>
            </table></div>
            <div className={`note${hasPendingOverrides ? ' warn' : ''}`}><div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
              {hasPendingOverrides && <b style={{ flexBasis: '100%' }}>Sumy poniżej są sprzed tej korekty — zapisz podział, żeby je przeliczyć.</b>}
              <span>Na fakturę <b>{kgT(preview.kg_fv)} kg</b></span><span>Na WZ <b>{kgT(preview.kg_wz)} kg</b></span><span>Razem <b>{kgT(preview.kg_calosc)} kg</b></span>
              <span className={preview.trafiono === false ? 'warn-ink strong' : ''}>Odchyłka <b>{odchylkaTekst(preview.odchylka)}</b></span>
            </div></div>
          </>}
          {!preview && !loadingPreview && !bladOdczytu && <div className="note">Wpisz kilogramy na fakturę (albo kliknij „50/50”), żeby zobaczyć podział pozycji.</div>}

          {err && <div className="note crit" role="alert"><FlagIcon level="crit" size={15} /><div>{err}
            {needsCancel && <div style={{ marginTop: 6 }}>Wyjście jest jedno: anulować dokumenty podziału. Anulowane zostaną WZ wewnętrzny (WM) i WZ dla klienta, towar wróci na stan. HDI i CMR zostają z tymi samymi numerami.
              <div style={{ marginTop: 6 }}><button className="btn sm danger" disabled={cancelling} onClick={() => setPytanie('cancel')}><Ban size={14} />{cancelling ? 'Anuluję…' : 'Anuluj dokumenty podziału'}</button></div></div>}
          </div></div>}
          {info && <div className="note info"><div>{info}</div></div>}

          {documents && <div className="box" style={{ padding: 12 }}>
            <div className="sect-h"><h3>Komplet dokumentów wystawiony</h3><div className="tools"><button className="btn sm danger" disabled={cancelling} onClick={() => setPytanie('cancel')}><Ban size={14} />Anuluj dokumenty podziału</button></div></div>
            {documents.pokrycie && !documents.pokrycie.pelne && <div className="note warn"><FlagIcon level="warn" size={15} /><div>
              <b>Papiery opisują o {kgT(documents.pokrycie.kg_braku)} kg więcej, niż wyjechało.</b> WM obejmuje {kgT(documents.pokrycie.kg_wydane)} kg (tyle było w magazynie), a WZ dla klienta i CMR do faktury liczą się z zamówienia ({kgT(documents.pokrycie.kg_zamowienia)} kg). Sprawdź dostawę, zanim faktura pójdzie do Subiekta.
            </div></div>}
            <dl className="kv">
              {([['WZ wewnętrzny (WM)', documents.wm, 'wz'], ['WZ dla klienta', documents.wz, 'wz'],
                ...(documents.cmr ?? []).map((c, i) => [i === 0 ? 'CMR — całość' : 'CMR — do faktury', c, 'cmr']),
                ['HDI — całość', documents.hdi_calosc, 'hdi'], ...(documents.hdi_fv ? [['HDI — do faktury', documents.hdi_fv, 'hdi']] : [])] as Array<[string, { id: string; number: string } | undefined | null, 'wz' | 'hdi' | 'cmr']>)
                .map(([label, d, typ]) => <React.Fragment key={label}><dt>{label}</dt><dd><b className="num">{d?.number ?? '—'}</b>{d?.id && <button className="btn sm ghost" style={{ marginLeft: 8 }} onClick={() => void pdf(typ, d)}><FileDown size={13} />PDF</button>}</dd></React.Fragment>)}
            </dl>
          </div>}

          <div className="sect-h"><h3>Dane na listy przewozowe (CMR)</h3><span className="sub">na OBA listy; numer faktury — do CMR do faktury</span></div>
          <div className="box" style={{ padding: 12, display: 'grid', gridTemplateColumns: 'minmax(0,2fr) minmax(0,1fr) minmax(0,1fr)', gap: '8px 12px' }}>
            <label className="fld"><span className="label">Przewoźnik</span>
              <select className="field" value={transport.carrier_id} disabled={issuing} aria-label="Przewoźnik CMR"
                onChange={e => { const id = e.target.value; const c = carriers.find(x => x.id === id); setTransport(t => ({ ...t, carrier_id: id, plate: id ? (t.plate.trim() ? t.plate : (c?.defaultPlate ?? '')) : '' })) }}>
                <option value="">— bez przewoźnika —</option>{carriers.map(c => <option key={c.id} value={c.id}>{c.name}{c.city ? `, ${c.city}` : ''}</option>)}</select></label>
            <label className="fld"><span className="label">Nr rejestracyjny</span><input className="field" value={transport.plate} disabled={issuing || !transport.carrier_id} onChange={e => setTransport(t => ({ ...t, plate: e.target.value }))} /></label>
            <label className="fld"><span className="label">Nr faktury</span><input className="field" value={transport.invoice_no} disabled={issuing} onChange={e => setTransport(t => ({ ...t, invoice_no: e.target.value }))} /></label>
            <label className="fld" style={{ gridColumn: '1 / -1' }}><span className="label">Instrukcje (pole 13)</span><input className="field" value={transport.instructions} disabled={issuing} onChange={e => setTransport(t => ({ ...t, instructions: e.target.value }))} /></label>
          </div>
          <label style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}><input type="checkbox" className="cbx" checked={hdiFv} onChange={e => setHdiFv(e.target.checked)} />także HDI do faktury</label>
          {zaladowane && zaladowane.loaded === 0 && <div className="note warn"><FlagIcon level="warn" size={15} /><div><b>Auto nie jest jeszcze załadowane.</b> Dokumenty opiszą plan, nie zawartość auta. Jeśli czegoś zabraknie, skan magazyniera pokaże rozjazd i papiery trzeba będzie poprawić.</div></div>}
          {!issuing && !matchesSaved && <div className="note"><div>{bladOdczytu ? 'Najpierw odczytaj podział z bazy („Spróbuj ponownie”) — dopóki nie wiadomo, co w niej leży, nie wolno ani zapisać, ani wystawić.'
            : !preview ? 'Wpisz kilogramy na fakturę, żeby zobaczyć podział przed wystawieniem.'
            : 'Zapisz podział, żeby wystawić komplet dokumentów — powstają one z tego, co zapisane w bazie, nie z tego, co widać na ekranie.'}</div></div>}
          <div className="row-wrap">
            <button className="btn" disabled={!preview || busy || !!bladOdczytu} onClick={() => void zapisz()}><Save size={15} />{saving ? 'Zapisywanie…' : 'Zapisz podział'}</button>
            <button className="btn primary" disabled={issuing || !matchesSaved} onClick={() => setPytanie('issue')}><Split size={15} />{issuing ? 'Wystawiam…' : 'Wystaw komplet dokumentów'}</button>
          </div>
        </div>
      </div>

      {pytanie === 'issue' && <Dialog title="Wystawić komplet dokumentów?" icon={<FileText size={20} color="var(--accent)" />} onClose={() => setPytanie(null)}
        footer={<><button className="btn" onClick={() => setPytanie(null)} data-autofocus>Wróć</button><button className="btn primary" onClick={() => void wystaw()}>Wystaw komplet</button></>}>
        <p>Powstaną: {listaDok}.</p>
        {zaladowane && zaladowane.loaded === 0 && <div className="note warn"><FlagIcon level="warn" size={15} /><div>Auto nie jest jeszcze załadowane — papiery opiszą PLAN, nie zawartość auta.</div></div>}
        {brakujeDanychPrzewoznika(transport) && <div className="note warn"><FlagIcon level="warn" size={15} /><div>CMR-y pojadą BEZ danych przewoźnika i numeru auta. Kierowca z takim listem nie ruszy — uzupełnisz je potem w Dokumentach CMR.</div></div>}
        <div className="note crit"><FlagIcon level="crit" size={15} /><div>WZ wewnętrzny <b>zdejmie towar ze stanu</b> wyrobów gotowych — cofniesz to tylko anulując cały komplet.</div></div>
      </Dialog>}
      {pytanie === 'cancel' && <Dialog title="Anulować dokumenty podziału?" icon={<Ban size={20} color="var(--crit)" />} onClose={() => setPytanie(null)}
        footer={<><button className="btn" onClick={() => setPytanie(null)} data-autofocus>Wróć</button><button className="btn primary" style={{ background: 'var(--crit)', borderColor: 'var(--crit)' }} onClick={() => void anuluj()}>Anuluj dokumenty</button></>}>
        <p>Anulowane zostaną WZ wewnętrzny (WM) i WZ dla klienta — towar wróci na stan wyrobów gotowych.</p>
        <p>HDI i CMR zostają: te same numery, treść odświeży się przy ponownym wystawieniu kompletu.</p>
      </Dialog>}
    </>
  )
}
