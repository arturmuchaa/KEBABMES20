import { useCallback, useEffect, useRef, useState } from 'react'
import { RotateCw } from 'lucide-react'
import { magazynApi, type KartonNaPlanie, type PlanMrozniDane, type MiejsceMrozni } from '@/lib/api'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { HMI_VARS } from '@/features/hmi-theme/vars'
import { ZawartoscMrozni } from './ZawartoscMrozni'

export type CelMrozni = Pick<KartonNaPlanie, 'kind' | 'id' | 'cartonNo'>
const key = (c: CelMrozni) => `${c.kind}:${c.id}`
const buttonStyle = { background: 'var(--panel)', border: '1px solid var(--line)', color: 'var(--ink)' }

/** Fixed logical slots, not a scale drawing. Buttons also work without dragging. */
export function PlanMrozni({ cel, onZamknij, onZapisano, onZmieniono }: {
  cel?: CelMrozni
  onZamknij: () => void
  onZapisano?: (location: MiejsceMrozni) => void
  onZmieniono?: () => void
}) {
  const [plan, setPlan] = useState<PlanMrozniDane | null>(null)
  const [blad, setBlad] = useState('')
  const [offline, setOffline] = useState(false)
  const [szukaj, setSzukaj] = useState('')
  const [wybrany, setWybrany] = useState(cel ? key(cel) : '')
  const [edycja, setEdycja] = useState<KartonNaPlanie | null>(null)
  const [slot, setSlot] = useState<string | null>(null)
  const [rotation, setRotation] = useState<0 | 90>(0)
  const [zapis, setZapis] = useState(false)
  const [reczne, setReczne] = useState<{ slot: string; revision: string | null } | null>(null)
  const [opis, setOpis] = useState('')
  const [zwolnienie, setZwolnienie] = useState(false)
  const [komunikat, setKomunikat] = useState('')
  const zajety = useRef(false)
  const poczatek = useRef(false)
  const request = useRef(0)

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
    setReczne(null); setZwolnienie(false)
    setWybrany(key(c)); setEdycja(c)
    setSlot(c.location?.slot ?? null); setRotation(c.location?.rotation ?? 0)
  }
  useEffect(() => {
    if (!cel || !plan || poczatek.current) return
    poczatek.current = true
    const c = plan.cartons.find(c => key(c) === key(cel))
    if (c) edytuj(c)
    else setBlad('Kartonu nie ma już w mroźni. Zamknij mapę i odśwież listę.')
  }, [cel, plan])

  const selected = plan?.cartons.find(c => key(c) === wybrany)
  const needle = szukaj.trim().toLocaleLowerCase('pl')
  const matches = (c: KartonNaPlanie) => !needle || `${c.cartonNo} ${c.clientName} ${c.orderNo}`.toLocaleLowerCase('pl').includes(needle)
  const bezMiejsca = plan?.cartons.filter(c => !c.location) ?? []
  const blocked = plan?.blocked ?? []
  const zajeteRecznie = blocked.find(b => b.slot === reczne?.slot)

  function wybierzReczne(place: string) {
    const b = blocked.find(b => b.slot === place)
    setWybrany(''); setReczne({ slot: place, revision: b?.revision ?? null })
    setOpis(b?.description ?? ''); setZwolnienie(false); setBlad(''); setKomunikat('')
  }

  async function zapiszReczne(zwolnij = false) {
    if (!reczne || offline || zajety.current || (zwolnij && !reczne.revision)) return
    zajety.current = true; setZapis(true); setBlad(''); setKomunikat(''); request.current++
    try {
      if (zwolnij) await magazynApi.mrozniaZwolnij({ slot: reczne.slot, expected_revision: reczne.revision! })
      else await magazynApi.mrozniaZajete({ slot: reczne.slot, description: opis, expected_revision: reczne.revision })
      setKomunikat(zwolnij ? `Zwolniono miejsce ${reczne.slot}.` : `Miejsce ${reczne.slot} oznaczone jako zajęte.`)
      setReczne(null); setZwolnienie(false)
      onZmieniono?.()
      await odswiez()
    } catch (e) {
      setBlad(e instanceof Error ? e.message : 'Nie zapisano oznaczenia miejsca.')
      await odswiez()
      setReczne(null); setZwolnienie(false) // a conflict requires selecting the current slot again
    } finally { zajety.current = false; setZapis(false) }
  }

  async function zapisz() {
    if (!edycja || !slot || offline || zajety.current) return
    zajety.current = true; setZapis(true); setBlad(''); request.current++
    try {
      const location = await magazynApi.mrozniaLokalizacja({ kind: edycja.kind, container_id: edycja.id,
        slot, rotation, expected_revision: edycja.location?.revision ?? null })
      onZapisano?.(location); onZamknij()
    } catch (e) {
      setBlad(e instanceof Error ? e.message : 'Nie zapisano miejsca. Spróbuj ponownie.')
      const p = await odswiez()
      const c = p?.cartons.find(c => key(c) === key(edycja))
      if (c) { setEdycja(c); setSlot(null) }
      else if (p) setEdycja(null)
    } finally { zajety.current = false; setZapis(false) }
  }

  return <Dialog open onOpenChange={open => { if (!open && !zajety.current) onZamknij() }}>
    <DialogContent style={HMI_VARS} className="max-h-[94vh] w-[96vw] max-w-[1280px] gap-2 overflow-y-auto p-4"
      onInteractOutside={e => e.preventDefault()} onEscapeKeyDown={e => { if (zajety.current) e.preventDefault() }}>
      <DialogTitle>{edycja ? `Wybierz miejsce · karton ${edycja.cartonNo}` : 'Rzut mroźni · 63 miejsca'}</DialogTitle>
      <DialogDescription>7 rzędów × 9 miejsc. Rząd 1 przy drzwiach, 7 w głębi. Paleta 120 × 80 cm; schemat miejsc, nie skala pomieszczenia.</DialogDescription>
      {offline ? <div role="alert" className="rounded-lg border border-red-700 p-3 text-red-800">
        Brak aktualnego planu — wybór i zapis zablokowane.
        <button type="button" className="ml-3 min-h-12 underline" onClick={() => void odswiez()}>Ponów odczyt</button>
      </div> : null}
      {blad ? <p role="alert" className="font-bold text-red-800">{blad}</p> : null}
      {komunikat ? <p role="status" className="font-bold text-green-800">{komunikat}</p> : null}
      {!plan && !offline ? <p role="status">Wczytuję miejsca…</p> : null}
      {plan ? <>
        {!edycja ? <label className="flex flex-wrap items-center gap-2 text-sm">Szukaj kartonu, klienta lub zamówienia
          <input value={szukaj} onChange={e => setSzukaj(e.target.value)} className="min-h-12 min-w-0 flex-1 rounded-lg border px-3" />
        </label> : null}
        <p className="text-sm">Zajęte: {plan.cartons.filter(c => c.location).length + blocked.length}/63 · w tym ręcznie: {blocked.length} · Bez miejsca: {bezMiejsca.length}.
          {needle ? ` Znaleziono: ${plan.cartons.filter(matches).length}.` : ''}
          {' '}Domyślnie dłuższym bokiem od strony drzwi.</p>
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_240px] xl:grid-cols-[minmax(0,1fr)_280px]">
          <div className="overflow-x-auto rounded-xl border p-2" aria-label="Mapa miejsc mroźni">
            <div className="grid min-w-[560px] gap-1.5" style={{ gridTemplateColumns: `repeat(${plan.columns.length}, minmax(0,1fr))` }}>
              {Array.from({ length: plan.rows }, (_, i) => plan.rows - i).flatMap(row => plan.columns.map(col => {
                const place = `${col}${row}`
                const c = plan.cartons.find(c => c.location?.slot === place)
                const b = blocked.find(b => b.slot === place)
                const own = c && edycja && key(c) === key(edycja)
                const active = edycja ? slot === place : reczne?.slot === place || (c && key(c) === wybrany)
                const disabled = zapis || offline || (edycja && (!!b || (!!c && !own)))
                const angle = active && edycja ? rotation : c?.location?.rotation ?? 0
                return <button type="button" key={place} disabled={!!disabled} aria-pressed={!!active}
                  aria-label={`${place} · ${c ? `karton ${c.cartonNo} · ${c.clientName}` : b ? `zajęte · ${b.description}` : 'wolne'}`}
                  onClick={() => {
                    if (edycja) setSlot(place)
                    else if (c) { setReczne(null); setZwolnienie(false); setWybrany(key(c)) }
                    else wybierzReczne(place)
                  }}
                  className="relative flex h-[60px] flex-col items-center justify-center rounded-lg border-2 px-1 py-1 text-center disabled:cursor-not-allowed"
                  style={{ borderColor: active ? 'var(--accent)' : b ? 'var(--amb)' : c && matches(c) ? 'var(--success)' : 'var(--line)',
                    background: active ? 'var(--accentSoft)' : b ? 'var(--ambSoft)' : c ? 'var(--successSoft)' : 'var(--panel)',
                    color: 'var(--ink)', opacity: needle && c && !matches(c) ? 0.5 : 1 }}>
                <span aria-hidden className="absolute right-0.5 top-0.5 rounded-sm border" style={{
                    width: angle === 90 ? 9 : 15, height: angle === 90 ? 15 : 9, borderColor: 'var(--mut)',
                  }} />
                  <b className="text-sm leading-4">{place}</b>
                  <span className="hmi-v10-mono text-sm leading-4">{c ? c.cartonNo : b ? 'ZAJĘTE' : 'wolne'}</span>
                  {c ? <span className="w-full truncate text-[11px] leading-3">{c.clientName || 'magazyn'}</span> : null}
                  {b ? <span className="w-full truncate text-[11px] leading-3">{b.description}</span> : null}
                </button>
              }))}
            </div>
            <div className="ml-[23%] mt-2 w-fit rounded-lg border-2 border-dashed px-3 py-1 text-sm font-bold">Drzwi mroźnicze · wejście ↑</div>
          </div>
          <aside className="min-w-0 space-y-3">
            {reczne ? <section className="space-y-3 rounded-xl border p-3" style={{ borderColor: 'var(--amb)', background: 'var(--ambSoft)' }}>
              <h3 className="text-xl font-extrabold">Miejsce {reczne.slot}</h3>
              <p className="text-sm">{zajeteRecznie ? `Zajęte: ${zajeteRecznie.description}` : 'Towar bez skanowania, np. paleta łoju wołowego.'}</p>
              <label className="block text-sm">Co zajmuje miejsce (opcjonalnie)
                <input value={opis} maxLength={160} disabled={zapis || offline || zwolnienie} onChange={e => setOpis(e.target.value)}
                  className="mt-1 min-h-12 w-full min-w-0 rounded-lg border px-2" placeholder="np. łój wołowy" />
              </label>
              {zajeteRecznie?.operator ? <p className="text-xs">Oznaczył: {zajeteRecznie.operator}</p> : null}
              {zwolnienie ? <div className="space-y-2">
                <p role="alert" className="font-bold">Towar usunięty z miejsca {reczne.slot}?</p>
                <button type="button" disabled={zapis || offline} onClick={() => void zapiszReczne(true)}
                  className="min-h-12 w-full rounded-lg px-3 font-bold text-white disabled:opacity-50" style={{ background: 'var(--amb)' }}>Tak, zwolnij miejsce</button>
                <button type="button" disabled={zapis} onClick={() => setZwolnienie(false)} className="min-h-12 w-full underline">Anuluj zwolnienie</button>
              </div> : <>
                <button type="button" disabled={zapis || offline} onClick={() => void zapiszReczne()}
                  className="min-h-12 w-full rounded-lg px-3 font-bold text-white disabled:opacity-50" style={{ background: 'var(--amb)' }}>
                  {zapis ? 'Zapisuję…' : zajeteRecznie ? 'Zapisz opis' : 'Oznacz jako zajęte'}
                </button>
                {zajeteRecznie ? <button type="button" disabled={zapis || offline} onClick={() => setZwolnienie(true)}
                  className="min-h-12 w-full rounded-lg px-3 font-bold" style={buttonStyle}>Zwolnij miejsce</button> : null}
              </>}
            </section> : selected ? <section className="rounded-xl border p-3">
              <h3 className="text-xl font-extrabold">Karton {selected.cartonNo}</h3>
              <p className="break-words">{selected.clientName || 'na magazyn'} · {selected.orderNo}</p>
              <p className="font-bold">{selected.location ? `Miejsce ${selected.location.slot}` : 'Brak przypisanego miejsca'}</p>
              <div className="max-h-[180px] overflow-y-auto"><ZawartoscMrozni lines={selected.lines} /></div>
              {!edycja ? <button type="button" disabled={offline || zapis} className="mt-3 min-h-12 w-full rounded-lg px-3 font-bold" style={buttonStyle}
                onClick={() => edytuj(selected)}>Przenieś / obróć</button> : null}
            </section> : <p>Dotknij kartonu, aby zobaczyć zawartość. Wolne miejsce możesz oznaczyć jako zajęte przez towar bez skanowania.</p>}
            {edycja ? <section className="space-y-3 rounded-xl border p-3">
              <div className="flex min-h-[60px] items-center gap-3">
                <p className="flex-1 text-lg font-bold">Wybrane: {slot || 'dotknij wolnego miejsca'}</p>
                <div aria-hidden className="grid shrink-0 place-items-center rounded-lg border-4 font-bold"
                style={{ width: rotation === 0 ? 60 : 40, height: rotation === 0 ? 40 : 60,
                  background: 'var(--accentSoft)', borderColor: 'var(--accentLine)', color: 'var(--accent)' }}>
                  {slot || '—'}
                </div>
              </div>
              <button type="button" disabled={zapis || offline} onClick={() => setRotation(r => r === 0 ? 90 : 0)}
                className="flex min-h-12 w-full items-center justify-center gap-2 rounded-lg px-3 font-bold" style={buttonStyle}>
                <RotateCw size={22} aria-hidden /> Obróć o 90°
              </button>
              <p aria-live="polite">{rotation === 0 ? 'Dłuższym bokiem od drzwi' : 'Krótszym bokiem od drzwi'}</p>
              <button type="button" disabled={!slot || offline || zapis || !selected} onClick={() => void zapisz()}
                className="min-h-14 w-full rounded-lg px-3 font-bold text-white disabled:opacity-50" style={{ background: 'var(--accent)' }}>
                {zapis ? 'Zapisuję…' : 'Zapisz miejsce'}
              </button>
              {!cel ? <button type="button" disabled={zapis} className="min-h-12 w-full underline" onClick={() => setEdycja(null)}>Anuluj przenoszenie</button> : null}
            </section> : null}
            {!edycja && !reczne ? <div className="max-h-[240px] space-y-2 overflow-y-auto" aria-label="Kartony do zlokalizowania">
              {(needle ? plan.cartons.filter(matches) : bezMiejsca).map(c => <button type="button" key={key(c)} disabled={offline || zapis}
                className="min-h-12 w-full rounded-lg px-3 py-2 text-left" style={buttonStyle} onClick={() => setWybrany(key(c))}>
                <b>{c.cartonNo}</b> · {c.clientName || 'magazyn'} · {c.location?.slot || 'BEZ MIEJSCA'}
              </button>)}
            </div> : null}
          </aside>
        </div>
      </> : null}
      <div className="flex flex-wrap items-center justify-end gap-3">
        {cel ? <p className="min-w-[200px] flex-1 text-sm" style={{ color: 'var(--mut)' }}>Zamknięcie mapy nie cofa wjazdu ani ważenia. Bez zapisu miejsce się nie zmieni.</p> : null}
        <button type="button" disabled={zapis} onClick={onZamknij} className="min-h-12 rounded-lg px-6 font-bold" style={buttonStyle}>
          {edycja ? 'Zamknij bez zmiany miejsca' : 'Zamknij mapę'}
        </button>
      </div>
    </DialogContent>
  </Dialog>
}
