import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Save, X, ScanLine, Printer, Pencil, Check, Layers, Download, PackagePlus } from 'lucide-react'
import { useApp, CommandBar, Dialog, type Cmd } from '../../../shell/context'
import { kg, num, fmtDate } from '../../../data/model'
import { dataZApi } from '../../../data/mapuj'
import { FlagIcon } from '../../../ui/Glyphs'
import { BEZ_DRUKU_ETYKIET } from '../../../proba'
import { useApi } from '@/hooks/useApi'
import { rawBatchesApi, receptionsApi, suppliersApi } from '@/lib/api'
import { CALIBER_OPTIONS, OTHER_CARRIER_KINDS, caliberKg, caliberValue, containersForKg, type CaliberValue } from '@/lib/containers'
import {
  checkAgainstHdi, normalizeStartNo, parseKg, receptionIssues, receptionTotalKg, renumberAfterRemove, startNoIssue,
  type ReceptionGroup,
} from '@/features/raw-batches/receptionSplit'
import { validateReception } from '@/features/raw-batches/hooks/useRawBatches'
import { STORAGE_STATES, czyCzerwone, etykietaStanu, magazynStanu, progPrzyjecia } from '@/features/raw-batches/storageState'
import { errorText, isDesktopApp, scanDocument } from '@/lib/desktopScanner'
import type { ReceptionHeader, ValidationWarning } from '@/features/raw-batches/types'
import {
  SERVICE_MATERIAL_ID, doEdycji, doUtworzenia, dzisIso, grupy, kolejnaPozycja, nowyFormularz, numeryGrup, zamrozona,
  zDokumentu, zmianaUboju, zSkanu, type FormPrzyjecia, type SkanHdi,
} from './model'

interface Rodzaj { id: string; name: string; requiresDeboning: boolean; receivable: boolean; category: string }
interface Dostawca { id: string; name: string; displayName?: string }

const pln = (v: number) => `${v.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} zł`

/**
 * Nowe przyjęcie / edycja przyjęcia surowca — karta robocza, jak edytor
 * zamówienia. Jedno auto = jeden numer przyjęcia i tyle numerów porządkowych
 * (przyjęcia zewnętrznego), ile stosów stanęło w chłodni. Pozycje HDI wpisuje
 * się RAZ (albo wczytuje skan) i jednym kliknięciem przypina do numeru.
 * Zapis: POST/PUT /api/receptions — ten sam DTO co stary MES.
 */
export function PrzyjecieEditor({ tabId, receptionId, active, setCmds, onDone }: {
  tabId: string; receptionId?: string; active: boolean; setCmds: (c: Cmd[]) => void; onDone: (savedId?: string) => void
}) {
  const app = useApp()
  const edycja = !!receptionId
  const dzis = dzisIso()
  const supRes = useApi(() => suppliersApi.list())
  const typesRes = useApi(() => rawBatchesApi.materialTypes() as Promise<Rodzaj[]>)
  const recRes = useApi(() => (receptionId ? receptionsApi.byId(receptionId) : Promise.resolve(null)), [receptionId])

  const rodzaje = useMemo(() => (typesRes.data ?? []).filter(m => m.receivable), [typesRes.data])
  const dostawcy = useMemo(() => ((supRes.data ?? []) as Dostawca[]).slice().sort((a, b) => (a.displayName || a.name).localeCompare(b.displayName || b.name, 'pl')), [supRes.data])

  const [f, setF] = useState<FormPrzyjecia>(() => nowyFormularz(dzis))
  const [frozen, setFrozen] = useState<Record<string, string>>({})
  const [dirty, setDirty] = useState(false)
  const seeded = useRef(false)
  useEffect(() => {
    if (!edycja || seeded.current || !recRes.data) return
    seeded.current = true
    const z = zDokumentu(recRes.data)
    setF(z.f); setFrozen(z.frozen)
  }, [edycja, recRes.data])

  // Podpowiedzi numerów: dokument (miesięczny) i numer porządkowy (ciągły, osobna seria usługi).
  const [sugRec, setSugRec] = useState('')
  const [sugBatch, setSugBatch] = useState('')
  const usluga = f.header.isService && f.header.materialTypeId === SERVICE_MATERIAL_ID
  useEffect(() => {
    if (edycja) return
    let zywe = true
    receptionsApi.nextNumber(f.header.receivedDate, usluga).then(r => { if (zywe) setSugRec(r.nextNo) }).catch(() => { if (zywe) setSugRec('') })
    rawBatchesApi.nextNumber(usluga).then(r => { if (zywe) setSugBatch(r.suggestedBatchNo) }).catch(() => { if (zywe) setSugBatch('') })
    return () => { zywe = false }
  }, [edycja, f.header.receivedDate, usluga])

  const h = f.header
  const materialPoczatkowy = useMemo(() => (recRes.data ? zDokumentu(recRes.data).f.header.materialTypeId : ''), [recRes.data])
  const rodzaj = rodzaje.find(m => m.id === h.materialTypeId)
  const czerwone = czyCzerwone(rodzaj?.category)
  const prog = progPrzyjecia(rodzaj?.category, h.storageState)
  const magazyn = magazynStanu(h.storageState)
  const nos = useMemo(() => numeryGrup(f, edycja, sugBatch), [f, edycja, sugBatch])
  const gs = useMemo(() => grupy(f, edycja, sugBatch), [f, edycja, sugBatch])
  const issues = useMemo(() => receptionIssues(f.lines, f.groupCount, nos), [f.lines, f.groupCount, nos])
  const totalKg = receptionTotalKg(f.lines)
  const hdi = checkAgainstHdi(f.lines, gs, { kg: h.docKg, containers: h.docContainers })
  const pojemniki = gs.reduce((a, g) => a + (g.containersCount ?? 0), 0)
  const zamrozone = f.batchIds.some(id => !!frozen[id ?? ''])

  const upd = (patch: Partial<FormPrzyjecia>) => { setF(x => ({ ...x, ...patch })); setDirty(true) }
  const setH = <K extends keyof ReceptionHeader>(k: K, v: ReceptionHeader[K]) => { setF(x => ({ ...x, header: { ...x.header, [k]: v } })); setDirty(true) }
  const setMaterial = (id: string) => {
    const m = rodzaje.find(x => x.id === id)
    setF(x => ({ ...x, header: {
      ...x.header, materialTypeId: id,
      // Usługa tylko na mięsie z/s; stan wybiera się tylko przy mięsie czerwonym.
      isService: id === SERVICE_MATERIAL_ID ? x.header.isService : false,
      storageState: czyCzerwone(m?.category) ? x.header.storageState : 'chlodzony',
    } }))
    setDirty(true)
  }
  // Nowe przyjęcie: domyślnie ćwiartka (gdy jest w słowniku), inaczej pierwszy przyjmowalny rodzaj.
  useEffect(() => {
    if (edycja || !rodzaje.length || rodzaje.some(m => m.id === f.header.materialTypeId)) return
    setF(x => ({ ...x, header: { ...x.header, materialTypeId: rodzaje[0].id } }))
  }, [edycja, rodzaje, f.header.materialTypeId])

  // ─── Pozycje HDI ─────────────────────────────────────────────────────────
  const focusKg = (i: number) => requestAnimationFrame(() => document.getElementById(`${tabId}-kg-${i}`)?.focus())
  const addLine = useCallback(() => {
    setF(x => ({ ...x, lines: [...x.lines, kolejnaPozycja(x.lines[x.lines.length - 1], dzisIso())] }))
    setDirty(true)
    focusKg(f.lines.length)
  }, [f.lines.length]) // eslint-disable-line react-hooks/exhaustive-deps
  const setLine = (i: number, patch: Partial<FormPrzyjecia['lines'][number]>) => {
    setF(x => ({
      ...x,
      // Przepięcie pozycji zmienia kg OBU grup — ręcznie przeliczone pojemniki przestają pasować.
      containerOverride: 'group' in patch ? {} : x.containerOverride,
      lines: x.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)),
    }))
    setDirty(true)
  }
  const removeLine = (i: number) => { if (f.lines.length > 1) upd({ lines: f.lines.filter((_, j) => j !== i) }) }

  // ─── Numery porządkowe ───────────────────────────────────────────────────
  const addGroup = () => upd({ groupCount: f.groupCount + 1, containerOverride: {} })
  const [zdejmij, setZdejmij] = useState<number | null>(null)
  const removeGroup = (index: number) => {
    if (f.groupCount <= 1) return
    upd({
      lines: renumberAfterRemove(f.lines, index), groupCount: f.groupCount - 1, containerOverride: {},
      batchIds: f.batchIds.filter((_, i) => i !== index), numeryDokumentu: f.numeryDokumentu.filter((_, i) => i !== index),
      ordinalOverride: Object.fromEntries(Object.entries(f.ordinalOverride).flatMap(([k, v]) => (Number(k) === index ? [] : [[Number(k) > index ? Number(k) - 1 : Number(k), v]]))),
    })
    setZdejmij(null)
  }
  const [edytNr, setEdytNr] = useState<number | null>(null)
  const [nrDraft, setNrDraft] = useState('')
  const [nrBlad, setNrBlad] = useState<string | null>(null)
  const zapiszNr = () => {
    if (edytNr === null) return
    const blad = startNoIssue(nrDraft, h.isService)
    if (blad) { setNrBlad(blad); return }
    const czysty = nrDraft.trim()
    const next = { ...f.ordinalOverride }
    if (czysty) next[edytNr] = normalizeStartNo(czysty, h.isService)
    else delete next[edytNr]   // puste = wracamy do automatu
    upd({ ordinalOverride: next })
    setEdytNr(null); setNrBlad(null)
  }
  const [edytRec, setEdytRec] = useState(false)

  // ─── Skan HDI ────────────────────────────────────────────────────────────
  const fileRef = useRef<HTMLInputElement>(null)
  const [scanning, setScanning] = useState(false)
  const [scanNote, setScanNote] = useState<{ ok: boolean; text: string } | null>(null)
  const [ostatniSkan, setOstatniSkan] = useState<File | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const supName = (id: string) => { const s = dostawcy.find(x => x.id === id); return s ? (s.displayName || s.name) : '' }
  const loadHdi = useCallback(async (file: File) => {
    setScanning(true); setScanNote(null); setOstatniSkan(file)
    try {
      const scan = await receptionsApi.scanHdi(file) as SkanHdi & { sumOk: boolean | null }
      if (scan.lines.length === 0) { setScanNote({ ok: false, text: 'Nie rozpoznano żadnej pozycji. Sprawdź, czy to skan HDI i czy jest czytelny — pozycje można wpisać ręcznie.' }); return }
      setF(x => zSkanu(x, scan)); setDirty(true)
      const s = scan.lines.reduce((a, l) => a + l.kgReceived, 0)
      setScanNote(scan.sumOk === false
        ? { ok: false, text: `Odczytano ${scan.lines.length} pozycji na ${kg(s)}, ale stopka HDI mówi ${kg(scan.totalKg ?? 0)} — brakuje pozycji albo któraś waga została źle odczytana. Popraw ręcznie.` }
        : { ok: true, text: `Odczytano ${scan.lines.length} pozycji na ${kg(s)}${scan.sumOk ? ' — zgodne ze stopką HDI' : ''}. ${scan.supplier ? `Dostawca: ${scan.supplier.name} (rozpoznany po ${scan.supplier.matchedBy}).` : 'Dostawcy nie rozpoznano — wybierz go z listy.'} Sprawdź numery partii: literówki w nich nie rozjeżdżają żadnej sumy.` })
    } catch (e) {
      setScanNote({ ok: false, text: e instanceof Error ? e.message : 'Nie udało się odczytać pliku' })
    } finally { setScanning(false) }
  }, [])
  const scanFromDevice = async () => {
    setScanning(true); setScanNote(null)
    try { await loadHdi(await scanDocument()) } catch (e) { setScanNote({ ok: false, text: errorText(e) }); setScanning(false) }
  }
  // Skan także ze schowka (Ctrl+V) — tylko gdy w schowku jest PLIK; tekst wkleja się normalnie.
  useEffect(() => {
    if (!active) return
    const onPaste = (e: ClipboardEvent) => {
      const file = [...(e.clipboardData?.files ?? [])][0]
      if (!file) return
      e.preventDefault(); void loadHdi(file)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [active, loadHdi])

  // ─── Zapis ───────────────────────────────────────────────────────────────
  const [confirm, setConfirm] = useState<{ groups: ReceptionGroup[]; warnings: ValidationWarning[] } | null>(null)
  const [saving, setSaving] = useState(false)
  const [blad, setBlad] = useState<string | null>(null)
  const [discardAsk, setDiscardAsk] = useState(false)
  const lock = useRef(false)
  const loadError = supRes.error || typesRes.error || recRes.error
  const ready = !!supRes.data && !!typesRes.data && (!edycja || seeded.current)
  const mozna = ready && !!h.supplierId && totalKg > 0 && issues.errors.length === 0

  const zapisz = useCallback(async (groups: ReceptionGroup[]) => {
    if (lock.current) return
    lock.current = true; setSaving(true); setBlad(null)
    try {
      if (edycja && receptionId) {
        await receptionsApi.update(receptionId, doEdycji(h, groups))
        app.toast({ kind: 'ok', title: `Zapisano przyjęcie ${h.receptionNo}`, detail: `${kg(groups.reduce((a, g) => a + g.kg, 0))} · ${groups.length} ${groups.length === 1 ? 'numer' : 'numery'}` })
        setDirty(false); onDone(receptionId)
      } else {
        const out = await receptionsApi.create(doUtworzenia(h, groups))
        const nr = out.batches.map((b: { internalBatchNo: string }) => b.internalBatchNo)
        app.toast({ kind: 'ok', title: `Przyjęcie ${out.reception?.reception_no ?? ''} — ${kg(out.batches.reduce((a: number, b: { kgReceived: number }) => a + Number(b.kgReceived), 0))}`,
          detail: `Nr przyjęcia zewnętrznego: ${nr.join(', ')}. ${BEZ_DRUKU_ETYKIET}` })
        setConfirm(null); setDirty(false); onDone(out.reception?.id || undefined)
      }
    } catch (e) {
      setConfirm(null)
      setBlad(e instanceof Error ? e.message : 'Nie udało się zapisać przyjęcia')
    } finally { lock.current = false; setSaving(false) }
  }, [edycja, receptionId, h, app, onDone])

  const przyjmij = useCallback(() => {
    if (!mozna || saving) return
    setBlad(null)
    if (edycja) { void zapisz(gs); return }
    // Te same reguły co stary MES, liczone PER numer porządkowy (daty i kg różnią się między grupami).
    const v = validateReception(h, gs)
    if (v.ok === false) { setBlad(v.error.message); return }
    setConfirm({ groups: gs, warnings: v.warnings })
  }, [mozna, saving, edycja, zapisz, gs, h])
  const przyjmijRef = useRef(przyjmij); przyjmijRef.current = przyjmij

  const close = useCallback(() => { if (dirty) setDiscardAsk(true); else onDone() }, [dirty, onDone])
  const tytulZapisu = edycja ? 'Zapisz zmiany' : 'Przyjmij dostawę'
  const cmds = useMemo<Cmd[]>(() => [
    { id: 'save', group: 1, label: tytulZapisu, icon: edycja ? <Save size={17} /> : <PackagePlus size={17} />, kbd: 'Ctrl+Enter', primary: true, disabled: !mozna || saving, run: () => przyjmijRef.current() },
    { id: 'add-line', group: 2, label: 'Dodaj pozycję', icon: <Plus size={17} />, run: () => addLine() },
    { id: 'hdi', group: 2, label: 'Wczytaj HDI', icon: <ScanLine size={17} />, disabled: scanning, run: () => fileRef.current?.click() },
    { id: 'discard', group: 3, label: edycja ? 'Zamknij bez zapisu' : 'Odrzuć', icon: <X size={17} />, run: close },
  ], [tytulZapisu, edycja, mozna, saving, scanning, addLine, close])
  useEffect(() => { setCmds(cmds) }, [cmds, setCmds])
  useEffect(() => {
    if (!active) return
    const key = (e: KeyboardEvent) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !document.querySelector('.dialog-wrap')) { e.preventDefault(); przyjmijRef.current() } }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [active])

  const numerPrzyjecia = edycja ? h.receptionNo : (h.receptionNo || sugRec || '—')
  const title = edycja ? `Edycja przyjęcia ${h.receptionNo}` : 'Nowe przyjęcie surowca'
  const podzial = f.groupCount > 1

  return (
    <>
      <CommandBar title={title} count={edycja ? (dirty ? 'niezapisane zmiany' : 'bez zmian') : `${kg(totalKg)} · ${f.groupCount === 1 ? `nr ${nos[0] ?? '—'}` : `nr ${nos.join(', ')}`}`} cmds={cmds} />
      <input ref={fileRef} type="file" accept=".pdf,.png,.jpg,.jpeg" hidden onChange={e => { const fl = e.target.files?.[0]; if (fl) void loadHdi(fl); e.target.value = '' }} />
      <div className={`rec-form${dragOver ? ' drop' : ''}`} style={{ flex: 1, minHeight: 0, overflow: 'auto' }}
        onDragOver={e => { e.preventDefault(); setDragOver(true) }} onDragLeave={() => setDragOver(false)}
        onDrop={e => { e.preventDefault(); setDragOver(false); const fl = e.dataTransfer.files?.[0]; if (fl) void loadHdi(fl) }}>
        <div className="dock-pad" style={{ maxWidth: 1320 }}>
          {loadError && <div className="note crit" role="alert"><FlagIcon level="crit" size={15} /><div>Nie udało się pobrać danych: {loadError}</div></div>}
          {!ready && !loadError && <div className="note">{edycja ? 'Wczytywanie dostawy…' : 'Pobieranie kartotek…'}</div>}
          {blad && <div className="note crit" role="alert"><FlagIcon level="crit" size={15} /><div><b>{edycja ? 'Serwer odmówił zapisu:' : 'Nie można przyjąć:'}</b> {blad}</div></div>}
          {edycja && zamrozone && <div className="note warn"><FlagIcon level="warn" size={15} /><div>Część numerów jest już użyta w produkcji — ich pozycji nie da się zmienić (wyszarzone). Nagłówek i pozostałe numery poprawisz normalnie.</div></div>}

          <div className="ov-grid rec-head">
            <div className="box ov-card">
              <h4>Dostawa</h4>
              <div className="rec-fields">
                <div className="fld rec-no">
                  <span className="label">Numer przyjęcia</span>
                  {edytRec && !edycja
                    ? <span style={{ display: 'flex', gap: 6 }}><input className="field" autoFocus value={h.receptionNo || sugRec} onChange={e => setH('receptionNo', e.target.value.trim() === sugRec ? '' : e.target.value)} aria-label="Numer przyjęcia" />
                      <button className="btn icon" onClick={() => setEdytRec(false)} aria-label="Zatwierdź numer"><Check size={15} /></button></span>
                    : <span className="rec-no-v"><b>{numerPrzyjecia}</b>{!edycja && <button className="btn ghost icon sm" onClick={() => setEdytRec(true)} aria-label="Popraw numer przyjęcia" data-tip="Popraw numer przyjęcia"><Pencil size={13} /></button>}</span>}
                  <span className="sub">{edycja ? 'numer dokumentu się nie zmienia' : 'podpowiedź — numer nada serwer przy zapisie'}</span>
                </div>
                <label className="fld rec-sup">
                  <span className="label">Dostawca</span>
                  <select id={`${tabId}-sup`} className="field" value={h.supplierId} onChange={e => setH('supplierId', e.target.value)} disabled={edycja} autoFocus={!edycja}
                    data-tip={edycja ? 'Zła firma? Anuluj dostawę i wpisz ją ponownie — zmiana dostawcy przesunęłaby saldo pojemników.' : undefined}>
                    <option value="">Wybierz dostawcę…</option>
                    {dostawcy.map(s => <option key={s.id} value={s.id}>{s.displayName || s.name}</option>)}
                  </select>
                </label>
                <label className="fld">
                  <span className="label">Data przyjęcia</span>
                  <input type="date" className="field" value={h.receivedDate} onChange={e => setH('receivedDate', e.target.value)} />
                </label>
                <label className="fld">
                  <span className="label">Rodzaj surowca</span>
                  <select className="field" value={h.materialTypeId} onChange={e => setMaterial(e.target.value)} disabled={edycja && zamrozone}
                    data-tip={edycja && zamrozone ? 'Numer użyty w produkcji — rodzaju nie da się już zmienić' : undefined}>
                    {rodzaje.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                </label>
                {czerwone && <label className="fld">
                  <span className="label">Stan</span>
                  <select className="field" value={h.storageState || 'chlodzony'} onChange={e => setH('storageState', e.target.value)}>
                    {STORAGE_STATES.map(st => <option key={st} value={st}>{etykietaStanu(st)}</option>)}
                  </select>
                </label>}
              </div>
              <p className="muted rec-hint">
                {rodzaj ? <>{rodzaj.requiresDeboning ? 'Na rozbiór (magazyn surowca)' : 'Prosto na magazyn mięsa'} · przyjęcie do <b>{prog.opis}</b>{!prog.wKsiedze && ' (próg zakładowy)'}{czerwone && <> · magazyn nr {magazyn.nr} — {magazyn.nazwa}</>}</> : null}
                {edycja && materialPoczatkowy && h.materialTypeId !== materialPoczatkowy && <><br /><span className="warn-ink">Zmiana rodzaju przeniesie stan między magazynem surowca a magazynem mięsa (z ruchem w księdze).</span></>}
              </p>
              {h.materialTypeId === SERVICE_MATERIAL_ID && !edycja && <label className={`rec-service${h.isService ? ' on' : ''}`}>
                <input type="checkbox" checked={h.isService} onChange={e => setH('isService', e.target.checked)} />
                <span><b>Przyjęcie na usługę</b><span className="sub">Mięso powierzone przez klienta — numery idą osobną serią z literą U (48U, 49U…).</span></span>
              </label>}
            </div>

            <div className="box ov-card">
              <h4>Dokument dostawcy i opakowania</h4>
              <div className="rec-fields">
                <label className="fld"><span className="label">Nr HDI</span><input className="field" value={h.hdiNo} onChange={e => setH('hdiNo', e.target.value)} placeholder="np. 33656" /></label>
                <label className="fld rec-wide"><span className="label">Nr WZ / faktury dostawcy</span><input className="field" value={h.documentNo} onChange={e => setH('documentNo', e.target.value)} placeholder="np. WZ 388/MDU/08/2026" /></label>
                <label className="fld"><span className="label">Kaliber pojemnika</span>
                  <select className="field" value={caliberValue(h.containerKg)} onChange={e => { setF(x => ({ ...x, header: { ...x.header, containerKg: caliberKg(e.target.value as CaliberValue) }, containerOverride: {} })); setDirty(true) }}>
                    {CALIBER_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select></label>
                <label className="fld"><span className="label">Cena / kg (zł){usluga && <span className="faint"> — mięso klienta</span>}</span>
                  <input className="field num" inputMode="decimal" value={h.pricePerKg || ''} placeholder="0,00" onChange={e => setH('pricePerKg', parseKg(e.target.value))} /></label>
                <label className="fld"><span className="label">Palety H1</span><input className="field num" inputMode="numeric" value={h.palletsH1 || ''} placeholder="0" onChange={e => setH('palletsH1', parseInt(e.target.value) || 0)} /></label>
                <div className="fld rec-wide"><span className="label">Inne opakowania / palety</span>
                  <span style={{ display: 'flex', gap: 6 }}>
                    <select className="field" value={h.palletsOtherKind || 'net_e1'} onChange={e => setH('palletsOtherKind', e.target.value)} aria-label="Rodzaj innych opakowań">
                      {OTHER_CARRIER_KINDS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
                    </select>
                    <input className="field num" style={{ width: 80 }} inputMode="numeric" value={h.palletsOther || ''} placeholder="0" onChange={e => setH('palletsOther', parseInt(e.target.value) || 0)} aria-label="Ilość innych opakowań" />
                  </span></div>
                <label className="fld rec-full"><span className="label">Uwagi</span><input className="field" value={h.notes} onChange={e => setH('notes', e.target.value)} /></label>
              </div>
            </div>
          </div>

          <div className="sect-h"><h3>Pozycje z HDI</h3><span className="sub">kolejność jak na HDI · Enter w masie ostatniej pozycji — nowa pozycja · skan można przeciągnąć albo wkleić (Ctrl+V)</span>
            <div className="tools">
              {isDesktopApp() && <button className="btn sm" disabled={scanning} onClick={() => void scanFromDevice()}><Printer size={15} />Skanuj HDI</button>}
              <button className="btn sm" disabled={scanning} onClick={() => fileRef.current?.click()}><ScanLine size={15} />{scanning ? 'Odczytuję…' : 'Wczytaj HDI'}</button>
              <button className="btn sm" onClick={addLine}><Plus size={15} />Dodaj pozycję</button>
            </div></div>
          {scanNote && <div className={`note ${scanNote.ok ? 'ok' : 'warn'}`}><FlagIcon level={scanNote.ok ? 'info' : 'warn'} size={15} /><div>{scanNote.text}
            {ostatniSkan && !scanNote.ok && <div><button className="btn sm ghost" style={{ marginTop: 6 }} onClick={() => { const url = URL.createObjectURL(ostatniSkan); const a = document.createElement('a'); a.href = url; a.download = ostatniSkan.name || 'skan-hdi.pdf'; a.click(); URL.revokeObjectURL(url) }}><Download size={14} />Pobierz skan, który odczytywano</button></div>}
          </div></div>}
          <div className="box">
            <table className="tbl rec-lines">
              <thead><tr><th className="num" style={{ width: 40 }}>Lp.</th><th className="num">Masa netto</th><th>Nr partii dostawcy</th><th>Data uboju</th><th>Data ważności</th>{podzial && <th>Nr przyjęcia zewn.</th>}<th style={{ width: 40 }} /></tr></thead>
              <tbody>{f.lines.map((l, i) => {
                const zam = !!zamrozona(f, frozen, l.group)
                return (
                  <tr key={i} className={`row editing${zam ? ' closed' : ''}`}>
                    <td className="num muted">{i + 1}</td>
                    <td className="num"><input id={`${tabId}-kg-${i}`} className="field num w-kg" inputMode="decimal" placeholder="0,00" disabled={zam} aria-label={`Masa netto, pozycja ${i + 1}`}
                      value={l.kgRaw ?? (l.kgReceived ? String(l.kgReceived).replace('.', ',') : '')}
                      onChange={e => setLine(i, { kgRaw: e.target.value, kgReceived: parseKg(e.target.value) })}
                      onKeyDown={e => { if (e.key === 'Enter' && !e.ctrlKey && i === f.lines.length - 1) { e.preventDefault(); if (l.kgReceived > 0) addLine() } }} /> <span className="sub">kg</span></td>
                    <td><input className="field code" value={l.supplierBatchNo} placeholder="np. 112819" disabled={zam} aria-label={`Nr partii, pozycja ${i + 1}`} onChange={e => setLine(i, { supplierBatchNo: e.target.value })} /></td>
                    <td><input type="date" className="field" value={l.slaughterDate} disabled={zam} aria-label={`Data uboju, pozycja ${i + 1}`} onChange={e => { setF(x => ({ ...x, lines: x.lines.map((y, j) => (j === i ? zmianaUboju(y, e.target.value) : y)) })); setDirty(true) }} /></td>
                    <td><input type="date" className="field" value={l.expiryDate} disabled={zam} aria-label={`Data ważności, pozycja ${i + 1}`} onChange={e => setLine(i, { expiryDate: e.target.value })} /></td>
                    {podzial && <td><div className="seg" role="group" aria-label={`Numer dla pozycji ${i + 1}`}>
                      {nos.map((n, g) => <button key={g} aria-pressed={l.group === g} disabled={zam || !!zamrozona(f, frozen, g)} onClick={() => setLine(i, { group: g })}>{n}</button>)}
                    </div></td>}
                    <td><button className="btn ghost icon sm" style={{ width: 28 }} disabled={f.lines.length <= 1 || zam} onClick={() => removeLine(i)} aria-label={`Usuń pozycję ${i + 1}`}><X size={15} /></button></td>
                  </tr>
                )
              })}</tbody>
              <tfoot><tr><td /><td className="num">{kg(totalKg)}</td><td colSpan={podzial ? 5 : 4}>{f.lines.length} {f.lines.length === 1 ? 'pozycja' : f.lines.length < 5 ? 'pozycje' : 'pozycji'}</td></tr></tfoot>
            </table>
          </div>

          <div className="sect-h"><h3>Numery przyjęcia zewnętrznego</h3><span className="sub">tyle numerów, ile stosów stanęło w chłodni — jedna partia dostawcy w całości w jednym numerze</span>
            <div className="tools"><button className="btn sm" onClick={addGroup}><Layers size={15} />Rozbij na kolejny numer</button></div></div>
          <div className="box">
            <table className="tbl">
              <thead><tr><th>Nr</th><th className="num">Waga</th><th className="num">Pojemniki</th><th>Partie dostawcy</th><th>Ubój</th><th>Ważność</th><th style={{ width: 40 }} /></tr></thead>
              <tbody>{gs.map(g => {
                const zam = zamrozona(f, frozen, g.index)
                const auto = containersForKg(g.kg, h.containerKg ?? null)
                const istniejacy = edycja && !!f.batchIds[g.index]
                return (
                  <tr key={g.index} className={`row${zam ? ' closed' : ''}${g.kg > 0 ? '' : ' err-row'}`}>
                    <td>{edytNr === g.index
                      ? <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}><input className="field code" style={{ width: 90 }} autoFocus value={nrDraft} aria-label="Numer przyjęcia zewnętrznego"
                          onChange={e => { setNrDraft(e.target.value); setNrBlad(null) }} onBlur={zapiszNr}
                          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); zapiszNr() } if (e.key === 'Escape') { e.stopPropagation(); setEdytNr(null); setNrBlad(null) } }} />
                          {nrBlad && <span className="crit-ink" style={{ fontSize: 'var(--fs-sm)' }}>{nrBlad}</span>}</span>
                      : <span className="rec-no-v"><b className="code">{g.batchNo}</b>
                          {!zam && !istniejacy && <button className="btn ghost icon sm" onClick={() => { setEdytNr(g.index); setNrDraft(f.ordinalOverride[g.index] ?? g.batchNo ?? '') }} aria-label={`Popraw numer ${g.batchNo}`} data-tip="Popraw numer — kolejne przesuną się za nim"><Pencil size={13} /></button>}</span>}
                      {zam && <span className="tag warn" style={{ marginLeft: 6 }} data-tip={zam}>użyty</span>}</td>
                    <td className={`num strong${g.kg > 0 ? '' : ' crit-ink'}`}>{kg(g.kg)}</td>
                    <td className="num"><input className="field num" style={{ width: 80 }} inputMode="numeric" disabled={!!zam} aria-label={`Pojemniki, numer ${g.batchNo}`}
                      placeholder={auto !== null ? String(auto) : 'wpisz'} value={f.containerOverride[g.index] ?? (auto ?? '')}
                      onChange={e => upd({ containerOverride: { ...f.containerOverride, [g.index]: e.target.value === '' ? null : parseInt(e.target.value) || 0 } })} /></td>
                    <td className="code ell" style={{ maxWidth: 260 }}>{g.supplierNos.join(', ') || <span className="faint">—</span>}</td>
                    <td className="num">{g.slaughterDate ? fmtDate(dataZApi(g.slaughterDate)) : '—'}</td>
                    <td className="num">{g.expiryDate ? fmtDate(dataZApi(g.expiryDate)) : '—'}</td>
                    <td>{f.groupCount > 1 && <button className="btn ghost icon sm" style={{ width: 28 }} disabled={!!zam} onClick={() => (istniejacy ? setZdejmij(g.index) : removeGroup(g.index))} aria-label={`Usuń numer ${g.batchNo}`}><X size={15} /></button>}</td>
                  </tr>
                )
              })}</tbody>
            </table>
          </div>

          <div className="box rec-sum">
            <div className="f"><span className="k">Dostawa</span><span className="v">{kg(totalKg)}</span></div>
            <div className="f"><span className="k">Pojemniki</span><span className="v">{num(pojemniki)}</span></div>
            <div className="f"><span className="k">Wartość netto</span><span className="v">{usluga ? <span className="faint">usługa</span> : pln(totalKg * (h.pricePerKg || 0))}</span></div>
            <label className="fld"><span className="label">Masa netto z HDI</span><input className="field num" inputMode="decimal" placeholder="9 000,00" value={h.docKg || ''} onChange={e => setH('docKg', parseKg(e.target.value))} /></label>
            <label className="fld"><span className="label">Pojemniki z HDI</span><input className="field num" inputMode="numeric" placeholder="600" value={h.docContainers || ''} onChange={e => setH('docContainers', parseInt(e.target.value) || 0)} /></label>
            <div className="rec-check">
              {h.docKg <= 0 && h.docContainers <= 0 ? <span className="muted">Wpisz sumy ze stopki HDI — od razu widać pominiętą albo zdublowaną pozycję.</span>
                : hdi.ok ? <span className="ok-ink strong">Zgodne z HDI: {kg(totalKg)}{h.docContainers > 0 ? `, ${num(h.docContainers)} poj.` : ''}</span>
                : <span className="warn-ink strong">
                    {hdi.kgDiff !== 0 && <span style={{ display: 'block' }}>Wpisano {kg(totalKg)}, HDI mówi {kg(h.docKg)} (różnica {hdi.kgDiff > 0 ? '+' : ''}{num(hdi.kgDiff)} kg)</span>}
                    {hdi.containersDiff !== 0 && <span style={{ display: 'block' }}>Pojemniki {hdi.containersDiff > 0 ? '+' : ''}{hdi.containersDiff} wobec HDI — sprawdź kaliber albo przeliczenie stosu</span>}
                  </span>}
            </div>
          </div>

          {issues.errors.map(m => <div key={m} className="note crit"><FlagIcon level="crit" size={15} /><div>{m}</div></div>)}
          {issues.warnings.map(m => <div key={m} className="note warn"><FlagIcon level="warn" size={15} /><div>{m}</div></div>)}
          {ready && !h.supplierId && <div className="note"><FlagIcon level="info" size={15} /><div>Wybierz dostawcę, żeby przyjąć dostawę.</div></div>}
          <div className="row-wrap" style={{ justifyContent: 'flex-end' }}>
            <button className="btn" onClick={close} disabled={saving}>{edycja ? 'Zamknij bez zapisu' : 'Odrzuć'}</button>
            <button className="btn primary" disabled={!mozna || saving} onClick={przyjmij}>{edycja ? <Save size={15} /> : <PackagePlus size={15} />}
              {saving ? 'Zapisywanie…' : `${tytulZapisu} (${kg(totalKg)}${f.groupCount > 1 ? ` → nr ${nos.join(', ')}` : `, nr ${nos[0] ?? '—'}`})`}</button>
          </div>
          <div className="note info"><FlagIcon level="info" size={15} /><div>Zapis idzie na serwer — do KOPII bazy w wersji próbnej. Zawieszki palet drukuje na razie stary MES.</div></div>
        </div>
      </div>

      {confirm && <Dialog title="Potwierdź przyjęcie dostawy" icon={<PackagePlus size={20} />} onClose={() => { if (!saving) setConfirm(null) }}
        footer={<><button className="btn" onClick={() => setConfirm(null)} disabled={saving} data-autofocus>Wróć</button>
          <button className="btn primary" disabled={saving} onClick={() => void zapisz(confirm.groups)}><Check size={15} />{saving ? 'Zapisywanie…' : 'Potwierdź'}</button></>}>
        <div className="box"><table className="tbl">
          <tbody>
            <tr><td>Numer przyjęcia</td><td className="r code strong">{numerPrzyjecia}</td></tr>
            <tr><td>Dostawca</td><td className="r strong">{supName(h.supplierId)}</td></tr>
            <tr><td>{rodzaj?.name ?? 'Surowiec'}{usluga ? ' · usługa' : ''}</td><td className="r strong">{kg(confirm.groups.reduce((a, g) => a + g.kg, 0))}</td></tr>
            {confirm.groups.map(g => <tr key={g.index}><td>Nr przyjęcia zewn. <b className="code">{g.batchNo}</b><span className="sub">{g.supplierNos.join(', ') || 'bez partii dostawcy'}</span></td>
              <td className="r"><b>{kg(g.kg)}</b><span className="sub">do {g.expiryDate ? fmtDate(dataZApi(g.expiryDate)) : '—'}</span></td></tr>)}
            {!usluga && <tr><td>Wartość netto</td><td className="r">{pln(confirm.groups.reduce((a, g) => a + g.kg, 0) * (h.pricePerKg || 0))}</td></tr>}
          </tbody>
        </table></div>
        {confirm.warnings.map(w => <div key={w.message} className="note warn"><FlagIcon level="warn" size={15} /><div>{w.message}</div></div>)}
        <p className="muted" style={{ fontSize: 'var(--fs-sm)' }}>Numery — przyjęcia i porządkowe — nadaje serwer przy zapisie; powyższe to podpowiedzi. Gdy w tej samej chwili ktoś przyjmie dostawę z drugiego stanowiska, faktyczne mogą wyjść wyższe.</p>
      </Dialog>}
      {zdejmij !== null && <Dialog title={`Zdjąć numer ${nos[zdejmij]} z dostawy?`} onClose={() => setZdejmij(null)}
        footer={<><button className="btn" onClick={() => setZdejmij(null)} data-autofocus>Wróć</button><button className="btn primary" style={{ background: 'var(--crit)', borderColor: 'var(--crit)' }} onClick={() => removeGroup(zdejmij)}>Zdejmij numer</button></>}>
        <p>Przy zapisie numer {nos[zdejmij]} zostanie anulowany, a jego pozycje HDI ({kg(gs[zdejmij]?.kg ?? 0)}) przejdą do numeru {nos[Math.max(0, zdejmij - 1)]}. Żeby zdjąć kilogramy ze stanu, usuń pozycje HDI.</p>
      </Dialog>}
      {discardAsk && <Dialog title="Zamknąć bez zapisu?" onClose={() => setDiscardAsk(false)}
        footer={<><button className="btn" onClick={() => setDiscardAsk(false)} data-autofocus>Wróć do formularza</button><button className="btn primary" style={{ background: 'var(--crit)', borderColor: 'var(--crit)' }} onClick={() => { setDiscardAsk(false); onDone() }}>Odrzuć zmiany</button></>}>
        <p>Niezapisane zmiany przepadną.</p>
      </Dialog>}
    </>
  )
}
