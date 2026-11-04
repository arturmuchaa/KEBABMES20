import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Trash2, Save, CheckCheck, X, ChevronDown } from 'lucide-react'
import { useApp, useMenu, Menu, CommandBar, Dialog, type Cmd, type MenuItem } from '../../../shell/context'
import { useOrders } from '../../../data/store'
import { kg, num as fmtNum, weekday, fmtDay, ORDER_STATUS, type OrderStatus } from '../../../data/model'
import { ile } from '../../../data/tekst'
import { FlagIcon } from '../../../ui/Glyphs'
import { useApi } from '@/hooks/useApi'
import { clientOrdersApi, clientsApi, packagingApi, productTypesApi, recipesApi } from '@/lib/api'
import type { ClientOrder } from '@/lib/mockApi'
import type { LineForm } from '@/features/orders/order-form/types'
import { filterRecipesFor } from '@/features/orders/order-form/types'
import { num } from '@/features/orders/order-entry/model'
import { braki, doDto, dzisIso, kolejnaPozycja, najblizszeDni, nowyFormularz, opisTerminu, ostrzezenieUsuniecia, pierwszyBrak, poDniach, pustyWiersz, sumy, walidacja, wierszNastepny, zZamowienia, type FormZam, type PoleWiersza } from './model'
import { SzkieletBloku } from '../../../ui/Szkielet'
import { Wybor } from '../../../ui/Wybor'
import { PasekMasowania } from './PasekMasowania'
import { PROBA } from '../../../proba'

/** Okno dialogowe otwarte w bieżącej karcie albo nad aplikacją — skróty formularza wtedy milczą. */
const oknoOtwarte = () => [...document.querySelectorAll('.dialog-wrap')].some(d => d.getClientRects().length > 0)
/** Szybki wybór terminu: litera w polu daty (D, J, P) = przycisk obok. */
const SZYBKIE: Array<[string, number]> = [['Dziś', 0], ['Jutro', 1], ['Pojutrze', 2]]
const dzienZIso = (iso: string) => new Date(`${iso}T00:00:00`)

/**
 * Nowe zamówienie / edycja zamówienia — karta robocza. Zapis przez
 * clientOrdersApi.create/update (ten sam DTO co stary MES), potem odświeżenie
 * listy z serwera. Ręka nie schodzi z klawiatury: wybór z listy przenosi kursor
 * do następnego pola, Enter w ilości — do następnej pozycji, która ma już rodzaj,
 * recepturę i tuleję z poprzedniej (czeka na gramaturę i ilość).
 * Ctrl+Enter = główne polecenie (jak „Przyjmij dostawę” w przyjęciu): nowe i szkic —
 * „Zapisz i potwierdź”, potwierdzone — „Zapisz zmiany”. Ctrl+S = „Zapisz szkic”.
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
  // Nowe i szkic: „Zapisz i potwierdź” (Ctrl+Enter) + „Zapisz szkic” (Ctrl+S).
  // Potwierdzone: samo „Zapisz zmiany” (Ctrl+Enter) — nie ma czego potwierdzać.
  const doPotwierdzenia = !editing || existing?.status === 'draft'
  const blokada = editing && existing && existing.status !== 'draft' && existing.status !== 'confirmed'
    ? 'Edytować można tylko zamówienie w statusie Szkic lub Potwierdzone.' : null
  const loadError = clientsRes.error || typesRes.error || recipesRes.error || packRes.error || orderRes.error
  const ready = !!clientsRes.data && !!typesRes.data && !!recipesRes.data && !!packRes.data && (!(orderId || copyFromId) || seeded.current)

  const upd = (patch: Partial<FormZam>) => { setF(x => ({ ...x, ...patch })); setDirty(true) }
  // Wpis w wierszu „następna pozycja” (indeks = liczba pozycji) dopisuje go do formularza.
  const setLine = (i: number, patch: Partial<LineForm>) => {
    setF(x => ({ ...x, lines: i < x.lines.length
      ? x.lines.map((l, j) => j === i ? { ...l, ...patch } : l)
      : [...x.lines, { ...kolejnaPozycja(x.lines[x.lines.length - 1]), ...patch }] }))
    setDirty(true)
  }
  const nastepny = blokada ? null : wierszNastepny(f.lines)
  const wiersze = nastepny ? [...f.lines, nastepny] : f.lines
  const fokus = useCallback((id: string) => requestAnimationFrame(() => {
    const el = document.getElementById(id) as HTMLInputElement | null
    el?.focus(); el?.select?.()
  }), [])
  const skocz = useCallback((i: number, pole: PoleWiersza) => fokus(`${tabId}-${pole}-${i}`), [tabId, fokus])
  // Enter w ilości (albo uwagach): brakuje czegoś — wracamy do tego pola; komplet — następna pozycja.
  const poEnter = (i: number) => {
    const brak = pierwszyBrak(wiersze[i])
    if (brak) skocz(i, brak)
    else skocz(i + 1, 'k')
  }
  const addLine = () => {
    if (nastepny) { skocz(f.lines.length, 'k'); return }
    const ost = f.lines.length - 1
    skocz(ost, pierwszyBrak(f.lines[ost]) ?? 'k')
  }
  const addRef = useRef(addLine); addRef.current = addLine
  const [usunIdx, setUsunIdx] = useState<number | null>(null)
  const removeLine = (i: number) => { setF(x => ({ ...x, lines: x.lines.length > 1 ? x.lines.filter((_, j) => j !== i) : [kolejnaPozycja()] })); setDirty(true); setUsunIdx(null) }

  const errors = tried ? walidacja(f) : {}
  const errCount = Object.keys(errors).length
  const t = sumy(f)
  const listaBrakow = useMemo(() => braki(f), [f])
  const czegoBrak = listaBrakow.length
    ? listaBrakow[0].opis + (listaBrakow.length > 1 ? ` (i jeszcze ${ile(listaBrakow.length - 1, 'brak', 'braki', 'braków')})` : '')
    : null
  // Dlaczego zapis jest zablokowany — słowami operatora, w dymku przycisku (jak w przyjęciu surowca).
  const powod = blokada ? 'edytować można tylko szkic albo potwierdzone zamówienie'
    : loadError ? 'nie udało się pobrać kartotek'
    : !ready ? 'wczytywanie kartotek'
    : saving ? 'trwa zapisywanie'
    : czegoBrak

  // Zablokowany „Zapisz” kliknięty (albo skrót przy brakach): pokazujemy błędy i kursor idzie do pierwszego braku.
  const pokazBraki = () => {
    if (blokada || !ready || saving) return
    setTried(true)
    const c = braki(f)[0]?.cel
    if (!c) return
    if ('i' in c) skocz(c.i, c.pole)
    else fokus(`${tabId}-${c.pole === 'client' ? 'client' : c.pole === 'orderDate' ? 'data' : 'termin'}`)
  }
  const pokazRef = useRef(pokazBraki); pokazRef.current = pokazBraki

  const save = useCallback(async (potwierdz: boolean) => {
    if (lock.current || !ready || blokada) return
    if (braki(f).length) { pokazRef.current(); return }
    lock.current = true; setSaving(true); setBlad(null)
    try {
      const dto = doDto(f, s)
      const zapisane = editing && orderId ? await clientOrdersApi.update(orderId, dto) : await clientOrdersApi.create(dto)
      if (potwierdz && zapisane.status === 'draft') await clientOrdersApi.updateStatus(zapisane.id, 'confirmed')
      await refresh()
      const miary = [zapisane.orderNo, `${t.n} poz. · ${fmtNum(t.szt)} szt. · ${kg(t.kg)}`].filter(Boolean).join(' · ')
      // Szkic nie trafia do planowania — ostrzegamy, żeby nie został niepotwierdzony przez przeoczenie.
      const szkic = !potwierdz && (zapisane.status ? zapisane.status === 'draft' : doPotwierdzenia)
      app.toast(szkic
        ? { kind: 'warn', title: 'Zapisano jako szkic — nie trafi do planowania', detail: `${miary}. Potwierdź je w panelu zamówienia.` }
        : { kind: 'ok', title: `${editing ? 'Zapisano' : 'Utworzono'} ${zapisane.orderNo ?? ''}`.trim(), detail: `${t.n} poz. · ${fmtNum(t.szt)} szt. · ${kg(t.kg)}${potwierdz ? ' · potwierdzone' : ''}` })
      setDirty(false)
      onDone(zapisane.id)
    } catch (e) {
      // Odmowa jej własnymi słowami (np. zamówienie z wystawionym WM, pozycja ruszona).
      setBlad(e instanceof Error ? e.message : 'Nie udało się zapisać zamówienia')
    } finally {
      lock.current = false; setSaving(false)
    }
  }, [ready, blokada, f, s, editing, orderId, refresh, app, t.n, t.szt, t.kg, onDone, doPotwierdzenia])

  const saveRef = useRef(save); saveRef.current = save
  const close = useCallback(() => { if (dirty) setDiscardAsk(true); else onDone() }, [dirty, onDone])
  const zablokowane = !!powod
  const cmds = useMemo<Cmd[]>(() => [
    ...(doPotwierdzenia ? [{ id: 'save-confirm', group: 1, label: 'Zapisz i potwierdź', icon: <CheckCheck size={17} />, kbd: 'Ctrl+Enter', primary: true,
      disabled: zablokowane, tip: powod ?? undefined, onDisabledClick: () => pokazRef.current(), run: () => saveRef.current(true) }] : []),
    { id: 'save', group: 1, label: doPotwierdzenia ? 'Zapisz szkic' : 'Zapisz zmiany', icon: <Save size={17} />, kbd: doPotwierdzenia ? 'Ctrl+S' : 'Ctrl+Enter', primary: !doPotwierdzenia,
      disabled: zablokowane, tip: powod ?? undefined, onDisabledClick: () => pokazRef.current(), run: () => saveRef.current(false) },
    { id: 'add-line', group: 2, label: 'Dodaj pozycję', icon: <Plus size={17} />, disabled: !!blokada, tip: blokada ? 'edytować można tylko szkic albo potwierdzone zamówienie' : undefined, run: () => addRef.current() },
    // „Odrzuć” brzmiało jak odmowa klientowi — to tylko zamknięcie karty bez zapisu.
    { id: 'discard', group: 3, label: 'Zamknij bez zapisu', icon: <X size={17} />, run: close },
  ], [doPotwierdzenia, zablokowane, powod, blokada, close])
  useEffect(() => { setCmds(cmds) }, [cmds, setCmds])
  // Skróty: ref, żeby nasłuch nie zależał od formularza (bez przepinania przy każdym znaku).
  const skrotRef = useRef({ glowne: () => {}, szkic: null as null | (() => void) })
  skrotRef.current = { glowne: () => void saveRef.current(doPotwierdzenia), szkic: doPotwierdzenia ? () => void saveRef.current(false) : null }
  useEffect(() => {
    if (!active) return
    const key = (e: KeyboardEvent) => {
      // Alt odpada: Ctrl+Alt to AltGr (ś, ą…) w polskim układzie — pisanie nie może zapisywać.
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return
      const enter = e.key === 'Enter', szkic = !e.shiftKey && e.key.toLowerCase() === 's'
      if (!enter && !szkic) return
      e.preventDefault() // Ctrl+S nie otwiera „Zapisz stronę” przeglądarki
      if (oknoOtwarte()) return
      if (enter) skrotRef.current.glowne()
      else skrotRef.current.szkic?.()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [active])

  const klient = clients.find(c => c.id === f.clientId)
  const klienci = useMemo(() => clients.map(c => ({ id: c.id, label: c.displayName || c.name, sub: [c.displayName && c.displayName !== c.name ? c.name : '', c.city].filter(Boolean).join(' · ') || undefined })), [clients])
  const rodzaje = useMemo(() => s.productTypes.map(p => ({ id: p.id, label: p.name })), [s.productTypes])
  const tuleje = useMemo(() => s.packaging.map(p => ({ id: p.id, label: p.name })), [s.packaging])
  const title = editing ? `Edycja ${existing?.orderNo ?? ''}` : copyFromId ? `Nowe — kopia ${zrodlo?.orderNo ?? ''}` : 'Nowe zamówienie'
  const stan = existing ? `${(ORDER_STATUS[existing.status as OrderStatus] ?? existing.status).toLowerCase()} · ${dirty ? 'niezapisane zmiany' : 'bez zmian'}` : null

  // Termin wyjazdu: trzy najczęstsze jednym kliknięciem, reszta tygodnia z listy dni.
  const dzis = dzisIso()
  const dni = useMemo(() => najblizszeDni(dzis), [dzis])
  const zListy = dni.slice(2).find(d => d.iso === f.deliveryDate)
  const menuDni = useMenu()
  const ustawTermin = (iso: string) => { upd({ deliveryDate: iso }); skocz(0, pierwszyBrak(f.lines[0]) ?? 'p') }
  const dniMenu: MenuItem[] = [{ header: 'Najbliższy dzień tygodnia' },
    ...dni.map(d => ({ label: `${d.dzien} ${d.dzienMies}${d.rel ? ` — ${d.rel}` : ''}`, checked: f.deliveryDate === d.iso, onSelect: () => ustawTermin(d.iso) }))]
  const opisDaty = opisTerminu(f.deliveryDate, dzis)
  const wierszeUwag = f.notes ? f.notes.split('\n').length : 0
  const podpowiedz = blokada ? null : doPotwierdzenia ? 'Ctrl+Enter — zapisz i potwierdź · Ctrl+S — zapisz szkic' : 'Ctrl+Enter — zapisz zmiany'

  return (
    <>
      <CommandBar title={title} showKbd cmds={cmds}
        count={stan ? <span data-tip="Zmienione pozycje zachowują swoje miejsce w rozpisie palet.">{stan}</span> : 'numer zostanie nadany przy zapisie'} />
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <div className="dock-pad">
          {loadError && <div className="note crit" role="alert"><FlagIcon level="crit" size={15} /><div>Nie udało się pobrać danych: {loadError}</div></div>}
          {!ready && !loadError && <SzkieletBloku linie={6} opis="Pobieranie kartotek…" />}
          {blokada && <div className="note warn" role="alert"><FlagIcon level="warn" size={15} /><div>{blokada}</div></div>}
          {blad && <div className="note crit" role="alert"><FlagIcon level="crit" size={15} /><div><b>Nie zapisano zamówienia:</b> {blad}</div></div>}
          {errCount > 0 && <div className="note crit" role="alert"><FlagIcon level="crit" size={15} /><div><b>Popraw {ile(errCount, 'pole', 'pola', 'pól')}.</b> Błędne pola są oznaczone na czerwono.</div></div>}

          {/* Klient i termin w jednym niskim wierszu — pozycje zaczynają się wysoko (laptop 1366 × 768). */}
          <div className="box ed-head">
            <div className="fld ed-klient">
              <label className="label" htmlFor={`${tabId}-client`}>Klient</label>
              <Wybor id={`${tabId}-client`} label="Klient" items={klienci} value={f.clientId} invalid={!!errors.client} disabled={!!blokada}
                placeholder="Wpisz nazwę klienta…" autoFocus={!editing && !copyFromId}
                onChange={v => upd({ clientId: v })} onDalej={() => fokus(`${tabId}-termin`)} />
              {errors.client ? <span className="ed-pomoc crit">{errors.client}</span>
                : klient && <span className="ed-pomoc" data-tip={klient.name}>{[klient.displayName && klient.displayName !== klient.name ? klient.name : '', klient.city].filter(Boolean).join(' · ')}</span>}
            </div>
            <div className="fld ed-termin">
              <label className="label" htmlFor={`${tabId}-termin`}>Termin wyjazdu</label>
              <div className="ed-termin-c">
                <input type="date" id={`${tabId}-termin`} className={`field${errors.deliveryDate ? ' invalid' : ''}`} value={f.deliveryDate} min={f.orderDate} disabled={!!blokada}
                  aria-describedby={`${tabId}-termin-opis`} data-tip="D — dziś · J — jutro · P — pojutrze · Enter — do pozycji"
                  onChange={e => upd({ deliveryDate: e.target.value })}
                  onKeyDown={e => {
                    if (e.ctrlKey || e.metaKey || e.altKey) return
                    if (e.key === 'Enter') { e.preventDefault(); skocz(0, pierwszyBrak(f.lines[0]) ?? 'p'); return }
                    const n = e.key.length === 1 ? 'djp'.indexOf(e.key.toLowerCase()) : -1
                    if (n >= 0) { e.preventDefault(); upd({ deliveryDate: poDniach(dzis, n) }) }
                  }} />
                <div className="seg ed-szybko" role="group" aria-label="Szybki wybór terminu wyjazdu">
                  {SZYBKIE.map(([nazwa, n]) => {
                    const iso = poDniach(dzis, n)
                    return <button key={nazwa} type="button" aria-pressed={f.deliveryDate === iso} disabled={!!blokada}
                      data-tip={`${opisTerminu(iso, dzis)} ${iso.slice(8, 10)}.${iso.slice(5, 7)} · w polu daty klawisz ${nazwa[0]}`}
                      onClick={() => ustawTermin(iso)}>{nazwa}</button>
                  })}
                  <button type="button" aria-haspopup="menu" aria-expanded={!!menuDni.anchor} aria-pressed={!!zListy} disabled={!!blokada}
                    aria-label={zListy ? `Dzień tygodnia: ${zListy.dzien} ${zListy.dzienMies}` : 'Dzień tygodnia'} onClick={menuDni.open}>
                    {zListy ? `${weekday(dzienZIso(zListy.iso))} ${fmtDay(dzienZIso(zListy.iso))}` : 'Dzień tygodnia'}<ChevronDown size={14} aria-hidden />
                  </button>
                </div>
              </div>
              <span id={`${tabId}-termin-opis`} className={`ed-pomoc${errors.deliveryDate ? ' crit' : ''}`}>
                {errors.deliveryDate ?? (opisDaty || 'Bez terminu zamówienie trafi na Pulpicie do grupy „Bez terminu”.')}
              </span>
            </div>
            <div className="fld ed-uwagi">
              <span className="ed-lbl"><label className="label" htmlFor={`${tabId}-uwagi`}>Uwagi</label>{wierszeUwag > 1 && <span className="label faint">· {ile(wierszeUwag, 'wiersz', 'wiersze', 'wierszy')}</span>}</span>
              {/* Jedna linia; po kliknięciu rozwija się nad tabelą, nie przesuwając pozycji. */}
              <div className="ed-uwagi-w">
                <textarea id={`${tabId}-uwagi`} className="field" rows={1} value={f.notes} onChange={e => upd({ notes: e.target.value })} disabled={!!blokada}
                  placeholder="np. awizacja, język etykiet" />
              </div>
            </div>
            <div className="fld ed-data">
              <label className="label" htmlFor={`${tabId}-data`}>Data zamówienia</label>
              <input type="date" id={`${tabId}-data`} className={`field${errors.orderDate ? ' invalid' : ''}`} value={f.orderDate} onChange={e => upd({ orderDate: e.target.value })} disabled={!!blokada} />
              {errors.orderDate && <span className="ed-pomoc crit">{errors.orderDate}</span>}
            </div>
          </div>
          {menuDni.anchor && <Menu anchor={menuDni.anchor} items={dniMenu} onClose={menuDni.close} />}

          <div className="sect-h"><h3>Pozycje</h3><span className="sub"><span className="hide-m">Kilka liter i Enter — wybór i następne pole · </span>Enter w ilości — następna pozycja z tym samym rodzajem, recepturą i tuleją{podpowiedz && ` · ${podpowiedz}`}</span>
            <div className="tools"><button className="btn sm" onClick={addLine} disabled={!!blokada}><Plus size={15} />Dodaj pozycję</button></div></div>
          <div className="box">
            <table className="tbl editor-tbl">
              <thead><tr>
                <th className="num" style={{ width: 44 }}>Lp.</th><th style={{ width: '21%' }}>Rodzaj</th><th style={{ width: '21%' }}>Receptura</th><th style={{ width: '14%' }}>Tuleja / opakowanie</th>
                <th className="num" style={{ width: 120 }}>Gramatura</th><th className="num" style={{ width: 128 }}>Ilość</th><th className="num" style={{ width: 108 }}>Masa</th><th className="hide-m">Uwagi</th><th style={{ width: 44 }} />
              </tr></thead>
              <tbody>
                {wiersze.map((l, i) => {
                  const nowy = i === f.lines.length
                  const rec = filterRecipesFor(s.recipes, l).map(r => ({ id: r.id, label: r.name }))
                  const errs = nowy ? [] : [errors[`p${i}`], errors[`r${i}`], errors[`k${i}`], errors[`q${i}`]].filter(Boolean)
                  const pusty = pustyWiersz(l)
                  const id = (pole: PoleWiersza | 'u') => `${tabId}-${pole}-${i}`
                  return (
                    <React.Fragment key={i}>
                      <tr className={nowy ? 'row next-row' : 'row editing'}>
                        <td className="num muted">{nowy ? <Plus size={14} aria-label="Następna pozycja" /> : pusty ? '' : f.lines.slice(0, i + 1).filter(x => !pustyWiersz(x)).length}</td>
                        <td><Wybor id={id('p')} label={`Rodzaj, pozycja ${i + 1}`} items={rodzaje} value={l.productTypeId} invalid={!!errors[`p${i}`]} disabled={!!blokada} placeholder="Rodzaj…"
                          onChange={v => { const r = s.recipes.find(x => x.id === l.recipeId); setLine(i, { productTypeId: v, recipeId: r && (!r.productTypeId || r.productTypeId === v) ? l.recipeId : '' }) }}
                          onDalej={() => skocz(i, 'r')} /></td>
                        <td><Wybor id={id('r')} label={`Receptura, pozycja ${i + 1}`} items={rec} value={l.recipeId} invalid={!!errors[`r${i}`]} disabled={!!blokada} placeholder="Receptura…"
                          pusto={l.productTypeId ? 'Brak receptur dla tego rodzaju' : 'Najpierw wybierz rodzaj'}
                          onChange={v => setLine(i, { recipeId: v })} onDalej={() => skocz(i, 't')} /></td>
                        <td><Wybor id={id('t')} label={`Tuleja, pozycja ${i + 1}`} items={tuleje} value={l.packagingId} noneLabel="(bez tulei)" disabled={!!blokada}
                          onChange={v => setLine(i, { packagingId: v })} onDalej={() => skocz(i, 'k')} /></td>
                        <td className="num"><input id={id('k')} className={`field num w-num${errors[`k${i}`] ? ' invalid' : ''}`} inputMode="decimal" placeholder="0" value={l.kgPerUnit} disabled={!!blokada} aria-label={`Gramatura kg, pozycja ${i + 1}`}
                          onChange={e => setLine(i, { kgPerUnit: e.target.value })}
                          onKeyDown={e => { if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); skocz(i, 'q') } }} /> <span className="sub">kg</span></td>
                        <td className="num"><input id={id('q')} className={`field num w-num${errors[`q${i}`] ? ' invalid' : ''}`} inputMode="numeric" placeholder="0" value={l.qty} disabled={!!blokada} aria-label={`Ilość sztuk, pozycja ${i + 1}`}
                          onChange={e => setLine(i, { qty: e.target.value })}
                          onKeyDown={e => { if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); poEnter(i) } }} /> <span className="sub">szt.</span></td>
                        <td className="num">{num(l.qty) > 0 && num(l.kgPerUnit) > 0 ? kg(num(l.qty) * num(l.kgPerUnit)) : <span className="faint">—</span>}</td>
                        <td className="hide-m"><input id={id('u')} className="field" value={l.notes} disabled={!!blokada} aria-label={`Uwagi, pozycja ${i + 1}`}
                          onChange={e => setLine(i, { notes: e.target.value })}
                          onKeyDown={e => { if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); poEnter(i) } }} /></td>
                        <td>{!nowy && <button className="btn ghost icon sm" style={{ width: 28 }} disabled={!!blokada} onClick={() => (l.id ? setUsunIdx(i) : removeLine(i))} aria-label={`Usuń pozycję ${i + 1}`}><Trash2 size={15} /></button>}</td>
                      </tr>
                      {/* Kolumna Uwagi znika na laptopie (hide-m) — wiersz błędu musi mieć tyle samo kolumn, inaczej tabela dostaje pustą kolumnę z prawej. */}
                      {errs.length > 0 && <tr className="err-row"><td /><td colSpan={6}><span className="crit-ink" style={{ fontSize: 'var(--fs-sm)' }}>{errs.join(' ')}</span></td><td className="hide-m" /><td /></tr>}
                    </React.Fragment>
                  )
                })}
              </tbody>
              {/* Suma przyklejona do dołu przewijanego obszaru — widać ją przy każdej długości zamówienia. */}
              <tfoot><tr><td /><td colSpan={4}>Razem — {t.n} poz.</td><td className="num">{fmtNum(t.szt)} <span className="sub">szt.</span></td><td className="num">{kg(t.kg)}</td><td className="hide-m" /><td /></tr></tfoot>
            </table>
          </div>
          {errors.lines && <div className="note crit"><FlagIcon level="crit" size={15} /><div>{errors.lines}</div></div>}
          {PROBA && <div className="note info"><FlagIcon level="info" size={15} /><div>W wersji próbnej zapis trafia do KOPII bazy. „Zapisz szkic” zostawia zamówienie poza planowaniem, „Zapisz i potwierdź” od razu je potwierdza.</div></div>}
        </div>
      </div>
      {ready && !blokada && <PasekMasowania lines={f.lines} recipes={s.recipes} />}

      {usunIdx !== null && <Dialog title="Usunąć pozycję?" onClose={() => setUsunIdx(null)}
        footer={<><button className="btn" onClick={() => setUsunIdx(null)} data-autofocus>Wróć</button><button className="btn primary" style={{ background: 'var(--crit)', borderColor: 'var(--crit)' }} onClick={() => removeLine(usunIdx)}>Usuń pozycję</button></>}>
        <p>Pozycja zniknie z zamówienia przy zapisie. Palety rozpisane na tę pozycję stracą ją z rozpisu.</p>
        {ostrzezenieUsuniecia(existing, f.lines[usunIdx]?.id) && <div className="note warn"><FlagIcon level="warn" size={15} /><div>{ostrzezenieUsuniecia(existing, f.lines[usunIdx]?.id)}</div></div>}
      </Dialog>}
      {discardAsk && <Dialog title="Zamknąć bez zapisu?" onClose={() => setDiscardAsk(false)}
        footer={<><button className="btn" onClick={() => setDiscardAsk(false)} data-autofocus>Wróć do edycji</button><button className="btn primary" style={{ background: 'var(--crit)', borderColor: 'var(--crit)' }} onClick={() => { setDiscardAsk(false); onDone() }}>Zamknij bez zapisu</button></>}>
        <p>Niezapisane zmiany przepadną.</p>
      </Dialog>}
    </>
  )
}
