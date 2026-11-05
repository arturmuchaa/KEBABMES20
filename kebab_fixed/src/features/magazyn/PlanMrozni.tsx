import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { RotateCw } from 'lucide-react'
import { magazynApi, type KartonNaPlanie, type PlanMrozniDane, type MiejsceMrozni } from '@/lib/api'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { HMI_VARS } from '@/features/hmi-theme/vars'
import { ZawartoscMrozni } from './ZawartoscMrozni'
import { KlawiaturaHmi } from './KlawiaturaHmi'
import { locationText, positioned } from './mrozniaSlots'
import { compactCartonNo, findFreezerCartons, freezerTileSummary } from './mrozniaContents'
import { ZnacznikZamowienia, type ZamowienieKolorowe } from './koloryZaladunku'
import './plan-mrozni.css'

export type CelMrozni = Pick<KartonNaPlanie, 'kind' | 'id' | 'cartonNo'>
const key = (c: CelMrozni) => `${c.kind}:${c.id}`
const compactNo = compactCartonNo
const buttonStyle = { background: 'var(--panel)', border: '1px solid var(--line)', color: 'var(--ink)' }
type Editor = { carton: KartonNaPlanie; manual?: never } | { carton?: never; manual: { slot: string; revision: string | null } }

/** Ready-made named tiles, in the same order as HMI 1.0.22. No coordinate picking. */
export function PlanMrozni({ cel, zaladunek, onZamknij, onZapisano, onZmieniono }: {
  cel?: CelMrozni; onZamknij: () => void; onZapisano?: (location: MiejsceMrozni) => void; onZmieniono?: () => void
  zaladunek?: { vehicleName: string; orders: ZamowienieKolorowe[]; online: boolean }
}) {
  const [plan, setPlan] = useState<PlanMrozniDane | null>(null)
  const [blad, setBlad] = useState('')
  const [offline, setOffline] = useState(false)
  const [szukaj, setSzukaj] = useState('')
  const [wybrany, setWybrany] = useState(cel ? key(cel) : '')
  const [editor, setEditor] = useState<Editor | null>(null)
  const [slot, setSlot] = useState<string | null>(null)
  const [rotation, setRotation] = useState<0 | 90>(0)
  const [opis, setOpis] = useState('')
  const [zapis, setZapis] = useState(false)
  const [zwolnienie, setZwolnienie] = useState(false)
  const [komunikat, setKomunikat] = useState('')
  const [keyboard, setKeyboard] = useState<'search' | 'description' | null>(null)
  const [details, setDetails] = useState(!!cel)
  const [swapFrom, setSwapFrom] = useState<KartonNaPlanie | null>(null)
  const [swapTo, setSwapTo] = useState<KartonNaPlanie | null>(null)
  const [orderFilter, setOrderFilter] = useState('')
  const zajety = useRef(false)
  const poczatek = useRef(false)
  const request = useRef(0)
  const mapTiles = useRef(new Map<string, HTMLButtonElement>())
  const contentCards = useRef(new Map<string, HTMLElement>())
  const aside = useRef<HTMLElement>(null)

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

  function edytuj(c: KartonNaPlanie) {
    setEditor({ carton: c }); setWybrany(key(c)); setZwolnienie(false); setBlad(''); setKomunikat('')
    // A leftover coordinate address from rolled-back 1.0.23 is not a place: pick one anew.
    setSlot(positioned(c.location) ? c.location.slot : null); setRotation(c.location?.rotation ?? 0); setDetails(true)
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
  const needle = szukaj.trim().toLocaleLowerCase('pl')
  const results = findFreezerCartons(candidates, szukaj).sort((a, b) => Number(!!loadingOrder(b)) - Number(!!loadingOrder(a)))
  const matchingKeys = new Set(results.map(key))
  const matches = (c: KartonNaPlanie) => matchingKeys.has(key(c))
  const highlight = (c: KartonNaPlanie) => !editor && (swapFrom && key(c) === key(swapFrom) || (needle ? matches(c) : key(c) === wybrany))
  const bezMiejsca = plan?.cartons.filter(c => !positioned(c.location)) ?? []
  const disabled = zapis || offline || !plan
  const occupiedByOther = !!slot && (blocked.some(b => b.slot === slot && b.slot !== editor?.manual?.slot)
    || !!plan?.cartons.some(c => c.location?.slot === slot && (!editor?.carton || key(c) !== key(editor.carton))))
  const problem = !slot ? 'Dotknij wolnego kafelka miejsca.' : occupiedByOther ? 'Miejsce jest już zajęte. Wybierz inne.' : ''
  const swapChanged = [swapFrom, swapTo].some(c => c && plan?.cartons.find(p => key(p) === key(c))?.location?.revision !== c.location?.revision)

  function pokaz(c: KartonNaPlanie, from: 'map' | 'card' | 'search') {
    const id = key(c)
    if (swapFrom) {
      if (id === key(swapFrom) || !positioned(c.location)) return
      setSwapTo(c)
    }
    setWybrany(id); setZwolnienie(false); setDetails(true)
    // Scroll only on an operator action, never on the five-second refresh.
    requestAnimationFrame(() => {
      if (from !== 'map') mapTiles.current.get(id)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
      if (swapFrom) aside.current?.scrollTo?.({ top: 0, behavior: 'smooth' })
      else if (from !== 'card') contentCards.current.get(id)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
    })
  }
  function search(value: string) {
    setSzukaj(value); setWybrany('')
    if (swapFrom) setSwapTo(null)
    const found = findFreezerCartons(candidates, value)
    if (value.trim() && found.length === 1) pokaz(found[0], 'search')
  }

  function beginSwap(c: KartonNaPlanie) {
    if (!positioned(c.location) || disabled) return
    setSwapFrom(c); setSwapTo(null); setEditor(null); setSlot(null); setSzukaj(''); setDetails(true)
    setWybrany(key(c)); setBlad(''); setKomunikat('')
    requestAnimationFrame(() => aside.current?.scrollTo?.({ top: 0, behavior: 'smooth' }))
  }

  async function saveSwap() {
    if (!swapFrom?.location || !swapTo?.location || disabled || swapChanged || zajety.current) return
    zajety.current = true; setZapis(true); setBlad(''); setKomunikat(''); request.current++
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
      setSwapFrom(null); setSwapTo(null); await odswiez(); zajety.current = false; setZapis(false)
    }
  }

  function recznie(place: string) {
    const b = blocked.find(b => b.slot === place)
    setEditor({ manual: { slot: place, revision: b?.revision ?? null } })
    setWybrany(''); setOpis(b?.description ?? ''); setSlot(place); setDetails(true)
    setBlad(''); setKomunikat(''); setZwolnienie(false)
  }

  async function zapisz(zwolnij = false) {
    if (!editor || disabled || zajety.current || (!zwolnij && (!slot || problem))) return
    if (zwolnij && !editor.manual?.revision) return
    zajety.current = true; setZapis(true); setBlad(''); setKomunikat(''); request.current++
    try {
      if (editor.carton && slot) {
        const location = await magazynApi.mrozniaLokalizacja({ kind: editor.carton.kind, container_id: editor.carton.id,
          slot, rotation, expected_revision: editor.carton.location?.revision ?? null })
        onZapisano?.(location); onZmieniono?.(); onZamknij()
      } else if (editor.manual) {
        if (zwolnij) await magazynApi.mrozniaZwolnij({ slot: editor.manual.slot, expected_revision: editor.manual.revision! })
        else await magazynApi.mrozniaZajete({ slot: editor.manual.slot, description: opis, expected_revision: editor.manual.revision })
        setKomunikat(zwolnij ? `Zwolniono miejsce ${editor.manual.slot}.` : `Zapisano towar na miejscu ${editor.manual.slot}.`)
        setEditor(null); setSlot(null); setZwolnienie(false); setDetails(false); onZmieniono?.(); await odswiez()
      }
    } catch (e) {
      setBlad(e instanceof Error ? e.message : 'Nie zapisano miejsca. Odczytaj plan i spróbuj ponownie.')
      await odswiez()
      // Never silently adopt a new revision after conflict; select the item again.
      setEditor(null); setSlot(null); setZwolnienie(false)
    } finally { zajety.current = false; setZapis(false) }
  }

  return <Dialog open onOpenChange={open => { if (!open && !zajety.current) onZamknij() }}>
    <DialogContent style={HMI_VARS} className="mroznia-fullscreen flex h-[100dvh] w-screen max-w-none flex-col gap-2 overflow-hidden rounded-none p-3 [&>button:last-child]:hidden"
      onInteractOutside={e => e.preventDefault()} onEscapeKeyDown={e => { if (zajety.current) e.preventDefault() }}>
      <div className="flex shrink-0 flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <DialogTitle>Rzut mroźni · 63 stałe miejsca</DialogTitle>
        <DialogDescription>A–I / 1–7 · Rząd 1 przy drzwiach, 7 w głębi.</DialogDescription>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
      {offline ? <div role="alert" className="rounded-lg border border-red-700 p-3 text-red-800">
        Brak aktualnego planu — wybór i zapis zablokowane.
        <button type="button" className="ml-3 min-h-12 underline" onClick={() => void odswiez()}>Ponów odczyt</button>
      </div> : null}
      {blad ? <p role="alert" className="font-bold text-red-800">{blad}</p> : null}
      {komunikat ? <p role="status" className="font-bold text-green-800">{komunikat}</p> : null}
      {!plan && !offline ? <p role="status">Wczytuję miejsca…</p> : null}
      {zaladunek && !zaladunek.online ? <p role="alert" className="font-bold text-red-800">Brak aktualnego składu auta — kolory pokazują ostatnio odczytane zamówienia.</p> : null}
      {plan ? <>
        {!editor ? <div className="flex shrink-0 flex-wrap gap-2">
          <button type="button" disabled={zapis} className="min-h-12 min-w-0 flex-1 rounded-lg px-3 text-left" style={buttonStyle}
            onClick={() => setKeyboard('search')}>⌨ Szukaj kartonu, klienta, receptury lub tulei{szukaj ? `: ${szukaj}` : ''}</button>
          {szukaj ? <button type="button" disabled={zapis} onClick={() => search('')} className="min-h-12 rounded-lg border px-3">Wyczyść filtr</button> : null}
          <button type="button" disabled={disabled} aria-expanded={details} className="min-h-12 rounded-lg px-3 font-bold" style={buttonStyle}
            onClick={() => setDetails(!details)}>{details ? 'Ukryj szczegóły' : `Zawartość kartonów (${plan.cartons.length})`}</button>
        </div> : null}
        <div className={`mroznia-layout ${details ? 'mroznia-layout-details' : ''}`}>
          <div className="mroznia-map-scroll" aria-label="Mapa miejsc mroźni">
            <div role="group" aria-label="Stałe miejsca mroźni" className="mroznia-slots"
              style={{ gridTemplateColumns: `repeat(${plan.columns.length}, minmax(0, 1fr))` }}>
              {Array.from({ length: plan.rows }, (_, i) => plan.rows - i).flatMap(row => plan.columns.map(col => {
                const place = `${col}${row}`
                const c = plan.cartons.find(c => c.location?.slot === place)
                const b = blocked.find(b => b.slot === place)
                const own = c && editor?.carton && key(c) === key(editor.carton)
                const active = editor ? slot === place : !!c && key(c) === wybrany
                const locked = disabled || (!!editor?.carton && (!!b || (!!c && !own)))
                  || (!!editor?.manual && place !== editor.manual.slot) || (!!swapFrom && (!c || key(c) === key(swapFrom)))
                const order = c && loadingOrder(c), color = order?.color
                const summary = c && freezerTileSummary(c.lines)
                const angle = active && editor?.carton ? rotation : c?.location?.rotation ?? 0
                return <button type="button" key={place} data-slot={place} disabled={!!locked} aria-pressed={active}
                  aria-label={`${place} · ${c ? `Karton ${c.cartonNo} · ${c.clientName}` : b ? `zajęte · ${b.description}` : 'wolne'}${order ? ` · ${color!.label} · ${order.orderNo}` : ''}`}
                  ref={el => { if (c) { if (el) mapTiles.current.set(key(c), el); else mapTiles.current.delete(key(c)) } }}
                  data-highlighted={c && highlight(c) ? 'true' : 'false'} data-loading-color={color?.index}
                  onClick={() => { if (editor?.carton) setSlot(place); else if (!editor) { if (c) pokaz(c, 'map'); else recznie(place) } }}
                  className={`mroznia-map-tile ${c && highlight(c) ? 'mroznia-found' : ''}`}
                  style={{ '--loading-fill': color?.fill,
                    borderColor: active ? 'var(--accent)' : color?.edge ?? (b ? 'var(--amb)' : c ? zaladunek ? '#94a3b8' : 'var(--success)' : 'var(--line)'),
                    backgroundColor: color?.fill ?? (active ? 'var(--accentSoft)' : b ? 'var(--ambSoft)' : c ? zaladunek ? '#e2e8f0' : 'var(--successSoft)' : 'var(--panel)'),
                    color: 'var(--ink)', opacity: c && !editor && ((needle && !matches(c)) || (!swapFrom && !inOrder(c))) ? 0.35 : 1 } as CSSProperties}>
                  <span className="mroznia-tile-heading"><b>{place}</b><b className="hmi-v10-mono">{c ? compactNo(c.cartonNo) : ''}</b></span>
                  {c && summary ? <>
                    <span className="block truncate font-bold">{summary.recipe}</span>
                    <span className="mroznia-tile-qty block truncate">{summary.quantity}</span>
                    <span className="mroznia-tile-badges">
                      {color ? <b style={{ color: color.edge }}>{color.label}</b> : <span aria-hidden className="mroznia-orientation" style={{ width: angle === 90 ? 8 : 14, height: angle === 90 ? 14 : 8 }} />}
                      {summary.tubes.length ? <b className="text-amber-900" aria-label={`Tuleja niestandardowa: ${summary.tubes.join(', ')} cm`}>T {summary.tubes.join('/')}</b> : null}
                    </span>
                  </> : b ? <><b>ZAJĘTE</b><span className="line-clamp-2 break-words">{b.description}</span></>
                    : <span style={{ color: 'var(--mut)' }}>{active ? 'wybrane' : 'wolne'}</span>}
                </button>
              }))}
            </div>
            <div className="mroznia-door">Drzwi mroźnicze · wejście ↑</div>
          </div>
          {details ? <aside ref={aside} className="mroznia-details space-y-3" aria-label="Szczegóły mroźni">
            {zaladunek ? <section aria-label="Kolory zamówień do załadunku" className="space-y-2 rounded-xl border p-3">
              <h3 className="text-lg font-bold">Na auto: {zaladunek.vehicleName}</h3>
              <p className="text-sm">Kolor i oznaczenie K są takie same jak na liście załadunku. Szare palety: pozostały towar.</p>
              <button type="button" disabled={!!editor || !!swapFrom || zapis} aria-pressed={!activeOrder}
                onClick={() => { setOrderFilter(''); search('') }} className="min-h-12 w-full rounded-lg border px-3 font-bold">Wszystkie zamówienia auta ({loadingOrders.size})</button>
              {zaladunek.orders.map(o => {
                const cartons = plan.cartons.filter(c => loadingOrder(c)?.id === o.id)
                return <button type="button" key={o.id} aria-pressed={activeOrder === o.id} disabled={!!editor || !!swapFrom || zapis}
                  onClick={() => { setOrderFilter(o.id); search(''); requestAnimationFrame(() => {
                    const first = cartons.find(c => positioned(c.location))
                    if (first) mapTiles.current.get(key(first))?.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
                  }) }}
                  className="flex min-h-14 w-full items-center gap-2 rounded-lg border-2 p-2 text-left"
                  style={{ borderColor: o.color.edge, background: activeOrder === o.id ? o.color.fill : 'white' }}>
                  <ZnacznikZamowienia color={o.color} />
                  <span className="min-w-0 break-words text-sm"><b className="block">{o.clientName} · {o.orderNo}</b>
                    W mroźni: {cartons.length} · bez położenia: {cartons.filter(c => !positioned(c.location)).length}</span>
                </button>
              })}
              {!loadingOrders.size ? <p>Dołóż zamówienie do auta, aby oznaczyć jego kartony.</p> : null}
            </section> : null}
            {swapFrom ? <section aria-label="Podgląd zamiany" className="space-y-2 rounded-xl border-2 border-green-700 bg-green-50 p-3">
              <h3 className="text-lg font-bold">Zamiana miejsc dwóch kartonów</h3>
              <p className="text-sm"><b>{swapFrom.cartonNo} · {swapFrom.clientName}</b> → {swapTo ? locationText(swapTo.location) : 'dotknij drugiego kartonu na mapie lub liście'}</p>
              {swapTo ? <p className="text-sm"><b>{swapTo.cartonNo} · {swapTo.clientName}</b> → {locationText(swapFrom.location)}</p> : null}
              <p className="text-xs">Każdy karton przejmuje miejsce i orientację palety drugiego. Zapis obejmuje oba kartony naraz.</p>
              {swapChanged ? <p role="alert" className="font-bold text-red-800">Położenie zmieniło się na innym stanowisku. Anuluj i wybierz parę ponownie.</p> : null}
              <button type="button" disabled={zapis} onClick={() => { setSwapFrom(null); setSwapTo(null) }} className="min-h-12 w-full rounded-lg border bg-white px-3">Anuluj zamianę</button>
            </section> : null}
            {editor?.manual ? <section className="space-y-2 rounded-xl border p-3" style={{ background: 'var(--ambSoft)' }}>
              <h3 className="text-xl font-bold">Miejsce {editor.manual.slot} · towar bez skanowania</h3>
              <button type="button" disabled={disabled || zwolnienie} onClick={() => setKeyboard('description')}
                className="min-h-14 w-full break-words rounded-lg px-3 text-left" style={buttonStyle}>
                ⌨ {opis || 'Wpisz produkt, np. łój wołowy'}</button>
              {editor.manual.revision ? <button type="button" disabled={disabled} onClick={() => setZwolnienie(true)}
                className="min-h-12 w-full rounded-lg border px-3 font-bold">Zwolnij miejsce</button> : null}
            </section> : editor && selected ? <section className="rounded-xl border p-3">
              <h3 className="text-xl font-extrabold">Karton {selected.cartonNo}</h3>
              <p className="break-words">{selected.clientName || 'na magazyn'} · {selected.orderNo}</p>
              <p className="font-bold">{locationText(selected.location)}</p>
              <div className="max-h-[180px] overflow-y-auto"><ZawartoscMrozni lines={selected.lines} /></div>
            </section> : null}
            {editor ? <section className="space-y-3 rounded-xl border p-3">
              {zwolnienie ? <>
                <p role="alert" className="font-bold">Towar został fizycznie usunięty z tego miejsca?</p>
                <button type="button" disabled={disabled} onClick={() => void zapisz(true)} className="min-h-12 w-full rounded-lg border px-3 font-bold">Tak, zwolnij miejsce</button>
                <button type="button" disabled={zapis} onClick={() => setZwolnienie(false)} className="min-h-12 w-full underline">Anuluj zwolnienie</button>
              </> : <>
                <p className="text-lg font-bold" aria-live="polite">Wybrane miejsce: {slot || 'dotknij wolnego kafelka'}</p>
                {editor.carton ? <>
                  <button type="button" disabled={disabled} onClick={() => setRotation(r => r === 0 ? 90 : 0)} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-lg px-3 font-bold" style={buttonStyle}>
                    <RotateCw size={22} aria-hidden /> Obróć o 90°</button>
                  <p aria-live="polite">{rotation === 0 ? 'Dłuższym bokiem od drzwi' : 'Krótszym bokiem od drzwi'}</p>
                </> : null}
                {editor.carton && positioned(editor.carton.location) ? <button type="button" disabled={disabled} onClick={() => beginSwap(editor.carton!)}
                  className="min-h-12 w-full rounded-lg border px-3 font-bold">Zamień miejscami</button> : null}
                <p role={occupiedByOther ? 'alert' : 'status'} className={occupiedByOther ? 'text-red-800' : ''}>{problem || 'Zapisz zgodnie z faktycznym ustawieniem towaru.'}</p>
              </>}
              <button type="button" disabled={zapis} onClick={() => { setEditor(null); setSlot(null); setZwolnienie(false) }} className="min-h-12 w-full underline">Anuluj zmianę</button>
            </section> : <section className="space-y-2" aria-label="Zawartość kartonów">
              <div className="sticky top-0 z-10 bg-white pb-2">
                <h3 className="text-lg font-bold">{needle ? 'Wyniki wyszukiwania' : 'Zawartość kartonów'} · {results.length}</h3>
                <p className="text-sm" style={{ color: 'var(--mut)' }}>{swapFrom ? 'Wybierz drugi karton z zapisanym położeniem.' : 'Dotknij karty, aby wskazać karton na mapie.'}</p>
              </div>
              {results.map(c => {
                const order = loadingOrder(c)
                return <section key={key(c)} data-testid="karton-zawartosc" aria-label={`Zawartość kartonu ${c.cartonNo}`}
                ref={el => { if (el) contentCards.current.set(key(c), el); else contentCards.current.delete(key(c)) }}
                className="scroll-mt-16 rounded-xl border-2" style={{ borderColor: order?.color.edge ?? (key(c) === wybrany ? '#15803d' : 'var(--line)'),
                  outline: key(c) === wybrany ? '2px solid #15803d' : undefined, outlineOffset: 1,
                  background: order?.color.fill ?? (key(c) === wybrany ? 'var(--successSoft)' : 'var(--panel)') }}>
                <button type="button" disabled={disabled || !!swapFrom && (!positioned(c.location) || key(c) === key(swapFrom))} aria-label={`Pokaż karton ${c.cartonNo} na mapie`} aria-pressed={key(c) === wybrany}
                  className="min-h-14 w-full p-3 text-left" onClick={() => pokaz(c, 'card')}>
                  <span className="flex flex-wrap items-baseline justify-between gap-x-2">
                    <b className="hmi-v10-mono text-xl">{c.cartonNo}</b>
                    <span className="text-sm font-bold">{c.clientName || 'magazyn'}</span>
                  </span>
                  {order ? <span className="my-1 flex flex-wrap items-center gap-2 text-sm font-bold"><ZnacznikZamowienia color={order.color} /> {order.orderNo}</span> : null}
                  <ZawartoscMrozni lines={c.lines} compact />
                  <span className="mt-2 block text-xs" style={{ color: positioned(c.location) ? 'var(--mut)' : 'var(--amb)' }}>{locationText(c.location)}</span>
                </button>
                {key(c) === wybrany && !swapFrom ? <div className="grid gap-2 border-t px-3 pb-3 pt-2 sm:grid-cols-2">
                  <button type="button" disabled={disabled} onClick={() => edytuj(c)} className="min-h-12 w-full rounded-lg px-3 font-bold" style={buttonStyle}>Przenieś / obróć</button>
                  {positioned(c.location) ? <button type="button" disabled={disabled} onClick={() => beginSwap(c)} className="min-h-12 w-full rounded-lg px-3 font-bold" style={buttonStyle}>Zamień miejscami</button> : null}
                </div> : null}
              </section>})}
              {!results.length && !needle ? <p className="p-3 text-sm">{activeOrder ? 'Brak kartonów tego zamówienia w mroźni.' : 'Brak kartonów w mroźni.'}</p> : null}
            </section>}
          </aside> : null}
        </div>
      </> : null}
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t pt-2">
        {/* Search status lives in the footer, so searching never shrinks or shifts the 63 tiles. */}
        {!editor && plan && needle ? <p role="status" className={`min-w-0 flex-1 text-sm font-bold ${results.length ? 'text-green-800' : 'text-amber-900'}`}>
          {results.length ? `Znaleziono: ${results.length} · na mapie pulsują na zielono.` : 'Nie znaleziono kartonów. Zmień numer, recepturę lub wyczyść filtr.'}
          {results.length ? <span className="block font-normal" style={{ color: 'var(--mut)' }}>Bez przypisanego miejsca: {results.filter(c => !positioned(c.location)).length}</span> : null}
        </p> : !editor && !swapFrom && plan ? <p className="min-w-0 flex-1 text-sm">Zajęte: {plan.cartons.length - bezMiejsca.length + blocked.length}/63 · Bez miejsca: {bezMiejsca.length}
          <span className="block" style={{ color: 'var(--mut)' }}>Dotknij kafelka · T = nietypowa tuleja</span></p> : null}
        {zaladunek && !editor && !swapFrom ? <button type="button" disabled={zapis} onClick={() => { setDetails(true); requestAnimationFrame(() => aside.current?.scrollTo?.({ top: 0 })) }}
          className="min-h-12 rounded-lg border px-3 font-bold">Kolory zamówień ({loadingOrders.size})</button> : null}
        {cel ? <p className="min-w-[200px] flex-1 text-sm">Zamknięcie mapy nie cofa wjazdu ani ważenia. Bez zapisu miejsce się nie zmieni.</p> : null}
        {swapFrom ? <button type="button" disabled={disabled || !swapTo || swapChanged} onClick={() => void saveSwap()}
          className="min-h-14 rounded-lg bg-green-700 px-4 font-bold text-white disabled:opacity-50">{zapis ? 'Zapisuję…' : 'Zapisz zamianę'}</button> : null}
        {editor && !zwolnienie ? <button type="button" disabled={disabled || !!problem} onClick={() => void zapisz()}
          className="min-h-14 rounded-lg px-4 font-bold text-white disabled:opacity-50" style={{ background: 'var(--accent)' }}>
          {zapis ? 'Zapisuję…' : editor.manual ? 'Zapisz towar' : 'Zapisz miejsce'}</button> : null}
        <button type="button" disabled={zapis} onClick={onZamknij} className="min-h-12 rounded-lg px-6 font-bold" style={buttonStyle}>Zamknij mapę</button>
      </div>
      {keyboard ? <KlawiaturaHmi label={keyboard === 'search' ? 'Szukaj kartonu' : 'Nazwa produktu'} value={keyboard === 'search' ? szukaj : opis}
        onAccept={keyboard === 'search' ? search : setOpis} onClose={() => setKeyboard(null)} /> : null}
    </DialogContent>
  </Dialog>
}
