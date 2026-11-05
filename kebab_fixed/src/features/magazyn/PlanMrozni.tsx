import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { RotateCw, Search, X } from 'lucide-react'
import { magazynApi, type KartonNaPlanie, type PlanMrozniDane, type MiejsceMrozni } from '@/lib/api'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { HMI_VARS } from '@/features/hmi-theme/vars'
import { ZawartoscMrozni } from './ZawartoscMrozni'
import { KlawiaturaHmi } from './KlawiaturaHmi'
import { locationText, positioned } from './mrozniaSlots'
import { clientLabel, compactCartonNo, findFreezerCartons, freezerTileSummary } from './mrozniaContents'
import { ZnacznikZamowienia, type ZamowienieKolorowe } from './koloryZaladunku'
import './plan-mrozni.css'

export type CelMrozni = Pick<KartonNaPlanie, 'kind' | 'id' | 'cartonNo'>
const key = (c: CelMrozni) => `${c.kind}:${c.id}`
const TITLE = 'Rzut mroźni'
type Editor = { carton: KartonNaPlanie; manual?: never } | { carton?: never; manual: { slot: string; revision: string | null } }
type Panel = 'none' | 'carton' | 'unplaced'

/** Give each tile's recipe only the whole lines that fit beside the client name and
 * tube tags, so nothing is ever cut through the middle of a line. If not even one
 * line is left (long name + two tubes on a small panel), the recipe keeps one line
 * and the tube row is trimmed to whole tags; the detail panel shows everything. */
function fitTiles(grid: HTMLElement) {
  grid.querySelectorAll<HTMLElement>('.mroznia-tile.is-carton').forEach(tile => {
    const recipe = tile.querySelector<HTMLElement>('.mroznia-tile-recipe')
    const tubes = tile.querySelector<HTMLElement>('.mroznia-tile-tubes')
    if (!recipe) return
    recipe.style.removeProperty('-webkit-line-clamp'); recipe.style.removeProperty('max-height')
    tubes?.style.removeProperty('max-height')
    const cs = getComputedStyle(tile)
    const inner = tile.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)
    const gap = parseFloat(cs.rowGap) || 0
    const line = parseFloat(getComputedStyle(recipe).lineHeight) || 15
    let used = 0
    for (const child of Array.from(tile.children) as HTMLElement[]) if (child !== recipe) used += child.offsetHeight + gap
    const lines = Math.floor((inner - used) / line)
    const keep = Math.max(1, Math.min(lines, 3))
    recipe.style.setProperty('-webkit-line-clamp', String(keep))
    recipe.style.setProperty('max-height', `${keep * line}px`)
    if (lines < 1 && tubes) {
      const tag = (tubes.firstElementChild as HTMLElement | null)?.offsetHeight ?? 14
      const room = inner - (used - tubes.offsetHeight - gap) - line - gap
      tubes.style.setProperty('max-height', `${Math.max(0, Math.floor((room + 2) / (tag + 2)) * (tag + 2) - 2)}px`)
    }
  })
}

/** The 1.0.22 window with its fixed named places A–I / 1–7, all 63 always in view.
 * Details float over the plan beside the chosen tile; move and swap use a bar in
 * place of the header, so the plan never shrinks, scrolls or hides a row. */
export function PlanMrozni({ cel, zaladunek, onZamknij, onZapisano, onZmieniono }: {
  cel?: CelMrozni; onZamknij: () => void; onZapisano?: (location: MiejsceMrozni) => void; onZmieniono?: () => void
  zaladunek?: { vehicleName: string; orders: ZamowienieKolorowe[]; online: boolean }
}) {
  const [plan, setPlan] = useState<PlanMrozniDane | null>(null)
  const [blad, setBlad] = useState('')
  const [offline, setOffline] = useState(false)
  const [szukaj, setSzukaj] = useState('')
  const [wybrany, setWybrany] = useState(cel ? key(cel) : '')
  const [panel, setPanel] = useState<Panel>('none')
  const [editor, setEditor] = useState<Editor | null>(null)
  const [slot, setSlot] = useState<string | null>(null)
  const [rotation, setRotation] = useState<0 | 90>(0)
  const [opis, setOpis] = useState('')
  const [zapis, setZapis] = useState(false)
  const [zwolnienie, setZwolnienie] = useState(false)
  const [komunikat, setKomunikat] = useState('')
  const [keyboard, setKeyboard] = useState<'search' | 'description' | null>(null)
  const [swapFrom, setSwapFrom] = useState<KartonNaPlanie | null>(null)
  const [swapTo, setSwapTo] = useState<KartonNaPlanie | null>(null)
  const [orderFilter, setOrderFilter] = useState('')
  const zajety = useRef(false)
  const poczatek = useRef(false)
  const request = useRef(0)
  const mapTiles = useRef(new Map<string, HTMLButtonElement>())
  const gridRef = useRef<HTMLDivElement>(null)
  // Re-fit after every render (data refresh) and whenever the window changes size.
  useLayoutEffect(() => { if (gridRef.current) fitTiles(gridRef.current) })
  useEffect(() => {
    const grid = gridRef.current
    if (!grid || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => fitTiles(grid))
    ro.observe(grid)
    return () => ro.disconnect()
  }, [plan === null])

  const odswiez = useCallback(async () => {
    const n = ++request.current
    try {
      const p = await magazynApi.mrozniaPlan()
      if (n !== request.current) return null
      setPlan(p); setOffline(false)
      return p
    } catch {
      if (n === request.current) setOffline(true)
      return null
    }
  }, [])
  useEffect(() => {
    void odswiez()
    const timer = setInterval(() => { if (!zajety.current) void odswiez() }, 5000)
    return () => { clearInterval(timer); request.current++ }
  }, [odswiez])
  useEffect(() => {
    if (!komunikat) return
    const t = setTimeout(() => setKomunikat(''), 5000)
    return () => clearTimeout(t)
  }, [komunikat])

  function clearMessages() { setBlad(''); setKomunikat('') }
  function edytuj(c: KartonNaPlanie) {
    setEditor({ carton: c }); setWybrany(key(c)); setPanel('none'); setZwolnienie(false); clearMessages()
    // A leftover coordinate address from rolled-back 1.0.23 is not a place: pick one anew.
    setSlot(positioned(c.location) ? c.location.slot : null); setRotation(c.location?.rotation ?? 0)
  }
  useEffect(() => {
    if (!cel || !plan || poczatek.current) return
    poczatek.current = true
    const c = plan.cartons.find(c => key(c) === key(cel))
    if (c) edytuj(c)
    else setBlad('Kartonu nie ma już w mroźni. Zamknij mapę i odśwież listę.')
  }, [cel, plan])

  const blocked = plan?.blocked ?? []
  const selected = plan?.cartons.find(c => key(c) === wybrany)
  const loadingOrders = new Map(zaladunek?.orders.map(o => [o.id, o]))
  const legacyMembership = new Map<string, ZamowienieKolorowe>(zaladunek?.orders.flatMap(o => o.pallets.map(p =>
    [`${p.scanCode?.startsWith('SCARTON|') ? 'stock' : 'order'}:${p.id}`, o] as const)))
  // IDs, never customer names or order-number substrings. Explicit null = unassigned.
  const loadingOrder = (c: KartonNaPlanie) => c.orderId === undefined ? legacyMembership.get(key(c)) : loadingOrders.get(c.orderId ?? '')
  const activeOrder = loadingOrders.has(orderFilter) ? orderFilter : ''
  const inOrder = (c: KartonNaPlanie) => !activeOrder || loadingOrder(c)?.id === activeOrder
  const candidates = (plan?.cartons ?? []).filter(inOrder)
  const needle = szukaj.trim()
  const results = findFreezerCartons(candidates, szukaj).sort((a, b) => Number(!!loadingOrder(b)) - Number(!!loadingOrder(a)))
  const matchingKeys = new Set(results.map(key))
  const matches = (c: KartonNaPlanie) => matchingKeys.has(key(c))
  const highlight = (c: KartonNaPlanie) => !editor && (swapFrom ? key(c) === key(swapFrom) : needle ? matches(c) : key(c) === wybrany && panel === 'carton')
  const unplaced = (needle ? results : candidates).filter(c => !positioned(c.location))
  const bezMiejsca = plan?.cartons.filter(c => !positioned(c.location)) ?? []
  const occupied = (plan?.cartons.length ?? 0) - bezMiejsca.length + blocked.length
  const disabled = zapis || offline || !plan
  const occupiedByOther = !!slot && (blocked.some(b => b.slot === slot && b.slot !== editor?.manual?.slot)
    || !!plan?.cartons.some(c => c.location?.slot === slot && (!editor?.carton || key(c) !== key(editor.carton))))
  const problem = !slot ? 'Dotknij wolnego kafelka miejsca.' : occupiedByOther ? 'Miejsce jest już zajęte. Wybierz inne.' : ''
  const swapChanged = [swapFrom, swapTo].some(c => c && plan?.cartons.find(p => key(p) === key(c))?.location?.revision !== c.location?.revision)
  const picking = !!editor?.carton

  // The floating panel goes to the side away from the tile it describes.
  const anchor = editor?.manual?.slot ?? (panel === 'carton' && positioned(selected?.location) ? selected!.location!.slot : null)
  const sheetSide = anchor && (plan?.columns.indexOf(anchor[0]) ?? 0) >= 5 ? 'left' : 'right'

  function pokaz(c: KartonNaPlanie) {
    const id = key(c)
    if (swapFrom) {
      if (id !== key(swapFrom) && positioned(c.location)) setSwapTo(c)
      return
    }
    setWybrany(id); setPanel('carton'); setZwolnienie(false)
    // Scroll only on an operator action, never on the five-second refresh (narrow screens only).
    requestAnimationFrame(() => mapTiles.current.get(id)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }))
  }
  function zamknijPanel() {
    setPanel('none'); setWybrany('')
    if (editor?.manual) { setEditor(null); setSlot(null); setZwolnienie(false) }
  }
  function search(value: string) {
    setSzukaj(value); setWybrany(''); setPanel('none')
    if (swapFrom) setSwapTo(null)
    const found = findFreezerCartons(candidates, value)
    if (value.trim() && found.length === 1) pokaz(found[0])
  }
  function beginSwap(c: KartonNaPlanie) {
    if (!positioned(c.location) || disabled) return
    setSwapFrom(c); setSwapTo(null); setEditor(null); setSlot(null); setSzukaj(''); setPanel('none')
    setWybrany(key(c)); clearMessages()
  }
  async function saveSwap() {
    if (!swapFrom?.location || !swapTo?.location || disabled || swapChanged || zajety.current) return
    zajety.current = true; setZapis(true); clearMessages(); request.current++
    try {
      await magazynApi.mrozniaZamiana({
        first: { kind: swapFrom.kind, container_id: swapFrom.id, expected_revision: swapFrom.location.revision },
        second: { kind: swapTo.kind, container_id: swapTo.id, expected_revision: swapTo.location.revision },
      })
      setKomunikat(`Zamieniono miejscami kartony ${swapFrom.cartonNo} i ${swapTo.cartonNo}.`)
      onZmieniono?.()
    } catch (e) {
      setBlad(e instanceof Error ? e.message : 'Nie potwierdzono zamiany. Sprawdź aktualny plan przed kolejną operacją.')
    } finally {
      // No retry: repeating a swap could undo the physical arrangement.
      setSwapFrom(null); setSwapTo(null); setWybrany(''); await odswiez(); zajety.current = false; setZapis(false)
    }
  }
  function recznie(place: string) {
    const b = blocked.find(b => b.slot === place)
    setEditor({ manual: { slot: place, revision: b?.revision ?? null } })
    setWybrany(''); setPanel('none'); setOpis(b?.description ?? ''); setSlot(place); setZwolnienie(false); clearMessages()
  }
  function anulujEdycje() { setEditor(null); setSlot(null); setZwolnienie(false) }

  async function zapisz(zwolnij = false) {
    if (!editor || disabled || zajety.current || (!zwolnij && (!slot || problem))) return
    if (zwolnij && !editor.manual?.revision) return
    zajety.current = true; setZapis(true); clearMessages(); request.current++
    try {
      if (editor.carton && slot) {
        const location = await magazynApi.mrozniaLokalizacja({ kind: editor.carton.kind, container_id: editor.carton.id,
          slot, rotation, expected_revision: editor.carton.location?.revision ?? null })
        onZapisano?.(location); onZmieniono?.(); onZamknij()
      } else if (editor.manual) {
        if (zwolnij) await magazynApi.mrozniaZwolnij({ slot: editor.manual.slot, expected_revision: editor.manual.revision! })
        else await magazynApi.mrozniaZajete({ slot: editor.manual.slot, description: opis, expected_revision: editor.manual.revision })
        setKomunikat(zwolnij ? `Zwolniono miejsce ${editor.manual.slot}.` : `Zapisano towar na miejscu ${editor.manual.slot}.`)
        anulujEdycje(); onZmieniono?.(); await odswiez()
      }
    } catch (e) {
      setBlad(e instanceof Error ? e.message : 'Nie zapisano miejsca. Odczytaj plan i spróbuj ponownie.')
      await odswiez()
      // Never silently adopt a new revision after conflict; select the item again.
      anulujEdycje()
    } finally { zajety.current = false; setZapis(false) }
  }

  const header = picking && editor?.carton ? <div className="mroznia-modebar" role="region" aria-label="Wybór miejsca kartonu">
    <DialogTitle className="sr-only">{TITLE} · 63 stałe miejsca</DialogTitle>
    <DialogDescription className="sr-only">Dotknij wolnego kafelka, aby wskazać miejsce kartonu.</DialogDescription>
    <div className="mroznia-mode-text">
      <b>{positioned(editor.carton.location) ? 'Przenieś' : 'Wskaż miejsce'} · karton {compactCartonNo(editor.carton.cartonNo)} · {clientLabel(editor.carton)}</b>
      <span aria-live="polite">Wybrane miejsce: {slot || 'dotknij wolnego kafelka'} · <span>{rotation === 0 ? 'Dłuższym bokiem od drzwi' : 'Krótszym bokiem od drzwi'}</span></span>
      <span role={occupiedByOther ? 'alert' : undefined} className={occupiedByOther ? 'mroznia-mode-problem' : 'mroznia-mode-note'}>
        {occupiedByOther ? problem : cel ? 'Zamknięcie mapy nie cofa wjazdu ani ważenia.' : 'Zapisz zgodnie z faktycznym ustawieniem towaru.'}</span>
    </div>
    <button type="button" disabled={disabled} onClick={() => setRotation(r => r === 0 ? 90 : 0)} className="mroznia-btn">
      <RotateCw size={20} aria-hidden /> Obróć o 90°</button>
    <button type="button" disabled={zapis} onClick={anulujEdycje} className="mroznia-btn">Anuluj zmianę</button>
    <button type="button" disabled={disabled || !!problem} onClick={() => void zapisz()} className="mroznia-btn mroznia-btn-primary">
      {zapis ? 'Zapisuję…' : 'Zapisz miejsce'}</button>
    <button type="button" disabled={zapis} onClick={onZamknij} className="mroznia-icon-btn mroznia-icon-btn-bordered" aria-label="Zamknij mapę"><X size={22} aria-hidden /></button>
  </div> : swapFrom ? <div className="mroznia-modebar mroznia-modebar-swap" role="region" aria-label="Podgląd zamiany">
    <DialogTitle className="sr-only">{TITLE} · 63 stałe miejsca</DialogTitle>
    <DialogDescription className="sr-only">Dotknij drugiego kartonu, aby zamienić je miejscami.</DialogDescription>
    <div className="mroznia-mode-text">
      <b>Zamiana miejsc dwóch kartonów</b>
      <span>{swapFrom.cartonNo} · {clientLabel(swapFrom)} → {swapTo ? locationText(swapTo.location) : 'dotknij drugiego kartonu na mapie'}</span>
      {swapTo ? <span>{swapTo.cartonNo} · {clientLabel(swapTo)} → {locationText(swapFrom.location)}</span> : null}
      {swapChanged ? <span role="alert" className="mroznia-mode-problem">Położenie zmieniło się na innym stanowisku. Anuluj i wybierz parę ponownie.</span> : null}
    </div>
    <button type="button" disabled={zapis} onClick={() => { setSwapFrom(null); setSwapTo(null); setWybrany('') }} className="mroznia-btn">Anuluj zamianę</button>
    <button type="button" disabled={disabled || !swapTo || swapChanged} onClick={() => void saveSwap()} className="mroznia-btn mroznia-btn-primary">
      {zapis ? 'Zapisuję…' : 'Zapisz zamianę'}</button>
    <button type="button" disabled={zapis} onClick={onZamknij} className="mroznia-icon-btn mroznia-icon-btn-bordered" aria-label="Zamknij mapę"><X size={22} aria-hidden /></button>
  </div> : <div className="mroznia-header">
    <div className="mroznia-title">
      <DialogTitle className="mroznia-title-main">{TITLE} <span>· 63 stałe miejsca</span></DialogTitle>
      <DialogDescription className="mroznia-title-sub">
        {plan ? `Zajęte ${occupied}/63 · wolne ${63 - occupied} · rząd 1 przy drzwiach` : 'A–I / 1–7 · rząd 1 przy drzwiach'}
      </DialogDescription>
    </div>
    <div className="mroznia-search-wrap">
      <button type="button" disabled={zapis || !plan} className={`mroznia-search ${needle ? 'has-query' : ''}`} onClick={() => setKeyboard('search')}
        aria-label={`Szukaj kartonu, klienta, receptury lub tulei${needle ? `: ${szukaj}` : ''}`}>
        <Search size={20} aria-hidden className="shrink-0" />
        <span className="mroznia-search-text">{needle ? szukaj : 'Szukaj: karton, klient, receptura, tuleja'}</span>
      </button>
      {needle ? <span role="status" className={`mroznia-search-status ${results.length ? 'is-found' : 'is-empty'}`}>
        {results.length ? `Znaleziono: ${results.length}` : 'Nie znaleziono kartonów'}</span> : null}
    </div>
    {needle ? <button type="button" disabled={zapis} onClick={() => search('')} className="mroznia-btn">Wyczyść filtr</button> : null}
    {unplaced.length ? <button type="button" disabled={zapis} aria-pressed={panel === 'unplaced'} className="mroznia-btn mroznia-btn-warn"
      onClick={() => { setWybrany(''); setPanel(panel === 'unplaced' ? 'none' : 'unplaced') }}>Bez miejsca ({unplaced.length})</button> : null}
    <button type="button" disabled={zapis} onClick={onZamknij} className="mroznia-btn" aria-label="Zamknij mapę">
      <X size={20} aria-hidden /> Zamknij</button>
  </div>

  const sheet = !plan ? null : editor?.manual ? <aside className={`mroznia-sheet mroznia-sheet-${sheetSide}`} aria-label={`Miejsce ${editor.manual.slot}`}>
    <div className="mroznia-sheet-head">
      <div><b className="mroznia-sheet-title">Miejsce {editor.manual.slot}</b>
        <span className="mroznia-sheet-sub">Towar bez skanowania, np. łój wołowy</span></div>
      <button type="button" disabled={zapis} onClick={zamknijPanel} className="mroznia-icon-btn" aria-label="Zamknij panel"><X size={22} aria-hidden /></button>
    </div>
    {zwolnienie ? <div className="mroznia-sheet-body space-y-3">
      <p role="alert" className="font-bold">Towar został fizycznie usunięty z tego miejsca?</p>
      <button type="button" disabled={disabled} onClick={() => void zapisz(true)} className="mroznia-btn mroznia-btn-block mroznia-btn-warn">Tak, zwolnij miejsce</button>
      <button type="button" disabled={zapis} onClick={() => setZwolnienie(false)} className="mroznia-btn mroznia-btn-block">Anuluj zwolnienie</button>
    </div> : <>
      <div className="mroznia-sheet-body space-y-3">
        <button type="button" disabled={disabled} onClick={() => setKeyboard('description')} className="mroznia-input">
          ⌨ {opis || 'Wpisz produkt, np. łój wołowy'}</button>
        {editor.manual.revision ? <button type="button" disabled={disabled} onClick={() => setZwolnienie(true)}
          className="mroznia-btn mroznia-btn-block">Zwolnij miejsce</button> : null}
      </div>
      <div className="mroznia-sheet-actions">
        <button type="button" disabled={zapis} onClick={zamknijPanel} className="mroznia-btn">Anuluj</button>
        <button type="button" disabled={disabled} onClick={() => void zapisz()} className="mroznia-btn mroznia-btn-primary">
          {zapis ? 'Zapisuję…' : 'Zapisz towar'}</button>
      </div>
    </>}
  </aside> : panel === 'carton' && selected && !editor && !swapFrom ? (() => {
    const order = loadingOrder(selected)
    return <aside className={`mroznia-sheet mroznia-sheet-${sheetSide}`} aria-label={`Szczegóły kartonu ${selected.cartonNo}`}
      style={order ? { '--order-fill': order.color.fill, '--order-edge': order.color.edge } as CSSProperties : undefined}>
      <div className="mroznia-sheet-head">
        <div className="min-w-0">
          <b className="mroznia-sheet-title">{clientLabel(selected)}</b>
          {selected.clientShortName && selected.clientName && selected.clientName !== selected.clientShortName
            ? <span className="mroznia-sheet-sub">{selected.clientName}</span> : null}
        </div>
        <button type="button" onClick={zamknijPanel} className="mroznia-icon-btn" aria-label="Zamknij szczegóły"><X size={22} aria-hidden /></button>
      </div>
      <div className="mroznia-sheet-meta">
        <span>Karton <b className="hmi-v10-mono">{selected.cartonNo}</b></span>
        {order ? <span className="flex items-center gap-2"><ZnacznikZamowienia color={order.color} /> {order.orderNo}</span>
          : selected.orderNo ? <span>{selected.orderNo}</span> : null}
        <span className={positioned(selected.location) ? '' : 'mroznia-sheet-warn'}>{locationText(selected.location)}</span>
      </div>
      <div className="mroznia-sheet-body"><ZawartoscMrozni lines={selected.lines} /></div>
      <div className="mroznia-sheet-actions">
        <button type="button" disabled={disabled} onClick={() => edytuj(selected)} className="mroznia-btn mroznia-btn-primary">
          {positioned(selected.location) ? 'Przenieś / obróć' : 'Wskaż miejsce'}</button>
        {positioned(selected.location) ? <button type="button" disabled={disabled} onClick={() => beginSwap(selected)} className="mroznia-btn">Zamień miejscami</button> : null}
      </div>
    </aside>
  })() : panel === 'unplaced' && !editor && !swapFrom ? <aside className="mroznia-sheet mroznia-sheet-right" aria-label="Kartony bez miejsca">
    <div className="mroznia-sheet-head">
      <div><b className="mroznia-sheet-title">Bez przypisanego miejsca</b>
        <span className="mroznia-sheet-sub">Dotknij kartonu, aby wskazać jego miejsce.</span></div>
      <button type="button" onClick={zamknijPanel} className="mroznia-icon-btn" aria-label="Zamknij listę"><X size={22} aria-hidden /></button>
    </div>
    <div className="mroznia-sheet-body space-y-2">
      {unplaced.map(c => <button type="button" key={key(c)} disabled={disabled} onClick={() => pokaz(c)} className="mroznia-list-item">
        <b>{clientLabel(c)}</b><span className="hmi-v10-mono">{compactCartonNo(c.cartonNo)}</span>
        <span className="mroznia-list-sub">{freezerTileSummary(c.lines).recipe}</span>
      </button>)}
    </div>
  </aside> : null

  return <Dialog open onOpenChange={open => { if (!open && !zajety.current) onZamknij() }}>
    <DialogContent style={HMI_VARS} className="mroznia-window flex h-[96dvh] max-h-[920px] w-[96vw] max-w-[1280px] flex-col gap-2 overflow-hidden p-3 [&>button:last-child]:hidden"
      onInteractOutside={e => e.preventDefault()} onEscapeKeyDown={e => { if (zajety.current) e.preventDefault() }}>
      {header}
      {offline ? <div role="alert" className="mroznia-alert">
        Brak aktualnego planu — wybór i zapis zablokowane.
        <button type="button" className="ml-3 min-h-11 font-bold underline" onClick={() => void odswiez()}>Ponów odczyt</button>
      </div> : null}
      {!plan && !offline ? <p role="status" className="p-3">Wczytuję miejsca…</p> : null}
      {zaladunek && !zaladunek.online ? <p role="alert" className="mroznia-alert">Brak aktualnego składu auta — kolory pokazują ostatnio odczytane zamówienia.</p> : null}
      {plan && zaladunek ? <section aria-label="Kolory zamówień do załadunku" className="mroznia-legend">
        <button type="button" disabled={!!editor || !!swapFrom || zapis} aria-pressed={!activeOrder}
          onClick={() => { setOrderFilter(''); search('') }} className="mroznia-chip mroznia-chip-all"
          aria-label={`Wszystkie zamówienia auta (${loadingOrders.size}) · ${zaladunek.vehicleName}`}>
          <b>Wszystkie ({loadingOrders.size})</b><span>{zaladunek.vehicleName}</span>
        </button>
        {zaladunek.orders.map(o => {
          const cartons = plan.cartons.filter(c => loadingOrder(c)?.id === o.id)
          return <button type="button" key={o.id} aria-pressed={activeOrder === o.id} disabled={!!editor || !!swapFrom || zapis}
            onClick={() => { setOrderFilter(activeOrder === o.id ? '' : o.id); search('') }} className="mroznia-chip"
            style={{ '--order-fill': o.color.fill, '--order-edge': o.color.edge } as CSSProperties}>
            <ZnacznikZamowienia color={o.color} />
            <span className="mroznia-chip-text"><b>{o.clientShortName || o.clientName}</b><span>{o.orderNo} · {cartons.length} szt.</span></span>
            <span className="sr-only">W mroźni: {cartons.length} · bez położenia: {cartons.filter(c => !positioned(c.location)).length}</span>
          </button>
        })}
        {!loadingOrders.size ? <span className="mroznia-chip-empty">Dołóż zamówienie do auta, aby oznaczyć jego kartony.</span> : null}
      </section> : null}
      {plan ? <div className="mroznia-stage">
        <div className="mroznia-map" aria-label="Mapa miejsc mroźni">
          <div ref={gridRef} role="group" aria-label="Stałe miejsca mroźni" className={`mroznia-grid ${picking ? 'is-picking' : ''}`}
            style={{ gridTemplateColumns: `repeat(${plan.columns.length}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${plan.rows}, minmax(62px, 1fr))` }}>
            {Array.from({ length: plan.rows }, (_, i) => plan.rows - i).flatMap(row => plan.columns.map(col => {
              const place = `${col}${row}`
              const c = plan.cartons.find(c => c.location?.slot === place)
              const b = blocked.find(b => b.slot === place)
              const own = c && editor?.carton && key(c) === key(editor.carton)
              const active = editor ? slot === place : swapTo ? !!c && key(c) === key(swapTo) : false
              const locked = disabled || (!!editor?.carton && (!!b || (!!c && !own)))
                || (!!editor?.manual && place !== editor.manual.slot) || (!!swapFrom && (!c || key(c) === key(swapFrom)))
              const order = c && loadingOrder(c), color = order?.color
              const summary = c && freezerTileSummary(c.lines)
              const label = c ? clientLabel(c) : ''
              const found = !!c && highlight(c)
              const dimmed = !!c && !editor && ((!!needle && !matches(c)) || (!swapFrom && !inOrder(c)))
              const kind = c ? 'is-carton' : b ? 'is-manual' : 'is-free'
              return <button type="button" key={place} data-slot={place} disabled={!!locked} aria-pressed={active}
                aria-label={`${place} · ${c ? `Karton ${c.cartonNo} · ${label}` : b ? `zajęte · ${b.description}` : 'wolne'}${order ? ` · ${color!.label} · ${order.orderNo}` : ''}`}
                ref={el => { if (c) { if (el) mapTiles.current.set(key(c), el); else mapTiles.current.delete(key(c)) } }}
                data-highlighted={found ? 'true' : 'false'} data-loading-color={color?.index} data-dimmed={dimmed ? 'true' : undefined}
                onClick={() => { if (editor?.carton) setSlot(place); else if (!editor) { if (c) pokaz(c); else recznie(place) } }}
                className={`mroznia-tile ${kind} ${color ? 'is-order' : ''} ${active ? 'is-active' : ''} ${found ? 'mroznia-found' : ''}`}
                style={color ? { '--order-fill': color.fill, '--order-edge': color.edge } as CSSProperties : undefined}>
                <span className="mroznia-tile-top">
                  <b className="mroznia-tile-address">{place}</b>
                  {color ? <b className="mroznia-tile-order">{color.label}</b> : null}
                  {c ? <span className="mroznia-tile-no hmi-v10-mono">{compactCartonNo(c.cartonNo)}</span> : null}
                </span>
                {c && summary ? <>
                  <b className={`mroznia-tile-client ${label.length > 11 || label.split(/\s+/).some(w => w.length > 7) ? 'is-long' : ''}`}>{label}</b>
                  <span className="mroznia-tile-recipe">{summary.recipe}</span>
                  {summary.tubeLabels.length ? <span className="mroznia-tile-tubes">
                    {summary.tubeLabels.map(t => <span key={t} className="mroznia-tube">{t}</span>)}
                  </span> : null}
                </> : b ? <>
                  <b className="mroznia-tile-manual">{b.description}</b>
                  <span className="mroznia-tile-foot">towar ręcznie</span>
                </> : <span className="mroznia-tile-foot">{active ? 'wybrane' : 'wolne'}</span>}
              </button>
            }))}
          </div>
          <div className="mroznia-door"><span aria-hidden>▲</span> Drzwi mroźnicze · wejście ↑</div>
        </div>
        {sheet}
        {blad || komunikat ? <div className="mroznia-toasts">
          {blad ? <p role="alert" className="mroznia-toast mroznia-toast-error">{blad}</p> : null}
          {komunikat ? <p role="status" className="mroznia-toast mroznia-toast-ok">{komunikat}</p> : null}
        </div> : null}
      </div> : blad ? <p role="alert" className="mroznia-alert">{blad}</p> : null}
      {keyboard ? <KlawiaturaHmi label={keyboard === 'search' ? 'Szukaj kartonu' : 'Nazwa produktu'} value={keyboard === 'search' ? szukaj : opis}
        onAccept={keyboard === 'search' ? search : setOpis} onClose={() => setKeyboard(null)} /> : null}
    </DialogContent>
  </Dialog>
}
