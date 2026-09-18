/**
 * MasowanieHmiPage — stanowisko masowni hali.
 *
 * Układ 1:1 z prototypu 0.9: szyna masownic u góry, pojemniki z przyprawami
 * i kolejka dnia po lewej, panel roboczy po prawej. DWA TORY PRACY, bo maszyna
 * chodzi 50 minut i wiązanie ważenia przypraw z maszyną blokowało robotę na
 * cały cykl:
 *   • PRZYGOTOWANIE — zlecenie + wielkość wsadu → przyprawy odważone do
 *     ponumerowanego pojemnika. Bez maszyny, bez palet, bez wody.
 *   • ZAŁADUNEK — wolna maszyna + pojemnik + mięso + woda → start.
 *
 * W proces wchodzi się WYŁĄCZNIE dwoma kafelkami; zlecenie wskazuje się już
 * w środku. Kolejka dnia po lewej jest tablicą informacyjną — kiedy dało się
 * przez nią wejść w ważenie przypraw, operator gubił się, czym zaczyna robotę.
 *
 * Bramka partii siedzi w `MeatPicker`: gdy biuro wskazało partie w planie
 * masowania, operator widzi całe mięso, ale dotknąć może tylko wskazanego.
 *
 * Wygląd bierze wspólny motyw hali (`hmi-theme`), rama kiosku jest ta sama,
 * co w rozbiorze i produkcji.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { HMI_VARS, HMI_FONT } from '@/features/hmi-theme/vars'
import '@/features/hmi-theme/hmi-font.css'
import { useAuth } from '@/features/auth/AuthContext'
import { masowniaApi } from '@/lib/api'
import { MACHINES, fitsMachine, maszyna as maszynaOId, maszynyDla, minutyWsadu, zapasNadNominalem } from '@/features/masownia/machines'
import { scaleIngredients, waterOf, kgNaWyjsciu, type SpiceItem } from '@/features/masownia/spiceCheck'
import { useMasowniaData, type Charge, type SpiceCart } from '@/features/masownia/useMasowniaData'
import { MachineRail, machineState } from '@/features/masownia/components/MachineRail'
import { DayQueue, type QueueOrder } from '@/features/masownia/components/DayQueue'
import { CartList } from '@/features/masownia/components/CartList'
import { ActionTile, KOLOR_PRZYPRAW, KOLOR_MIESZANIA } from '@/features/masownia/components/ActionTile'
import { DayBar } from '@/features/masownia/components/DayBar'
import { SpiceWeighing } from '@/features/masownia/components/SpiceWeighing'
import { LoadPicker } from '@/features/masownia/components/LoadPicker'
import { MeatPicker, type MeatTake } from '@/features/masownia/components/MeatPicker'
import { plakietkaSurowca } from '@/features/masownia/meatTiles'
import { WaterStep } from '@/features/masownia/components/WaterStep'
import { PickupDialog } from '@/features/masownia/components/PickupDialog'
import { useServiceHold, ServiceMenuModal, serviceSections } from '@/features/deboning/ServiceMenu'

// Wersja kiosku masowni — wstrzykiwana przez Vite (define w vite.config.ts).
declare const __MASOWANIE_VERSION__: string

const hhmm = (d: Date) =>
  `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`

/** Numery pojemników są na stałe 1–6; wolny to taki, który nigdzie nie stoi. */
const WOLNY_POJEMNIK = (zajete: number[]) => [1, 2, 3, 4, 5, 6].find(n => !zajete.includes(n)) ?? null

type Tryb =
  | null
  | { kind: 'prep'; orderId: string; kg: number; cartNo: number }
  | { kind: 'prep-size'; orderId: string }
  | { kind: 'prep-order' }
  | { kind: 'load-pick'; machineId: number | null; cartId: string | null; orderId: string | null }
  | { kind: 'load'; orderId: string; machineId: number; cartId: string | null
      step: 'meat' | 'spices' | 'water'; take: MeatTake[]
      spices: { seq: number; name: string; unit: string; qty: number; weighed: number; manual: boolean }[] }

export function MasowanieHmiPage() {
  const { zlecenia, pojemniki, wsady, mieso, receptury, nastepnePp, error, odswiez } = useMasowniaData()
  const { user } = useAuth()
  const [now, setNow] = useState(() => Date.now())
  const [tryb, setTryb] = useState<Tryb>(null)
  const [odbior, setOdbior] = useState<Charge | null>(null)
  const [zapisuje, setZapisuje] = useState(false)
  const [komunikat, setKomunikat] = useState('')
  // Wejście serwisowe (przytrzymanie tytułu 3 s → kod 0099). Masownia to
  // ODDZIELNY komputer od kiosku rozbioru, a serwisant podpina wagę przy
  // zalogowanym operatorze — samo wejście z ekranu logowania by tu nie pomogło.
  const [menuSerwisowe, setMenuSerwisowe] = useState(false)
  const { holdProps: serviceHoldProps } = useServiceHold(() => setMenuSerwisowe(true))
  const [odwazone, setOdwazone] = useState<Record<number, { weighed: number; manual: boolean }>>({})

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (!komunikat) return
    const t = setTimeout(() => setKomunikat(''), 4000)
    return () => clearTimeout(t)
  }, [komunikat])

  const kgInMachine = useMemo(() => {
    const out: Record<string, number> = {}
    for (const c of wsady) out[c.order_id] = (out[c.order_id] ?? 0) + Number(c.kg_meat || 0)
    return out
  }, [wsady])

  const kgPrepared = useMemo(() => {
    const out: Record<string, number> = {}
    for (const p of pojemniki) out[p.order_id] = (out[p.order_id] ?? 0) + Number(p.kg_target || 0)
    return out
  }, [pojemniki])

  /** Rodzaj surowca partii wskazanych przez biuro — null dla codziennego z/s. */
  const rodzajZlecenia = useCallback((meatLots: { meatLotNo?: string }[] | undefined) => {
    const nazwy = new Set<string>()
    for (const l of meatLots ?? []) {
      const lot = mieso.lots.find((x: any) => String(x.lotNo) === String(l.meatLotNo))
      const p = lot ? plakietkaSurowca(lot.materialName, lot.materialTypeId) : null
      if (p) nazwy.add(p)
    }
    return nazwy.size ? [...nazwy].join(' + ') : null
  }, [mieso.lots])

  const kolejka: QueueOrder[] = useMemo(
    () => zlecenia
      .filter((o: any) => o.status !== 'cancelled')
      .map((o: any) => ({
        id: o.id, orderNo: o.orderNo, recipeName: o.recipeName,
        meatKg: Number(o.meatKg || 0), kgDone: Number(o.kgDone || 0),
        daySeq: o.daySeq, meatLots: o.meatLots ?? [],
        rodzaj: rodzajZlecenia(o.meatLots),
      })),
    [zlecenia, rodzajZlecenia],
  )

  const zlecenie = (id: string | null | undefined) => zlecenia.find((o: any) => o.id === id)
  const skladniki = useCallback((recipeId: string) => {
    const r = receptury.find((x: any) => x.id === recipeId)
    return (r?.ingredients ?? []) as { ingredientName: string; qtyPer100kg: number; unit: string }[]
  }, [receptury])

  const zostaloW = (id: string) => {
    const o = kolejka.find(x => x.id === id)
    if (!o) return 0
    return Math.max(0, o.meatKg - o.kgDone - (kgInMachine[id] ?? 0) - (kgPrepared[id] ?? 0))
  }

  const doOdbioru = wsady.filter(c => machineState(c, now) === 'ready')
  const wolneMaszyny = MACHINES.filter(m => !wsady.some(c => c.machine_id === m.id))
  const nastepne = kolejka.find(o => zostaloW(o.id) > 0)

  // Średni cykl receptur, które ZOSTAŁY do zrobienia — ważony kilogramami.
  // Dzień na samych „yaprakach" kończy się realnie wcześniej niż dzień na
  // standardzie i prognoza ma to widzieć.
  const sredniCykl = useMemo(() => {
    let kg = 0, minuty = 0
    for (const o of kolejka) {
      const zostalo = Math.max(0, o.meatKg - o.kgDone)
      if (zostalo <= 0) continue
      const r = receptury.find((x: any) => x.id === (zlecenia.find((z: any) => z.id === o.id)?.recipeId))
      kg += zostalo
      minuty += zostalo * minutyWsadu({ mix_minutes: r?.mixingMinutes })
    }
    return kg > 0 ? minuty / kg : undefined
  }, [kolejka, receptury, zlecenia])

  const planKg = kolejka.reduce((s, o) => s + o.meatKg, 0)
  const zrobioneKg = kolejka.reduce((s, o) => s + o.kgDone, 0)
  // Słownictwo hali: „mięso na magazynie" w KILOGRAMACH, nie „palety wolne".
  const miesoKg = Math.round(
    mieso.pallets.reduce((s, p) => s + Math.max(0, p.kgNet - (mieso.taken[p.id] ?? 0)), 0),
  )

  // ── Tor 1: przyprawy ────────────────────────────────────────────────────
  const zacznijPrzyprawy = (orderId: string) => {
    setOdwazone({})
    setTryb({ kind: 'prep-size', orderId })
  }

  const wybierzWielkosc = (orderId: string, kgWsadu: number) => {
    const cartNo = WOLNY_POJEMNIK(pojemniki.map(p => p.cart_no))
    if (cartNo === null) {
      setKomunikat('Wszystkie sześć pojemników jest zajętych — wsyp któryś do maszyny.')
      return
    }
    // Pojemnik POWSTAJE DOPIERO po zatwierdzeniu całego ważenia (`zamknijPojemnik`).
    // Wcześniej zakładaliśmy go tutaj i wystarczyło wejść na ekran i wyjść, żeby
    // w „Przygotowanych przyprawach" pojawił się pojemnik, którego nikt nie ważył.
    setOdwazone({})
    setTryb({ kind: 'prep', orderId, kg: kgWsadu, cartNo })
  }

  /** Zatwierdzenie CAŁEGO ważenia: dopiero teraz pojemnik trafia do bazy. */
  const zamknijPojemnik = async () => {
    if (tryb?.kind !== 'prep') return
    const pozycje = scaleIngredients(skladniki(zlecenie(tryb.orderId)?.recipeId ?? ''), tryb.kg)
    const komplet = pozycje.every(i => odwazone[i.seq] !== undefined)
    if (!komplet) {
      setKomunikat('Najpierw odważ wszystkie składniki.')
      return
    }
    setZapisuje(true)
    try {
      await masowniaApi.createCart({
        orderId: tryb.orderId, cartNo: tryb.cartNo, kgTarget: tryb.kg,
        ingredients: pozycje.map(i => ({
          seq: i.seq, name: i.name, unit: i.unit, qty: i.qty,
          weighed: odwazone[i.seq]?.weighed ?? 0, manual: odwazone[i.seq]?.manual ?? false,
        })),
      })
      setTryb(null)
      setOdwazone({})
      odswiez()
      setKomunikat(`Pojemnik ${tryb.cartNo} gotowy — odstaw go przy masownicy.`)
    } catch (e: any) {
      setKomunikat(e?.message ?? 'Nie udało się zapisać pojemnika')
    } finally {
      setZapisuje(false)
    }
  }

  const zapiszSkladnik = (item: SpiceItem, kgOdczyt: number, recznie: boolean) => {
    // Odczyty żyją w panelu do czasu zatwierdzenia całości. Wyjście z ekranu
    // w połowie ważenia ma NIE zostawiać śladu — hala wyraźnie tego chciała.
    setOdwazone(p => ({ ...p, [item.seq]: { weighed: kgOdczyt, manual: recznie } }))
  }

  // ── Tor 2: załadunek ────────────────────────────────────────────────────
  const wybierzMaszyne = (machineId: number, charge: Charge | undefined) => {
    if (charge) {
      if (machineState(charge, now) === 'ready') setOdbior(charge)
      return
    }
    setTryb({ kind: 'load-pick', machineId, cartId: null, orderId: null })
  }

  const zaladujZPojemnika = (cart: SpiceCart) => {
    const maszyna = wolneMaszyny.find(m => fitsMachine(Number(cart.kg_target), m.id))
    if (!maszyna) {
      setKomunikat('Nie ma wolnej masownicy na ten wsad — poczekaj na koniec cyklu.')
      return
    }
    setTryb({ kind: 'load-pick', machineId: maszyna.id, cartId: cart.id, orderId: cart.order_id })
  }

  const wyslijWsad = async (litry: number) => {
    if (tryb?.kind !== 'load') return
    setZapisuje(true)
    try {
      await masowniaApi.load({
        orderId: tryb.orderId, machineId: tryb.machineId, cartId: tryb.cartId,
        waterL: litry, meat: tryb.take, spices: tryb.spices,
      })
      setTryb(null)
      odswiez()
      setKomunikat(`Masownica ${tryb.machineId} ruszyła.`)
    } catch (e: any) {
      setKomunikat(e?.message ?? 'Nie udało się załadować masownicy')
    } finally {
      setZapisuje(false)
    }
  }

  const zatwierdzOdbior = async (kgOutput: number) => {
    if (!odbior) return
    setZapisuje(true)
    try {
      await masowniaApi.finish(odbior.id, kgOutput)
      setOdbior(null)
      odswiez()
      setKomunikat('Wsad odebrany i zapisany.')
    } catch (e: any) {
      setKomunikat(e?.message ?? 'Nie udało się zapisać odbioru')
    } finally {
      setZapisuje(false)
    }
  }

  return (
    <div data-testid="masowanie-hmi"
      style={{ ...HMI_VARS, fontFamily: HMI_FONT, height: '100%', background: 'var(--bg)' }}
      className="flex flex-col overflow-hidden relative">

      <header className="shrink-0 h-[76px] flex items-center gap-5 px-6"
        style={{ background: 'var(--barBg)', borderBottom: '1px solid var(--line)' }}>
        <div {...serviceHoldProps} style={{ touchAction: 'manipulation' }}>
          <div className="text-xl font-extrabold uppercase leading-none tracking-tight">Masowanie</div>
          <div className="hmi-v10-mono text-[10px] font-bold uppercase tracking-[0.14em] mt-1.5"
            style={{ color: 'var(--mut)' }}>
            Masownia
          </div>
        </div>
        <Chip label="Plan dnia" value={`${Math.round(zrobioneKg)} / ${Math.round(planKg)} kg`} />
        <Chip label="Zlecenia" value={String(kolejka.length)} />
        <Chip label="Mięso na magazynie" value={`${miesoKg} kg`} />
        <Chip label="Operator" value={(user?.name ?? '—').split(' ')[0]} accent />
        <div className="flex-1" />
        <div className="hmi-v10-mono text-[26px] font-bold tracking-tight">{hhmm(new Date(now))}</div>
      </header>

      <MachineRail charges={wsady} now={now} wyjscieKg={c => oczekiwaneKg(c, receptury)} onPick={wybierzMaszyne}
        pickedMachine={tryb?.kind === 'load' ? tryb.machineId : null} />

      <main className="flex-1 min-h-0 flex gap-3 p-3 px-6">
        <aside className="w-[498px] shrink-0 flex flex-col gap-3 min-h-0">
          <Card title="Przygotowane przyprawy" className="shrink-0 max-h-[296px]"
            right={pojemniki.length
              ? `${pojemniki.length} × pojemnik · ${Math.round(pojemniki.reduce((s, p) => s + Number(p.kg_target || 0), 0))} kg`
              : 'brak'}>
            <CartList carts={pojemniki}
              selectedId={tryb?.kind === 'load' ? tryb.cartId : null}
              onPick={id => {
                const c = pojemniki.find(p => p.id === id)
                if (c) zaladujZPojemnika(c)
              }} />
          </Card>
          <Card title="Kolejka dnia" className="flex-1"
            right={`${Math.round(zrobioneKg)} / ${Math.round(planKg)} kg`}>
            <DayQueue orders={kolejka} kgInMachine={kgInMachine} kgPrepared={kgPrepared}
              selectedId={tryb && 'orderId' in tryb ? tryb.orderId : null} />
          </Card>
        </aside>

        <section className="flex-1 min-w-0 flex flex-col min-h-0 rounded-xl overflow-hidden relative"
          style={{ background: 'var(--panel)', border: '1px solid var(--line)' }}>

          {tryb === null ? (
            <RestScreen doOdbioru={doOdbioru} wolneMaszyny={wolneMaszyny}
              pojemnikiGotowe={pojemniki.length} nastepne={nastepne?.recipeName ?? ''}
              onPrzyprawy={() => setTryb({ kind: 'prep-order' })}
              onZaladunek={() => setTryb({
                kind: 'load-pick',
                machineId: wolneMaszyny.length === 1 ? wolneMaszyny[0].id : null,
                cartId: null, orderId: null,
              })}
              onOdbierz={() => doOdbioru[0] && setOdbior(doOdbioru[0])} />
          ) : null}

          {tryb?.kind === 'load-pick' ? (
            <LoadPicker
              carts={pojemniki}
              orders={kolejka.filter(o => zostaloW(o.id) > 0).map(o => ({ ...o, zostalo: zostaloW(o.id) }))}
              zajeteMaszyny={wsady.map(c => c.machine_id)}
              machineId={tryb.machineId}
              cartId={tryb.cartId}
              orderId={tryb.orderId}
              onMachine={id => setTryb({ ...tryb, machineId: id })}
              onCart={c => setTryb({ ...tryb, cartId: c.id, orderId: c.order_id })}
              onOrder={id => setTryb({ ...tryb, cartId: null, orderId: id })}
              onBack={() => setTryb(null)}
              onNext={() => {
                if (!tryb.machineId || !tryb.orderId) return
                setTryb({
                  kind: 'load', orderId: tryb.orderId, machineId: tryb.machineId,
                  cartId: tryb.cartId, step: 'meat', take: [], spices: [],
                })
              }} />
          ) : null}

          {tryb?.kind === 'prep-order' ? (
            <OrderScreen
              orders={kolejka.map(o => ({ ...o, zostalo: zostaloW(o.id) }))}
              onBack={() => setTryb(null)}
              onPick={zacznijPrzyprawy} />
          ) : null}

          {tryb?.kind === 'prep-size' ? (
            <SizeScreen
              recepturaNazwa={zlecenie(tryb.orderId)?.recipeName ?? ''}
              zostalo={zostaloW(tryb.orderId)}
              busy={zapisuje}
              onBack={() => setTryb(null)}
              onPick={kgWsadu => wybierzWielkosc(tryb.orderId, kgWsadu)} />
          ) : null}

          {tryb?.kind === 'prep' ? (
            <SpiceWeighing
              items={scaleIngredients(skladniki(zlecenie(tryb.orderId)?.recipeId ?? ''), tryb.kg)}
              weighed={odwazone}
              cartNo={tryb.cartNo}
              onWeigh={zapiszSkladnik}
              onDone={zamknijPojemnik}
              onBack={() => { setTryb(null); setOdwazone({}) }} />
          ) : null}

          {tryb?.kind === 'load' && tryb.step === 'meat' ? (
            <MeatPicker
              meat={mieso}
              orderId={tryb.orderId}
              orderLots={(zlecenie(tryb.orderId)?.meatLots ?? []) as { meatLotNo: string }[]}
              targetKg={tryb.cartId
                ? Number(pojemniki.find(p => p.id === tryb.cartId)?.kg_target ?? 0)
                : Math.min(zostaloW(tryb.orderId), maszynaOId(tryb.machineId)?.cap ?? 0)}
              maxKg={maszynaOId(tryb.machineId)?.max ?? 0}
              receptura={skladniki(zlecenie(tryb.orderId)?.recipeId ?? '')}
              nastepnePp={nastepnePp}
              onBack={() => setTryb(null)}
              onConfirm={take => setTryb({ ...tryb, step: tryb.cartId ? 'water' : 'spices', take })} />
          ) : null}

          {tryb?.kind === 'load' && tryb.step === 'spices' ? (
            <SpiceWeighing
              items={scaleIngredients(
                skladniki(zlecenie(tryb.orderId)?.recipeId ?? ''),
                tryb.take.reduce((s, t) => s + t.kg, 0))}
              weighed={odwazone}
              cartNo={0}
              przyMaszynie
              onWeigh={zapiszSkladnik}
              onDone={() => {
                const pozycje = scaleIngredients(
                  skladniki(zlecenie(tryb.orderId)?.recipeId ?? ''),
                  tryb.take.reduce((s, t) => s + t.kg, 0))
                setTryb({
                  ...tryb, step: 'water',
                  spices: pozycje.map(i => ({
                    seq: i.seq, name: i.name, unit: i.unit, qty: i.qty,
                    weighed: odwazone[i.seq]?.weighed ?? 0,
                    manual: odwazone[i.seq]?.manual ?? false,
                  })),
                })
              }}
              onBack={() => setTryb({ ...tryb, step: 'meat' })} />
          ) : null}

          {tryb?.kind === 'load' && tryb.step === 'water' ? (
            <WaterStep
              targetL={waterOf(
                skladniki(zlecenie(tryb.orderId)?.recipeId ?? ''),
                tryb.take.reduce((s, t) => s + t.kg, 0),
              )}
              onBack={() => setTryb({ ...tryb, step: 'meat' })}
              onDone={wyslijWsad} />
          ) : null}
        </section>
      </main>

      <DayBar planKg={planKg} doneKg={zrobioneKg}
        inMachineKg={wsady.reduce((s, c) => s + Number(c.kg_meat || 0), 0)}
        preparedKg={pojemniki.reduce((s, p) => s + Number(p.kg_target || 0), 0)}
        meatKg={miesoKg} now={now} minutyCyklu={sredniCykl} />

      {odbior ? (
        <PickupDialog charge={odbior} busy={zapisuje}
          expectedKg={oczekiwaneKg(odbior, receptury)}
          onConfirm={zatwierdzOdbior}
          onClose={() => setOdbior(null)} />
      ) : null}

      {komunikat ? (
        <div className="absolute left-1/2 -translate-x-1/2 bottom-6 z-[60] rounded-[10px] py-3.5 px-6 text-base font-extrabold"
          style={{ background: 'var(--panel)', border: '1px solid var(--line)', boxShadow: '0 8px 24px -8px rgba(0,0,0,.25)' }}>
          {komunikat}
        </div>
      ) : null}

      {error ? (
        <div className="shrink-0 px-6 py-2 text-sm font-bold"
          style={{ background: 'var(--redSoft)', color: 'var(--red)', borderTop: '1px solid var(--redLine)' }}>
          Brak łączności z serwerem MES — dane mogą być nieaktualne.
        </div>
      ) : null}

      {/* Bez drukarki etykiet i wzorów podpisów — przy masownicach nie ma ani
          drukarki, ani księgi HACCP; zostaje diagnostyka wagi, cofnięcie
          wersji i wyjście do Windows. */}
      <ServiceMenuModal open={menuSerwisowe} onClose={() => setMenuSerwisowe(false)}
        channel="masowanie" version={__MASOWANIE_VERSION__}
        buildLabel={`Masowanie · ${__MASOWANIE_VERSION__}`}
        sections={serviceSections('masowanie')} />
    </div>
  )
}

/** Ile wyrobu POWINNO wyjść z wsadu wg receptury — punkt odniesienia przy odbiorze. */
function oczekiwaneKg(charge: Charge, receptury: any[]): number {
  const r = receptury.find((x: any) => x.id === charge.recipe_id)
  return kgNaWyjsciu(Number(charge.kg_meat || 0), r?.ingredients ?? [])
}

function Chip({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex flex-col justify-center pl-5 shrink-0" style={{ borderLeft: '1px solid var(--lineSoft)' }}>
      <span className="text-[9px] font-bold uppercase tracking-[0.14em] leading-none mb-1.5"
        style={{ color: 'var(--mut)' }}>{label}</span>
      <b className="hmi-v10-mono text-sm font-bold leading-tight"
        style={accent ? { color: 'var(--accent)' } : undefined}>{value}</b>
    </div>
  )
}

function Card({ title, right, className, children }: {
  title: string; right?: string; className?: string; children: React.ReactNode
}) {
  return (
    <div className={`flex flex-col min-h-0 overflow-hidden rounded-xl ${className ?? ''}`}
      style={{ background: 'var(--panel)', border: '1px solid var(--line)' }}>
      <div className="shrink-0 h-11 flex items-center gap-2.5 px-4"
        style={{ background: 'var(--bg)', borderBottom: '1px solid var(--line)' }}>
        <h2 className="m-0 text-[11px] font-extrabold uppercase tracking-[0.1em]" style={{ color: 'var(--mut)' }}>
          {title}
        </h2>
        {right ? (
          <span className="ml-auto hmi-v10-mono text-[13px] font-bold" style={{ color: 'var(--mut)' }}>{right}</span>
        ) : null}
      </div>
      {children}
    </div>
  )
}

/**
 * Wybór zlecenia dla toru przypraw.
 *
 * Wcześniej kafelek „Przygotuj przyprawy" brał PIERWSZE zlecenie z kolejki, a
 * inne wybierało się klikając wiersz po lewej — i to było drugie wejście
 * w proces, które myliło halę (właściciel, 18.09.2026). Teraz zlecenie wskazuje
 * się tutaj, dokładnie tak jak przy załadunku masownicy.
 */
function OrderScreen({ orders, onPick, onBack }: {
  orders: (QueueOrder & { zostalo: number })[]
  onPick: (orderId: string) => void
  onBack: () => void
}) {
  return (
    <>
      <div className="shrink-0 flex items-center gap-4 p-3 px-4" style={{ borderBottom: '1px solid var(--line)' }}>
        <button type="button" onClick={onBack} className="text-sm font-extrabold" style={{ color: 'var(--accent)' }}>
          ← Wróć
        </button>
        <span className="text-[22px] font-extrabold tracking-tight">Na które zlecenie ważysz przyprawy?</span>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-4">
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
          {orders.map(o => {
            const wolne = o.zostalo > 0
            return (
              <button key={o.id} type="button" disabled={!wolne} onClick={() => onPick(o.id)}
                className="rounded-xl p-4 text-left flex flex-col gap-2 min-h-[132px]"
                style={{
                  background: 'var(--panel)',
                  border: `2px solid ${wolne ? 'var(--line)' : 'var(--lineSoft)'}`,
                  opacity: wolne ? 1 : 0.45,
                  cursor: wolne ? 'pointer' : 'not-allowed',
                }}>
                <span className="flex items-center gap-2">
                  <span className="text-[19px] font-extrabold leading-none truncate">{o.recipeName}</span>
                  {o.rodzaj ? (
                    <span className="shrink-0 text-[10px] font-extrabold uppercase tracking-wider px-1.5 py-0.5 rounded"
                      style={{ background: 'var(--accentSoft)', color: 'var(--accent)', border: '1px solid var(--accent)' }}>
                      {o.rodzaj}
                    </span>
                  ) : null}
                </span>
                <span className="hmi-v10-mono text-[11px] font-semibold" style={{ color: 'var(--mut)' }}>
                  {o.orderNo}
                </span>
                <span className="mt-auto hmi-v10-mono text-[26px] font-bold leading-none">
                  {Math.round(o.zostalo)}
                  <small className="text-xs font-semibold ml-1.5" style={{ color: 'var(--mut)' }}>kg do rozpisania</small>
                </span>
                {!wolne ? (
                  <span className="text-xs font-extrabold uppercase tracking-wider" style={{ color: 'var(--success)' }}>
                    Całe rozpisane
                  </span>
                ) : null}
              </button>
            )
          })}
          {orders.length === 0 ? (
            <div className="p-4 text-center text-[13px] font-semibold rounded-[10px] col-span-full"
              style={{ color: 'var(--mut)', border: '1.5px dashed var(--line)' }}>
              Biuro nie zaplanowało masowania na dziś.
            </div>
          ) : null}
        </div>
      </div>
    </>
  )
}

/** Wielkość wsadu, na którą ważymy przyprawy. Pokazujemy NOMINALNE wielkości
 *  masownic — cichy zapas zostaje niewidoczny, żeby nie stał się normą. */
function SizeScreen({ recepturaNazwa, zostalo, busy, onPick, onBack }: {
  recepturaNazwa: string
  zostalo: number
  busy: boolean
  onPick: (kg: number) => void
  onBack: () => void
}) {
  const rozmiary = [...new Set(MACHINES.map(m => m.cap))]
    .sort((a, b) => b - a)
    .filter(x => x <= zostalo + zapasNadNominalem(x))

  // Reszta zlecenia jako OSOBNY kafelek. Biuro planuje ilości, których nie ma
  // w żadnym nominale (507 kg fileta, 440 kg z/s) — bez tego kafelka takiego
  // wsadu nie da się odważyć w ogóle, bo przyprawy liczy się na konkretne kg
  // (właściciel, 18.09.2026). Pokazujemy tylko wtedy, gdy to JEDEN wsad:
  // ponad granicę największej masownicy zlecenie trzeba i tak rozbić.
  const reszta = Math.round(zostalo * 10) / 10
  const maszynyReszty = maszynyDla(reszta)
  const pokazReszte = reszta > 0 && maszynyReszty.length > 0 && !rozmiary.includes(reszta)
  const kgTekst = (n: number) => `${Math.round(n * 10) / 10}`.replace('.', ',')

  return (
    <>
      <div className="shrink-0 flex items-center gap-4 p-3 px-4" style={{ borderBottom: '1px solid var(--line)' }}>
        <button type="button" onClick={onBack} className="text-sm font-extrabold" style={{ color: 'var(--accent)' }}>
          ← Wróć
        </button>
        <span className="text-[22px] font-extrabold tracking-tight">{recepturaNazwa}</span>
        <div className="flex-1" />
        <span className="text-[15px] font-bold" style={{ color: 'var(--mut)' }}>
          nierozpisane <b className="hmi-v10-mono text-xl" style={{ color: 'var(--ink)' }}>{Math.round(zostalo)} kg</b>
        </span>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-4">
        <div className="flex items-center gap-2.5 py-2.5 px-3.5 rounded-[9px] mb-3 text-[13px] font-bold"
          style={{ background: 'var(--accentSoft)', color: 'var(--accent)' }}>
          Przyprawy ważysz na konkretną wielkość wsadu — wybierz taką, jaka wejdzie do maszyny.
        </div>
        <div className="grid grid-cols-3 gap-3">
          {rozmiary.map(x => (
            <button key={x} type="button" disabled={busy} onClick={() => onPick(x)}
              className="rounded-xl p-4 text-left flex flex-col gap-1.5 min-h-[128px]"
              style={{ background: 'var(--panel)', border: '2px solid var(--line)' }}>
              <span className="hmi-v10-mono text-[38px] font-bold leading-none tracking-tighter">{x} kg</span>
              <span className="hmi-v10-mono text-xs font-semibold" style={{ color: 'var(--mut)' }}>
                masownica {MACHINES.filter(m => m.cap === x).map(m => m.id).join(' lub ')}
              </span>
              <span className="mt-auto text-xs font-extrabold uppercase tracking-wider"
                style={{ color: x <= zostalo ? 'var(--success)' : 'var(--mut)' }}>
                {x <= zostalo ? 'Mieści się w zleceniu' : 'Ponad resztę zlecenia'}
              </span>
            </button>
          ))}
          {pokazReszte ? (
            <button type="button" disabled={busy} onClick={() => onPick(reszta)}
              className="rounded-xl p-4 text-left flex flex-col gap-1.5 min-h-[128px]"
              style={{ background: 'var(--accentSoft)', border: '2px solid var(--accent)' }}>
              <span className="hmi-v10-mono text-[38px] font-bold leading-none tracking-tighter"
                style={{ color: 'var(--accent)' }}>
                {kgTekst(reszta)} kg
              </span>
              <span className="hmi-v10-mono text-xs font-semibold" style={{ color: 'var(--mut)' }}>
                masownica {maszynyReszty.join(' lub ')}
              </span>
              <span className="mt-auto text-xs font-extrabold uppercase tracking-wider"
                style={{ color: 'var(--accent)' }}>
                Reszta zlecenia
              </span>
            </button>
          ) : null}
          {rozmiary.length === 0 && !pokazReszte ? (
            <div className="p-4 text-center text-[13px] font-semibold rounded-[10px] col-span-full"
              style={{ color: 'var(--mut)', border: '1.5px dashed var(--line)' }}>
              To zlecenie jest już całe rozpisane.
            </div>
          ) : null}
        </div>
      </div>
    </>
  )
}

/** Spoczynek — co teraz zrobić. Dwa tory pracy i wołanie o odbiór. */
function RestScreen({ doOdbioru, wolneMaszyny, pojemnikiGotowe, nastepne, onPrzyprawy, onZaladunek, onOdbierz }: {
  doOdbioru: Charge[]
  wolneMaszyny: { id: number; cap: number }[]
  pojemnikiGotowe: number
  nastepne: string
  onPrzyprawy: () => void
  onZaladunek: () => void
  onOdbierz: () => void
}) {
  return (
    <div className="flex-1 min-h-0 flex flex-col gap-4 p-5 justify-center">
      {doOdbioru.length ? (
        <div className="flex flex-col items-center gap-1.5 px-9 py-5 rounded-2xl min-w-[440px]"
          style={{ background: 'var(--successSoft)', border: '1.5px solid var(--successLine)' }}>
          <span className="text-[10px] font-extrabold uppercase tracking-[0.14em]" style={{ color: 'var(--success)' }}>
            Najpierw odbierz
          </span>
          <span className="text-[23px] font-extrabold" style={{ color: 'var(--success)' }}>
            Masownica {doOdbioru.map(c => c.machine_id).join(' i ')} — gotowe
          </span>
          <span className="text-[15px] leading-relaxed" style={{ color: 'var(--mut)' }}>
            {doOdbioru.map(c => `partia ${c.batch_no || '—'} · ${Math.round(c.kg_meat)} kg`).join(' · ')}
          </span>
          <button type="button" onClick={onOdbierz}
            className="h-[60px] px-7 rounded-[10px] text-lg font-extrabold mt-3"
            style={{ background: 'var(--success)', color: '#fff' }}>
            Odbierz z masownicy {doOdbioru[0].machine_id}
          </button>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-5 w-full shrink-0" style={{ height: '62%' }}>
        <ActionTile
          title="Przygotuj przyprawy"
          lead="Odważ przyprawy na następny wsad do ponumerowanego pojemnika. Masownice mogą przy tym spokojnie chodzić — to robota na te 50 minut."
          foot={nastepne ? `Następne w kolejce: ${nastepne}` : 'Cały plan dnia jest rozpisany'}
          color={KOLOR_PRZYPRAW}
          disabled={!nastepne}
          onClick={onPrzyprawy} />
        <ActionTile
          title="Załaduj masownicę"
          lead={wolneMaszyny.length
            ? 'Wskaż masownicę i wsad, dołóż mięso i zadaj wodę. Po zatwierdzeniu maszyna rusza na 50 minut.'
            : 'Wszystkie trzy masownice pracują. Wykorzystaj ten czas na przyprawy do następnych wsadów.'}
          foot={wolneMaszyny.length
            ? `Wolne masownice: ${wolneMaszyny.map(m => m.id).join(', ')}${
                pojemnikiGotowe ? ` · przyprawy czekają w ${pojemnikiGotowe === 1 ? 'pojemniku' : 'pojemnikach'}` : ''}`
            : ''}
          color={KOLOR_MIESZANIA}
          disabled={!wolneMaszyny.length}
          onClick={onZaladunek} />
      </div>
    </div>
  )
}
