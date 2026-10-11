import { useRef, useState } from 'react'
import type { palletScanApi, VehicleState, VehicleStatePallet } from '@/lib/api'
import { krotkaData } from '../pula'
import { kgZaladunku, nazwaKartonu, WierszZaladunku, ZALADUNEK_OK } from './WierszZaladunku'

type Dostepne = Awaited<ReturnType<typeof palletScanApi.activeLoading>>

/** Widok operatora: stały postęp + potwierdzenie, przewijany pełny rozpis.
 * Liczba w nagłówku to PLAN, nie deklarowana pojemność samochodu.
 */
export function ListaZaladunku({ stan, ladowanie, online, skanuje, czekaNaStan, cofana,
  otwarte, ostatni, dostepne, bladDostepnych, ladujeDostepne,
  onOtworz, onDodaj, onZdejmij, onCofnij, onZakoncz }: {
  stan: VehicleState | null
  ladowanie: boolean
  online: boolean
  skanuje: boolean
  czekaNaStan: boolean
  cofana: string | null
  otwarte: string | null
  ostatni: { paleta: VehicleStatePallet; klient: string } | null
  dostepne: Dostepne
  bladDostepnych: boolean
  ladujeDostepne: boolean
  onOtworz: (id: string) => void
  onDodaj: (id: string) => void
  onZdejmij: (id: string) => void
  onCofnij: (orderId: string, p: VehicleStatePallet) => void
  onZakoncz: () => void
}) {
  const [pokazDostepne, setPokazDostepne] = useState(false)
  const lista = useRef<HTMLDivElement>(null)
  const orders = stan?.orders ?? []
  const total = stan?.totals.totalPallets ?? 0
  const loaded = stan?.totals.loadedPallets ?? 0
  const komplet = total > 0 && loaded === total
  const pallets = orders.flatMap(o => o.pallets)
  const zwazone = pallets.filter(p => p.weighing).length
  const niezgodne = pallets.filter(p => p.weighing?.ok === false).length
  const nieznane = pallets.filter(p => p.weighing === undefined).length
  const blokada = !online || skanuje || czekaNaStan || !!cofana || !loaded
  const pokazPanel = pokazDostepne || (!ladowanie && !orders.length)

  return <>
    <section aria-label="Postęp załadunku" data-testid="postep-zaladunku"
      className="shrink-0 border-b px-4 py-3" style={{ background: 'var(--panel)', borderColor: 'var(--line)' }}>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h2 className="break-words text-2xl font-extrabold leading-tight">{stan?.vehicle.name ?? 'Wczytuję auto…'}</h2>
          <div className="hmi-v10-mono text-base font-semibold" style={{ color: 'var(--mut)' }}>{stan?.vehicle.plate}</div>
        </div>
        <div className="flex items-center gap-3">
          <div className="hmi-v10-mono text-[40px] font-extrabold leading-none" style={{ color: komplet ? ZALADUNEK_OK : 'var(--ink)' }}>
            {loaded}<span style={{ color: 'var(--mut)' }}>/{total}</span>
          </div>
          <div className="text-sm"><b className="block text-base">Na aucie</b><span style={{ color: 'var(--mut)' }}>Zostało {Math.max(0, total - loaded)}</span></div>
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          <button type="button" aria-expanded={pokazPanel} aria-controls="dostepne-zamowienia"
            onClick={() => { setPokazDostepne(v => !v); if (!pokazPanel) lista.current?.scrollTo?.({ top: 0 }) }}
            className="min-h-12 rounded-xl border px-4 text-base font-bold"
            style={{ borderColor: 'var(--accentLine)', color: 'var(--accent)', background: 'var(--accentSoft)' }}>
            Dołóż zamówienie ({dostepne.length})
          </button>
          <button type="button" disabled={blokada} onClick={onZakoncz}
            className="min-h-12 rounded-xl px-4 text-base font-extrabold text-white disabled:cursor-not-allowed"
            style={{ background: blokada ? '#596575' : komplet ? ZALADUNEK_OK : 'var(--amb)' }}>
            {komplet ? 'Zakończ załadunek' : `Zakończ częściowo (${loaded}/${total})`}
          </button>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap justify-between gap-x-4 gap-y-1 text-sm" style={{ color: 'var(--mut)' }}>
        <span>Plan: <b>{total} kartonów/palet</b> · na aucie {kgZaladunku(stan?.totals.loadedKg ?? 0)} / {kgZaladunku(stan?.totals.totalKg ?? 0)} kg z rozpisu</span>
        <span>Zważone: <b>{zwazone}/{total}</b>{niezgodne ? <b style={{ color: 'var(--red)' }}> · niezgodne: {niezgodne}</b> : null}{nieznane ? ` · brak danych: ${nieznane}` : ''}</span>
      </div>
      <div role="progressbar" aria-label="Załadowane kartony i palety" aria-valuemin={0} aria-valuemax={total || 1} aria-valuenow={loaded}
        className="mt-2 h-2 overflow-hidden rounded-full" style={{ background: 'var(--lineSoft)' }}>
        <div className="h-full rounded-full" style={{ width: `${total ? Math.min(100, loaded / total * 100) : 0}%`, background: komplet ? ZALADUNEK_OK : 'var(--accent)' }} />
      </div>
      {czekaNaStan ? <p className="mt-1 text-sm font-semibold">Odświeżam skład auta — możesz skanować dalej.</p> : null}
    </section>

    <div role="status" aria-live="polite" aria-atomic="true" data-testid="potwierdzenie-zaladunku"
      className="flex min-h-12 shrink-0 flex-wrap items-center gap-x-3 border-b px-4 py-2 text-base"
      style={{ background: ostatni ? 'var(--successSoft)' : 'var(--panel)', color: ostatni ? ZALADUNEK_OK : 'var(--mut)', borderColor: 'var(--line)' }}>
      {ostatni ? <><b>Ostatni potwierdzony skan</b><span className="break-words font-semibold">{nazwaKartonu(ostatni.paleta)} · {ostatni.klient}</span><span>— zapisano na aucie</span></>
        : <b>{skanuje ? 'Zapisuję skan — czekam na potwierdzenie serwera…' : 'Skanuj karton — potwierdzenie zobaczysz tutaj.'}</b>}
    </div>

    <div ref={lista} data-testid="lista-zaladunku" className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
      <section id="dostepne-zamowienia" hidden={!pokazPanel} aria-label="Dostępne zamówienia"
        className="rounded-xl border p-3" style={{ background: 'var(--panel)', borderColor: 'var(--accentLine)' }}>
        <h3 className="mb-2 font-extrabold">Dołóż zamówienie do tego auta</h3>
        {bladDostepnych ? <p role="alert" className="font-semibold" style={{ color: 'var(--red)' }}>Nie udało się odświeżyć zamówień. Ponawiam…</p> : null}
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {dostepne.map(o => <button key={o.id} type="button" onClick={() => onDodaj(o.id)}
            className="min-h-14 min-w-0 rounded-lg border p-3 text-left"
            style={{ borderColor: 'var(--line)', background: 'var(--accentSoft)' }}>
            <b className="block break-words text-base">{o.clientName}</b>
            <span className="block break-words text-sm">{o.orderNo} · {o.totalPallets} pal.{o.deliveryDate ? ` · ${krotkaData(o.deliveryDate)}` : ''}</span>
          </button>)}
        </div>
        {!dostepne.length && !bladDostepnych ? <p>{ladujeDostepne ? 'Wczytuję zamówienia…' : 'Nic więcej nie czeka na załadunek.'}</p> : null}
      </section>

      {orders.length > 1 ? <nav aria-label="Zamówienia na aucie" className="sticky top-0 z-10 flex flex-wrap gap-2 rounded-xl p-2" style={{ background: 'var(--bg)' }}>
        {orders.map(z => <button key={z.id} type="button" aria-pressed={(otwarte ?? orders[0]?.id) === z.id}
          onClick={() => onOtworz(z.id)} className="min-h-12 rounded-lg border px-4 py-2 text-left text-base font-bold"
          style={{ background: (otwarte ?? orders[0]?.id) === z.id ? 'var(--accentSoft)' : 'var(--panel)', borderColor: 'var(--line)' }}>
          {z.clientName} · {z.totals.loadedPallets}/{z.totals.totalPallets}
        </button>)}
      </nav> : null}

      {orders.map((z, i) => {
        const expanded = (otwarte ?? orders[0]?.id) === z.id
        return <section key={z.id} aria-label={`Rozpis: ${z.clientName}`}>
          <div className="mb-2 flex flex-wrap items-center gap-3">
            <button type="button" aria-expanded={expanded} aria-controls={`kartony-${z.id}`}
              onClick={() => onOtworz(expanded ? '' : z.id)} className="min-h-12 min-w-0 flex-1 text-left">
              <span className="block break-words text-xl font-extrabold">{i + 1}. {z.clientName}</span>
              <span className="block text-sm" style={{ color: 'var(--mut)' }}>{z.orderNo} · {z.totals.loadedPallets}/{z.totals.totalPallets} załadowanych · {expanded ? '▾ Zwiń' : '▸ Pokaż zawartość'}</span>
            </button>
            {z.totals.loadedPallets === 0 ? <button type="button" onClick={() => onZdejmij(z.id)}
              className="min-h-11 rounded-lg border px-3 text-sm font-bold"
              style={{ borderColor: 'var(--line)', background: 'var(--panel)', color: 'var(--mut)' }}>zdejmij z auta</button> : null}
          </div>
          <div id={`kartony-${z.id}`} hidden={!expanded}>
            <ul aria-label={`Kartony: ${z.clientName}`} className="space-y-2">
              {z.pallets.map(p => <WierszZaladunku key={p.id || p.palletNo} paleta={p}
                ostatni={ostatni?.paleta === p} cofana={cofana === p.id} blokada={!!cofana || skanuje}
                onCofnij={() => onCofnij(z.id, p)} />)}
            </ul>
            {!z.pallets.length ? <p className="p-3" style={{ color: 'var(--amb)' }}>Zamówienie nie ma rozpisanych palet — biuro musi je rozpisać.</p> : null}
          </div>
        </section>
      })}
      {!orders.length && !ladowanie ? <p className="rounded-xl border border-dashed p-6 text-center" style={{ borderColor: 'var(--line)', color: 'var(--mut)' }}>
        Na aucie nie ma jeszcze zamówień. Dołóż je z listy powyżej — ostatni klient na trasie wjeżdża pierwszy.
      </p> : null}
    </div>
  </>
}
