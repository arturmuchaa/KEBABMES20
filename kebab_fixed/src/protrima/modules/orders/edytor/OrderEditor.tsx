import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Trash2, Save, CheckCheck, X } from 'lucide-react'
import { useApp, CommandBar, Dialog, type Cmd } from '../../../shell/context'
import { useOrders } from '../../../data/store'
import { kg, num as fmtNum } from '../../../data/model'
import { FlagIcon } from '../../../ui/Glyphs'
import { useApi } from '@/hooks/useApi'
import { clientOrdersApi, clientsApi, packagingApi, productTypesApi, recipesApi } from '@/lib/api'
import type { ClientOrder } from '@/lib/mockApi'
import type { LineForm } from '@/features/orders/order-form/types'
import { filterRecipesFor } from '@/features/orders/order-form/types'
import { num } from '@/features/orders/order-entry/model'
import { doDto, kolejnaPozycja, nowyFormularz, ostrzezenieUsuniecia, pustyWiersz, sumy, walidacja, zZamowienia, type FormZam } from './model'
import { SzkieletBloku } from '../../../ui/Szkielet'
import { PROBA } from '../../../proba'

const dzisIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

/**
 * Nowe zamówienie / edycja zamówienia — karta robocza. Zapis przez
 * clientOrdersApi.create/update (ten sam DTO co stary MES), potem odświeżenie
 * listy z serwera. Enter w ilości ostatniej pozycji dodaje kolejną
 * (dziedziczy rodzaj, recepturę, tuleję i gramaturę), Ctrl+Enter zapisuje.
 */
export function OrderEditor({ tabId, orderId, copyFromId, active, setCmds, onDone }: {
  tabId: string; orderId?: string; copyFromId?: string; active: boolean; setCmds: (c: Cmd[]) => void; onDone: (savedId?: string) => void
}) {
  const app = useApp()
  const { refresh } = useOrders()
  const clientsRes = useApi(() => clientsApi.list())
  const typesRes = useApi(() => productTypesApi.list())
  const recipesRes = useApi(() => recipesApi.list())
  const packRes = useApi(() => packagingApi.list())
  const orderRes = useApi(() => (orderId || copyFromId ? clientOrdersApi.byId((orderId || copyFromId)!) : Promise.resolve(null)), [orderId, copyFromId])
  const zrodlo = orderRes.data as ClientOrder | null
  // Kopia: źródło tylko do zasiania formularza — zapis tworzy NOWE zamówienie.
  const existing = orderId ? zrodlo : null

  const s = useMemo(() => ({
    productTypes: ((typesRes.data ?? []) as Array<{ id: string; name: string; active?: boolean }>).filter(t => t.active !== false),
    recipes: ((recipesRes.data ?? []) as Array<{ id: string; name: string; productTypeId?: string; productTypeName?: string; active?: boolean }>).filter(r => r.active !== false),
    packaging: ((packRes.data ?? []) as Array<{ id: string; name: string; type?: string }>),
  }), [typesRes.data, recipesRes.data, packRes.data])
  const clients = useMemo(() => ((clientsRes.data ?? []) as Array<{ id: string; name: string; displayName?: string; city?: string; active?: boolean }>)
    .filter(c => c.active !== false).sort((a, b) => (a.displayName || a.name).localeCompare(b.displayName || b.name, 'pl')), [clientsRes.data])

  const [f, setF] = useState<FormZam>(() => nowyFormularz(dzisIso()))
  const [tried, setTried] = useState(false)
  const [saving, setSaving] = useState(false)
  const [blad, setBlad] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [discardAsk, setDiscardAsk] = useState(false)
  const seeded = useRef(false)
  const lock = useRef(false)

  // Edycja: zasiewamy formularz RAZ (jak stary edytor) — odświeżenie danych nie może skasować poprawek.
  useEffect(() => {
    if (!(orderId || copyFromId) || seeded.current || !zrodlo || !packRes.data) return
    seeded.current = true
    const nazwa = new Map(s.packaging.map(p => [p.id, p.name]))
    const z = zZamowienia(zrodlo, id => nazwa.get(id))
    // Kopia: bez id pozycji (to nowe pozycje), dzisiejsza data, bez terminu.
    setF(copyFromId ? { ...z, orderDate: dzisIso(), deliveryDate: '', lines: z.lines.map(l => ({ ...l, id: '' })) } : z)
    if (copyFromId) setDirty(true)
  }, [orderId, copyFromId, zrodlo, packRes.data, s.packaging])

  const editing = !!orderId
  const blokada = editing && existing && existing.status !== 'draft' && existing.status !== 'confirmed'
    ? 'Edytować można tylko zamówienie w statusie Szkic lub Potwierdzone.' : null
  const loadError = clientsRes.error || typesRes.error || recipesRes.error || packRes.error || orderRes.error
  const ready = !!clientsRes.data && !!typesRes.data && !!recipesRes.data && !!packRes.data && (!(orderId || copyFromId) || seeded.current)

  const upd = (patch: Partial<FormZam>) => { setF(x => ({ ...x, ...patch })); setDirty(true) }
  const setLine = (i: number, patch: Partial<LineForm>) => { setF(x => ({ ...x, lines: x.lines.map((l, j) => j === i ? { ...l, ...patch } : l) })); setDirty(true) }
  const addLine = useCallback(() => {
    setF(x => ({ ...x, lines: [...x.lines, kolejnaPozycja([...x.lines].reverse().find(l => !pustyWiersz(l)))] }))
    const idx = f.lines.length
    requestAnimationFrame(() => document.getElementById(`${tabId}-q-${idx}`)?.focus())
  }, [f.lines.length, tabId])
  const [usunIdx, setUsunIdx] = useState<number | null>(null)
  const removeLine = (i: number) => { setF(x => ({ ...x, lines: x.lines.length > 1 ? x.lines.filter((_, j) => j !== i) : [kolejnaPozycja()] })); setDirty(true); setUsunIdx(null) }

  const errors = tried ? walidacja(f) : {}
  const errCount = Object.keys(errors).length
  const t = sumy(f)

  const save = useCallback(async (potwierdz: boolean) => {
    if (lock.current || !ready || blokada) return
    setTried(true)
    if (Object.keys(walidacja(f)).length) return
    lock.current = true; setSaving(true); setBlad(null)
    try {
      const dto = doDto(f, s)
      const zapisane = editing && orderId ? await clientOrdersApi.update(orderId, dto) : await clientOrdersApi.create(dto)
      if (potwierdz && zapisane.status === 'draft') await clientOrdersApi.updateStatus(zapisane.id, 'confirmed')
      await refresh()
      app.toast({ kind: 'ok', title: `${editing ? 'Zapisano' : 'Utworzono'} ${zapisane.orderNo}`, detail: `${t.n} poz. · ${fmtNum(t.szt)} szt. · ${kg(t.kg)}${potwierdz ? ' · potwierdzone' : !editing ? ' · szkic' : ''}` })
      setDirty(false)
      onDone(zapisane.id)
    } catch (e) {
      // Odmowa serwera jego słowami (np. zamówienie z wystawionym WM, pozycja ruszona).
      setBlad(e instanceof Error ? e.message : 'Nie udało się zapisać zamówienia')
    } finally {
      lock.current = false; setSaving(false)
    }
  }, [ready, blokada, f, s, editing, orderId, refresh, app, t.n, t.szt, t.kg, onDone])

  const saveRef = useRef(save); saveRef.current = save
  const close = useCallback(() => { if (dirty) setDiscardAsk(true); else onDone() }, [dirty, onDone])
  const cmds = useMemo<Cmd[]>(() => [
    ...(!editing || existing?.status === 'draft' ? [{ id: 'save-confirm', group: 1, label: editing ? 'Zapisz i potwierdź' : 'Zapisz i potwierdź', icon: <CheckCheck size={17} />, primary: true, disabled: saving || !!blokada, run: () => saveRef.current(true) }] : []),
    { id: 'save', group: 1, label: editing ? 'Zapisz zmiany' : 'Zapisz szkic', icon: <Save size={17} />, kbd: 'Ctrl+Enter', primary: editing && existing?.status !== 'draft', disabled: saving || !!blokada, run: () => saveRef.current(false) },
    { id: 'add-line', group: 2, label: 'Dodaj pozycję', icon: <Plus size={17} />, disabled: !!blokada, run: () => addLine() },
    { id: 'discard', group: 3, label: editing ? 'Zamknij bez zapisu' : 'Odrzuć', icon: <X size={17} />, run: close },
  ], [editing, existing?.status, saving, blokada, addLine, close])
  useEffect(() => { setCmds(cmds) }, [cmds, setCmds])
  useEffect(() => {
    if (!active) return
    const key = (e: KeyboardEvent) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void saveRef.current(false) } }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [active])

  const klient = clients.find(c => c.id === f.clientId)
  const title = editing ? `Edycja ${existing?.orderNo ?? ''}` : copyFromId ? `Nowe — kopia ${zrodlo?.orderNo ?? ''}` : 'Nowe zamówienie'

  return (
    <>
      <CommandBar title={title} count={editing ? (dirty ? 'niezapisane zmiany' : 'bez zmian') : 'numer nada serwer przy zapisie'} cmds={cmds} />
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <div className="dock-pad" style={{ maxWidth: 1320 }}>
          {loadError && <div className="note crit" role="alert"><FlagIcon level="crit" size={15} /><div>Nie udało się pobrać danych: {loadError}</div></div>}
          {!ready && !loadError && <SzkieletBloku linie={6} opis="Pobieranie kartotek…" />}
          {blokada && <div className="note warn" role="alert"><FlagIcon level="warn" size={15} /><div>{blokada}</div></div>}
          {blad && <div className="note crit" role="alert"><FlagIcon level="crit" size={15} /><div><b>Serwer odmówił zapisu:</b> {blad}</div></div>}
          {errCount > 0 && <div className="note crit" role="alert"><FlagIcon level="crit" size={15} /><div><b>Popraw {errCount} {errCount === 1 ? 'pole' : errCount < 5 ? 'pola' : 'pól'}.</b> Błędne pola są oznaczone na czerwono.</div></div>}

          <div className="ov-grid" style={{ gridTemplateColumns: 'minmax(0, 1.3fr) minmax(0, 1fr)' }}>
            <div className="box ov-card">
              <h4>Klient i termin</h4>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 12px' }}>
                <label style={{ gridColumn: '1 / -1', display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span className="label">Klient</span>
                  <select id={`${tabId}-client`} className={`field${errors.client ? ' invalid' : ''}`} value={f.clientId} onChange={e => upd({ clientId: e.target.value })} autoFocus={!editing} disabled={!!blokada} aria-invalid={!!errors.client}>
                    <option value="">Wybierz klienta…</option>
                    {clients.map(c => <option key={c.id} value={c.id}>{c.displayName || c.name}{c.city ? ` — ${c.city}` : ''}</option>)}
                  </select>
                  {errors.client && <span className="crit-ink" style={{ fontSize: 'var(--fs-sm)' }}>{errors.client}</span>}
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span className="label">Data zamówienia</span>
                  <input type="date" className={`field${errors.orderDate ? ' invalid' : ''}`} value={f.orderDate} onChange={e => upd({ orderDate: e.target.value })} disabled={!!blokada} />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span className="label">Termin wyjazdu</span>
                  <input type="date" className={`field${errors.deliveryDate ? ' invalid' : ''}`} value={f.deliveryDate} min={f.orderDate} onChange={e => upd({ deliveryDate: e.target.value })} disabled={!!blokada} />
                </label>
                {errors.deliveryDate && <span className="crit-ink" style={{ gridColumn: '1 / -1', fontSize: 'var(--fs-sm)', marginTop: -4 }}>{errors.deliveryDate}</span>}
                <label style={{ gridColumn: '1 / -1', display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span className="label">Uwagi</span>
                  <textarea className="field" style={{ height: 56, padding: '7px 10px', resize: 'vertical' }} value={f.notes} onChange={e => upd({ notes: e.target.value })} disabled={!!blokada} placeholder="np. awizacja, etykiety w języku klienta" />
                </label>
              </div>
            </div>
            <div className="box ov-card">
              <h4>Podsumowanie</h4>
              <p className="muted" style={{ margin: 0 }}>{klient ? <><b style={{ color: 'var(--ink-1)' }}>{klient.displayName || klient.name}</b>{klient.displayName && klient.displayName !== klient.name ? ` · ${klient.name}` : ''}</> : 'Wybierz klienta.'}</p>
              <div className="req-sum" style={{ borderTop: '1px solid var(--line-soft)', paddingTop: 10 }}>
                <div className="f"><span className="k">Pozycje</span><span className="v">{t.n}</span></div>
                <div className="f"><span className="k">Sztuki</span><span className="v">{fmtNum(t.szt)}</span></div>
                <div className="f"><span className="k">Masa</span><span className="v">{kg(t.kg)}</span></div>
              </div>
              {existing && <p className="muted" style={{ fontSize: 'var(--fs-sm)', margin: 0 }}>Status: {existing.status === 'draft' ? 'szkic' : existing.status === 'confirmed' ? 'potwierdzone' : existing.status}. Pozycje zachowują swoje id — rozpis palet zostaje.</p>}
            </div>
          </div>

          <div className="sect-h"><h3>Pozycje</h3><span className="sub">Tab — następne pole · Enter w ilości ostatniej pozycji — nowa pozycja · Ctrl+Enter — zapisz</span>
            <div className="tools"><button className="btn sm" onClick={addLine} disabled={!!blokada}><Plus size={15} />Dodaj pozycję</button></div></div>
          <div className="box">
            <table className="tbl editor-tbl">
              <thead><tr><th className="num" style={{ width: 40 }}>Lp.</th><th>Rodzaj</th><th>Receptura</th><th>Tuleja / opakowanie</th><th className="num">Gramatura</th><th className="num">Ilość</th><th className="num">Masa</th><th className="hide-m">Uwagi</th><th style={{ width: 40 }} /></tr></thead>
              <tbody>
                {f.lines.map((l, i) => {
                  const rec = filterRecipesFor(s.recipes, l)
                  const errs = [errors[`p${i}`], errors[`r${i}`], errors[`k${i}`], errors[`q${i}`]].filter(Boolean)
                  const pusty = pustyWiersz(l)
                  return (
                    <React.Fragment key={i}>
                      <tr className={`row editing${pusty ? ' empty-row' : ''}`}>
                        <td className="num muted">{pusty ? '' : f.lines.slice(0, i + 1).filter(x => !pustyWiersz(x)).length}</td>
                        <td><select className={`field${errors[`p${i}`] ? ' invalid' : ''}`} value={l.productTypeId} disabled={!!blokada} aria-label={`Rodzaj, pozycja ${i + 1}`}
                          onChange={e => { const v = e.target.value; const r = s.recipes.find(x => x.id === l.recipeId); setLine(i, { productTypeId: v, recipeId: r && (!r.productTypeId || r.productTypeId === v) ? l.recipeId : '' }) }}>
                          <option value="">—</option>{s.productTypes.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></td>
                        <td><select className={`field${errors[`r${i}`] ? ' invalid' : ''}`} value={l.recipeId} disabled={!!blokada} aria-label={`Receptura, pozycja ${i + 1}`} onChange={e => setLine(i, { recipeId: e.target.value })}>
                          <option value="">—</option>{rec.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></td>
                        <td><select className="field" value={l.packagingId} disabled={!!blokada} aria-label={`Tuleja, pozycja ${i + 1}`} onChange={e => setLine(i, { packagingId: e.target.value })}>
                          <option value="">(bez)</option>{s.packaging.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></td>
                        <td className="num"><input className={`field num w-num${errors[`k${i}`] ? ' invalid' : ''}`} inputMode="decimal" value={l.kgPerUnit} disabled={!!blokada} aria-label={`Gramatura kg, pozycja ${i + 1}`} onChange={e => setLine(i, { kgPerUnit: e.target.value })} /> <span className="sub">kg</span></td>
                        <td className="num"><input id={`${tabId}-q-${i}`} className={`field num w-num${errors[`q${i}`] ? ' invalid' : ''}`} inputMode="numeric" placeholder="0" value={l.qty} disabled={!!blokada} aria-label={`Ilość sztuk, pozycja ${i + 1}`}
                          onChange={e => setLine(i, { qty: e.target.value })}
                          onKeyDown={e => { if (e.key === 'Enter' && !e.ctrlKey && i === f.lines.length - 1) { e.preventDefault(); if (!pusty) addLine() } }} /> <span className="sub">szt.</span></td>
                        <td className="num">{num(l.qty) > 0 && num(l.kgPerUnit) > 0 ? kg(num(l.qty) * num(l.kgPerUnit)) : <span className="faint">—</span>}</td>
                        <td className="hide-m"><input className="field" value={l.notes} disabled={!!blokada} aria-label={`Uwagi, pozycja ${i + 1}`} onChange={e => setLine(i, { notes: e.target.value })} /></td>
                        <td><button className="btn ghost icon sm" style={{ width: 28 }} disabled={!!blokada} onClick={() => (l.id ? setUsunIdx(i) : removeLine(i))} aria-label={`Usuń pozycję ${i + 1}`}><Trash2 size={15} /></button></td>
                      </tr>
                      {errs.length > 0 && <tr className="err-row"><td /><td colSpan={8}><span className="crit-ink" style={{ fontSize: 'var(--fs-sm)' }}>{errs.join(' ')}</span></td></tr>}
                    </React.Fragment>
                  )
                })}
              </tbody>
              <tfoot><tr><td /><td colSpan={4}>Razem — {t.n} poz.</td><td className="num">{fmtNum(t.szt)} <span className="sub">szt.</span></td><td className="num">{kg(t.kg)}</td><td className="hide-m" /><td /></tr></tfoot>
            </table>
          </div>
          {errors.lines && <div className="note crit"><FlagIcon level="crit" size={15} /><div>{errors.lines}</div></div>}
          {PROBA && <div className="note info"><FlagIcon level="info" size={15} /><div>Zapis idzie na serwer — do KOPII bazy w wersji próbnej. Nowe zamówienie powstaje jako szkic; „Zapisz i potwierdź” od razu je potwierdza.</div></div>}
        </div>
      </div>

      {usunIdx !== null && <Dialog title="Usunąć pozycję?" onClose={() => setUsunIdx(null)}
        footer={<><button className="btn" onClick={() => setUsunIdx(null)} data-autofocus>Wróć</button><button className="btn primary" style={{ background: 'var(--crit)', borderColor: 'var(--crit)' }} onClick={() => removeLine(usunIdx)}>Usuń pozycję</button></>}>
        <p>Pozycja zniknie z zamówienia przy zapisie. Palety rozpisane na tę pozycję stracą ją z rozpisu.</p>
        {ostrzezenieUsuniecia(existing, f.lines[usunIdx]?.id) && <div className="note warn"><FlagIcon level="warn" size={15} /><div>{ostrzezenieUsuniecia(existing, f.lines[usunIdx]?.id)}</div></div>}
      </Dialog>}
      {discardAsk && <Dialog title="Zamknąć bez zapisu?" onClose={() => setDiscardAsk(false)}
        footer={<><button className="btn" onClick={() => setDiscardAsk(false)} data-autofocus>Wróć do edycji</button><button className="btn primary" style={{ background: 'var(--crit)', borderColor: 'var(--crit)' }} onClick={() => { setDiscardAsk(false); onDone() }}>Odrzuć zmiany</button></>}>
        <p>Niezapisane zmiany przepadną.</p>
      </Dialog>}
    </>
  )
}
