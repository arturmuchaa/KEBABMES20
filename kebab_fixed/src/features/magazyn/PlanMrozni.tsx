import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { RotateCw } from 'lucide-react'
import { magazynApi, type KartonNaPlanie, type PlanMrozniDane, type MiejsceMrozni, type ZajeteMiejsceMrozni } from '@/lib/api'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { HMI_VARS } from '@/features/hmi-theme/vars'
import { ZawartoscMrozni } from './ZawartoscMrozni'
import { KlawiaturaHmi } from './KlawiaturaHmi'
import { firstFree, locationText, palletSize, placementProblem, positioned, ROOM, type Footprint } from './mrozniaGeometry'
import { compactCartonNo, findFreezerCartons, freezerTileSummary } from './mrozniaContents'
import { ZnacznikZamowienia, type ZamowienieKolorowe } from './koloryZaladunku'
import './plan-mrozni.css'

export type CelMrozni = Pick<KartonNaPlanie, 'kind' | 'id' | 'cartonNo'>
const key = (c: CelMrozni) => `${c.kind}:${c.id}`
const compactNo = compactCartonNo
const manualId = () => 'M' + Array.from(crypto.getRandomValues(new Uint32Array(4)), n => n.toString(16).padStart(8, '0')).join('')
const buttonStyle = { background: 'var(--panel)', border: '1px solid var(--line)', color: 'var(--ink)' }
type Editor = { carton: KartonNaPlanie; manual?: never } | { carton?: never; manual: { slot: string; revision: string | null } }

/** The same cm scale on both axes; rotation changes footprint, never other pallets. */
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
  const [draft, setDraft] = useState<Footprint | null>(null)
  const [rotation, setRotation] = useState<0 | 90>(90)
  const [opis, setOpis] = useState('')
  const [zapis, setZapis] = useState(false)
  const [zwolnienie, setZwolnienie] = useState(false)
  const [komunikat, setKomunikat] = useState('')
  const [keyboard, setKeyboard] = useState<'search' | 'description' | null>(null)
  const [powieksz, setPowieksz] = useState(false)
  const [swapFrom, setSwapFrom] = useState<KartonNaPlanie | null>(null)
  const [swapTo, setSwapTo] = useState<KartonNaPlanie | null>(null)
  const [orderFilter, setOrderFilter] = useState('')
  const [fitWidth, setFitWidth] = useState<number | null>(null)
  const zajety = useRef(false)
  const poczatek = useRef(false)
  const request = useRef(0)
  const mapTiles = useRef(new Map<string, HTMLButtonElement>())
  const contentCards = useRef(new Map<string, HTMLElement>())
  const aside = useRef<HTMLElement>(null)
  const mapViewport = useRef<HTMLDivElement>(null)

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
    const viewport = mapViewport.current
    if (!viewport || typeof ResizeObserver === 'undefined') return
    const measure = () => setFitWidth(window.matchMedia('(min-width: 768px)').matches
      ? Math.max(80, (viewport.clientHeight - 78) * ROOM.widthCm / ROOM.depthCm) : null)
    const observer = new ResizeObserver(measure)
    observer.observe(viewport); measure()
    return () => observer.disconnect()
  }, [!!plan])

  function edytuj(c: KartonNaPlanie) {
    setEditor({ carton: c }); setWybrany(key(c)); setZwolnienie(false); setBlad(''); setKomunikat('')
    setDraft(positioned(c.location) ? c.location : null); setRotation(c.location?.rotation ?? 90)
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
  const manualBezMiejsca = blocked.filter(b => !positioned(b))
  const occupied = [
    ...(plan?.cartons.filter(c => !editor?.carton || key(c) !== key(editor.carton)).map(c => c.location) ?? []),
    ...blocked.filter(b => b.slot !== editor?.manual?.slot),
  ].filter(positioned)
  const allPositions = [...(plan?.cartons.map(c => c.location) ?? []), ...blocked].filter(positioned)
  const ready = plan?.room?.widthCm === ROOM.widthCm && plan?.room?.depthCm === ROOM.depthCm
  const disabled = zapis || offline || !ready
  const problem = draft ? placementProblem(draft, occupied) : 'Wskaż rzeczywiste położenie na mapie.'
  const size = palletSize(rotation)
  const swapChanged = [swapFrom, swapTo].some(c => c && plan?.cartons.find(p => key(p) === key(c))?.location?.revision !== c.location?.revision)

  function pokaz(c: KartonNaPlanie, from: 'map' | 'card' | 'search') {
    const id = key(c)
    if (swapFrom) {
      if (id === key(swapFrom) || !positioned(c.location)) return
      setSwapTo(c)
    }
    setWybrany(id); setZwolnienie(false)
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
    setSwapFrom(c); setSwapTo(null); setEditor(null); setDraft(null); setSzukaj('')
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

  function recznie(b?: ZajeteMiejsceMrozni) {
    setEditor({ manual: { slot: b?.slot ?? manualId(), revision: b?.revision ?? null } })
    setWybrany(''); setOpis(b?.description ?? ''); setDraft(positioned(b) ? b : null); setRotation(b?.rotation ?? 90)
    setBlad(''); setKomunikat(''); setZwolnienie(false)
  }

  async function zapisz(zwolnij = false) {
    if (!editor || disabled || zajety.current || (!zwolnij && (!draft || problem))) return
    if (zwolnij && !editor.manual?.revision) return
    zajety.current = true; setZapis(true); setBlad(''); setKomunikat(''); request.current++
    try {
      if (editor.carton && draft) {
        const location = await magazynApi.mrozniaLokalizacja({ kind: editor.carton.kind, container_id: editor.carton.id,
          x_cm: draft.xCm, y_cm: draft.yCm, rotation: draft.rotation, expected_revision: editor.carton.location?.revision ?? null })
        onZapisano?.(location); onZmieniono?.(); onZamknij()
      } else if (editor.manual) {
        if (zwolnij) await magazynApi.mrozniaZwolnij({ slot: editor.manual.slot, expected_revision: editor.manual.revision! })
        else if (draft) await magazynApi.mrozniaZajete({ slot: editor.manual.slot, description: opis,
          expected_revision: editor.manual.revision, x_cm: draft.xCm, y_cm: draft.yCm, rotation: draft.rotation })
        setKomunikat(zwolnij ? 'Zwolniono miejsce.' : 'Zapisano towar i jego położenie.')
        setEditor(null); setDraft(null); setZwolnienie(false); onZmieniono?.(); await odswiez()
      }
    } catch (e) {
      setBlad(e instanceof Error ? e.message : 'Nie zapisano miejsca. Odczytaj plan i spróbuj ponownie.')
      await odswiez()
      // Never silently adopt a new revision after conflict; select the item again.
      setEditor(null); setDraft(null); setZwolnienie(false)
    } finally { zajety.current = false; setZapis(false) }
  }

  function propose() {
    const p = firstFree(rotation, occupied)
    setDraft(p)
    setBlad(p ? '' : 'Brak wolnego prostokąta dla tej orientacji palety.')
  }
  function rotate() {
    const r = rotation === 0 ? 90 : 0
    setRotation(r); setDraft(p => p ? { ...p, rotation: r } : null)
  }
  function placeStyle(p: Footprint): CSSProperties {
    const s = palletSize(p.rotation)
    return { left: `${p.xCm / ROOM.widthCm * 100}%`, bottom: `${p.yCm / ROOM.depthCm * 100}%`,
      width: `${s.width / ROOM.widthCm * 100}%`, height: `${s.depth / ROOM.depthCm * 100}%` }
  }

  return <Dialog open onOpenChange={open => { if (!open && !zajety.current) onZamknij() }}>
    <DialogContent style={HMI_VARS} className="flex h-[94vh] w-[96vw] max-w-[1120px] flex-col gap-2 overflow-hidden p-4"
      onInteractOutside={e => e.preventDefault()} onEscapeKeyDown={e => { if (zajety.current) e.preventDefault() }}>
      <DialogTitle>Rzut mroźni · 560 × 1080 cm</DialogTitle>
      <DialogDescription>Widok z góry w skali. Drzwi na dole. Paleta 80 × 120 cm; obrót zmienia zajmowane miejsce.</DialogDescription>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto md:flex md:flex-col md:overflow-hidden">
      {offline ? <div role="alert" className="rounded-lg border border-red-700 p-3 text-red-800">
        Brak aktualnego planu — wybór i zapis zablokowane.
        <button type="button" className="ml-3 min-h-12 underline" onClick={() => void odswiez()}>Ponów odczyt</button>
      </div> : null}
      {plan && !ready ? <p role="alert">Serwer nie udostępnia jeszcze planu w centymetrach. Zaktualizuj serwer i odśwież aplikację.</p> : null}
      {blad ? <p role="alert" className="font-bold text-red-800">{blad}</p> : null}
      {komunikat ? <p role="status" className="font-bold text-green-800">{komunikat}</p> : null}
      {!plan && !offline ? <p role="status">Wczytuję miejsca…</p> : null}
      {zaladunek && !zaladunek.online ? <p role="alert" className="font-bold text-red-800">Brak aktualnego składu auta — kolory pokazują ostatnio odczytane zamówienia.</p> : null}
      {plan ? <>
        {!editor ? <div className="flex shrink-0 flex-wrap gap-2">
          <button type="button" disabled={zapis} className="min-h-12 min-w-0 flex-1 rounded-lg px-3 text-left" style={buttonStyle}
            onClick={() => setKeyboard('search')}>⌨ Szukaj kartonu, klienta, receptury lub tulei{szukaj ? `: ${szukaj}` : ''}</button>
          {szukaj ? <button type="button" disabled={zapis} onClick={() => search('')} className="min-h-12 rounded-lg border px-3">Wyczyść filtr</button> : null}
          <button type="button" disabled={disabled || !!swapFrom} className="min-h-12 rounded-lg px-3 font-bold" style={buttonStyle}
            onClick={() => recznie()}>Dodaj towar ręcznie</button>
        </div> : null}
        <p className="shrink-0 text-sm">Na planie: {allPositions.length} palet · zajęta powierzchnia: {(allPositions.length * 0.96).toFixed(2)} / 60,48 m².
          {' '}Bez potwierdzonego położenia: {bezMiejsca.length + manualBezMiejsca.length}.</p>
        {needle && !editor ? <p role="status" className="shrink-0 rounded-lg bg-green-50 px-3 py-2 text-sm font-bold text-green-800">
          {results.length ? `Znaleziono: ${results.length} · na mapie pulsują na zielono. Bez położenia: ${results.filter(c => !positioned(c.location)).length}.`
            : 'Nie znaleziono kartonów. Zmień numer, recepturę lub wyczyść filtr.'}
        </p> : null}
        {bezMiejsca.some(c => c.location) || manualBezMiejsca.length ? <p className="rounded-lg p-2 text-sm" style={{ background: 'var(--ambSoft)' }}>
          Stare adresy pól wymagają wskazania rzeczywistego położenia. Towar bez położenia nie jest jeszcze uwzględniony w zajętej powierzchni.
        </p> : null}
        <div className="grid items-start gap-4 md:min-h-0 md:flex-1 md:grid-cols-[minmax(280px,1fr)_minmax(280px,1fr)]">
          <div className="min-w-0 rounded-xl border p-3 md:flex md:h-full md:flex-col md:overflow-hidden" aria-label="Mapa miejsc mroźni">
            <div className="z-20 mb-2 flex shrink-0 items-center justify-between gap-2 bg-white pb-1">
              <b className="text-sm">Plan · 560 × 1080 cm</b>
              <button type="button" onClick={() => setPowieksz(!powieksz)} className="min-h-12 rounded-lg border px-3 text-sm">{powieksz ? 'Zmniejsz mapę' : 'Powiększ mapę'}</button>
            </div>
            <div ref={mapViewport} className="md:min-h-0 md:flex-1 md:overflow-y-auto">
            <div className="mx-auto" style={{ width: powieksz ? '100%' : `min(100%, ${fitWidth ?? 240}px)` }}>
              <p className="mb-1 text-center text-sm font-bold">← 560 cm →</p>
              <div role="group" aria-label="Podłoga mroźni" className="relative w-full border-2 border-slate-600"
                style={{ aspectRatio: '560 / 1080', backgroundColor: 'var(--panel)',
                  backgroundImage: 'linear-gradient(to right, #94a3b833 1px, transparent 1px), linear-gradient(to top, #94a3b833 1px, transparent 1px)',
                  backgroundSize: `${20 / 560 * 100}% ${20 / 1080 * 100}%` }}
                onClick={e => {
                  if (!editor || disabled) return
                  const box = e.currentTarget.getBoundingClientRect()
                  const x = (e.clientX - box.left) / box.width * ROOM.widthCm - size.width / 2
                  const y = (box.bottom - e.clientY) / box.height * ROOM.depthCm - size.depth / 2
                  setDraft({ xCm: Math.max(0, Math.min(ROOM.widthCm - size.width, Math.round(x / 10) * 10)),
                    yCm: Math.max(0, Math.min(ROOM.depthCm - size.depth, Math.round(y / 10) * 10)), rotation })
                }}>
                {plan.cartons.filter(c => positioned(c.location) && (!editor?.carton || key(c) !== key(editor.carton))).map(c => {
                  const summary = freezerTileSummary(c.lines)
                  const order = loadingOrder(c), color = order?.color
                  return <button
                  type="button" key={key(c)} disabled={disabled} aria-label={`Karton ${c.cartonNo} · ${c.clientName} · ${locationText(c.location)}${order ? ` · ${color!.label} · ${order.orderNo}` : ''}`}
                  ref={el => { if (el) mapTiles.current.set(key(c), el); else mapTiles.current.delete(key(c)) }}
                  aria-pressed={key(c) === wybrany} data-highlighted={highlight(c) ? 'true' : 'false'}
                  data-loading-color={color?.index}
                  title={`${c.cartonNo} · ${summary.recipe} · ${summary.quantity}${summary.tubes.length ? ` · tuleja ${summary.tubes.join('/')} cm` : ''}`}
                  onClick={e => { e.stopPropagation(); if (!editor) pokaz(c, 'map') }}
                  className={`mroznia-map-tile absolute overflow-hidden border-2 p-0.5 text-center ${highlight(c) ? 'mroznia-found' : ''}`}
                  style={{ ...placeStyle(c.location as Footprint), '--loading-fill': color?.fill,
                    borderColor: color?.edge ?? (zaladunek ? '#94a3b8' : key(c) === wybrany ? 'var(--accent)' : 'var(--success)'),
                    backgroundColor: color?.fill ?? (zaladunek ? '#e2e8f0' : 'var(--successSoft)'), color: 'var(--ink)',
                    opacity: !editor && ((needle && !matches(c)) || (!swapFrom && !inOrder(c))) ? 0.35 : 1 } as CSSProperties}>
                  <b className="block leading-3" style={{ fontSize: powieksz ? 11 : `min(9px, ${140 / Math.max(1, compactNo(c.cartonNo).length)}cqw)` }}>{compactNo(c.cartonNo)}</b>
                  {color ? <span className="block text-[9px] font-extrabold leading-3">{color.label}</span> : null}
                  <span className="mroznia-tile-contents">
                    <span className="block truncate text-[10px] font-bold leading-3">{summary.recipe}</span>
                    <span className="block truncate text-[9px] leading-3">{summary.quantity}</span>
                  </span>
                  {summary.tubes.length ? <span className="block truncate text-[8px] font-bold leading-3 text-amber-900" aria-label={`Tuleja niestandardowa: ${summary.tubes.join(', ')} cm`}>T {summary.tubes.join('/')}</span> : null}
                </button>})}
                {blocked.filter(b => positioned(b) && b.slot !== editor?.manual?.slot).map(b => <button type="button" key={b.slot}
                  disabled={disabled || !!swapFrom} aria-label={`Towar ręczny · ${b.description}`} onClick={e => { e.stopPropagation(); if (!editor) recznie(b) }}
                  className="absolute overflow-hidden border-2 p-0.5 text-center"
                  style={{ ...placeStyle(b as Footprint), borderColor: 'var(--amb)', background: 'var(--ambSoft)', color: 'var(--ink)' }}>
                  <b className="block text-[9px]">TOWAR</b><span className="block truncate text-[9px]">{b.description}</span>
                </button>)}
                {editor && draft ? <div aria-label="Podgląd palety" className="pointer-events-none absolute z-10 grid place-items-center overflow-hidden border-2 text-center"
                  style={{ ...placeStyle(draft), borderColor: problem ? '#b91c1c' : 'var(--accent)', background: problem ? '#fecaca' : 'var(--accentSoft)' }}>
                  <b className="text-[8px] leading-3">{editor.carton ? compactNo(editor.carton.cartonNo) : 'TOWAR'}<br />{size.width} × {size.depth}</b>
                </div> : null}
              </div>
              <div className="mt-2 text-center text-sm font-bold">Drzwi · wejście ↑</div>
              <p className="text-center text-xs">Głębokość 1080 cm · kratka 20 × 20 cm</p>
            </div>
            </div>
            <p className="mt-2 shrink-0 text-xs" style={{ color: 'var(--mut)' }}>Pełny skład na kartach obok. T = tuleja niestandardowa. Powiększenie pokazuje również opis na paletach.</p>
          </div>
          <aside ref={aside} className="min-w-0 space-y-3 md:h-full md:overflow-y-auto">
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
              <h3 className="text-xl font-bold">Towar na palecie bez skanowania</h3>
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
                <p className="text-lg font-bold" aria-live="polite">Bok od drzwi: {size.width} cm · w głąb: {size.depth} cm</p>
                <p className="text-sm">Na szerokość: {size.width === 80 ? '7 palet' : '4 palety'} tym bokiem; zostaje {560 % size.width} cm.</p>
                <button type="button" disabled={disabled} onClick={rotate} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-lg px-3 font-bold" style={buttonStyle}>
                  <RotateCw size={22} aria-hidden /> Obróć o 90°</button>
                {editor.carton && positioned(editor.carton.location) ? <button type="button" disabled={disabled} onClick={() => beginSwap(editor.carton!)}
                  className="min-h-12 w-full rounded-lg border px-3 font-bold">Zamień miejscami</button> : null}
                <button type="button" disabled={disabled} onClick={propose} className="min-h-12 w-full rounded-lg border px-3">Pokaż pierwsze wolne położenie</button>
                <p className="text-sm">Dotknij mapy, potem dopasuj strzałkami co 10 cm. Zapisz zgodnie z faktycznym ustawieniem palety.</p>
                {draft ? <>
                  <p aria-live="polite" className="font-bold">Od lewej ściany: {draft.xCm} cm · od drzwi: {draft.yCm} cm</p>
                  <div className="grid grid-cols-2 gap-2">
                    {([['← 10 cm', -10, 0], ['10 cm →', 10, 0], ['W głąb ↑ 10 cm', 0, 10], ['Do drzwi ↓ 10 cm', 0, -10]] as const).map(([label, x, y]) =>
                      <button type="button" key={label} disabled={disabled} onClick={() => setDraft(p => p ? { ...p, xCm: p.xCm + x, yCm: p.yCm + y } : p)}
                        className="min-h-12 rounded-lg border px-1 text-sm font-bold">{label}</button>)}
                  </div>
                </> : null}
                <p role={draft && problem ? 'alert' : 'status'} className={problem ? 'text-red-800' : 'text-green-800'}>{problem || 'Paleta mieści się i nie nachodzi na inne pozycje.'}</p>
              </>}
              <button type="button" disabled={zapis} onClick={() => { setEditor(null); setDraft(null); setZwolnienie(false) }} className="min-h-12 w-full underline">Anuluj zmianę</button>
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
              {manualBezMiejsca.map(b => <button type="button" key={b.slot} disabled={disabled || !!swapFrom} onClick={() => recznie(b)}
                className="min-h-12 w-full rounded-lg border px-3 text-left">{b.description} · {b.slot} · wskaż położenie</button>)}
            </section>}
          </aside>
        </div>
      </> : null}
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t pt-2">
        {cel ? <p className="min-w-[200px] flex-1 text-sm">Zamknięcie mapy nie cofa wjazdu ani ważenia. Bez zapisu miejsce się nie zmieni.</p> : null}
        {swapFrom ? <button type="button" disabled={disabled || !swapTo || swapChanged} onClick={() => void saveSwap()}
          className="min-h-14 rounded-lg bg-green-700 px-4 font-bold text-white disabled:opacity-50">{zapis ? 'Zapisuję…' : 'Zapisz zamianę'}</button> : null}
        {editor && !zwolnienie ? <button type="button" disabled={disabled || !!problem} onClick={() => void zapisz()}
          className="min-h-14 rounded-lg px-4 font-bold text-white disabled:opacity-50" style={{ background: 'var(--accent)' }}>
          {zapis ? 'Zapisuję…' : editor.manual ? 'Zapisz towar i położenie' : 'Zapisz miejsce'}</button> : null}
        <button type="button" disabled={zapis} onClick={onZamknij} className="min-h-12 rounded-lg px-6 font-bold" style={buttonStyle}>Zamknij mapę</button>
      </div>
      {keyboard ? <KlawiaturaHmi label={keyboard === 'search' ? 'Szukaj kartonu' : 'Nazwa produktu'} value={keyboard === 'search' ? szukaj : opis}
        onAccept={keyboard === 'search' ? search : setOpis} onClose={() => setKeyboard(null)} /> : null}
    </DialogContent>
  </Dialog>
}
