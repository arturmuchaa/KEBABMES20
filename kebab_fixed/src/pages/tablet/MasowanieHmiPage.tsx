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
 * Wygląd bierze wspólny motyw hali (`hmi-theme`), rama kiosku jest ta sama,
 * co w rozbiorze i produkcji.
 */
import { useEffect, useMemo, useState } from 'react'
import { HMI_VARS, HMI_FONT } from '@/features/hmi-theme/vars'
import '@/features/hmi-theme/hmi-font.css'
import { useAuth } from '@/features/auth/AuthContext'
import { MACHINES } from '@/features/masownia/machines'
import { useMasowniaData, type Charge } from '@/features/masownia/useMasowniaData'
import { MachineRail, machineState } from '@/features/masownia/components/MachineRail'
import { DayQueue, type QueueOrder } from '@/features/masownia/components/DayQueue'
import { CartList } from '@/features/masownia/components/CartList'

const hhmm = (d: Date) =>
  `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`

export function MasowanieHmiPage() {
  const { zlecenia, pojemniki, wsady, mieso, error } = useMasowniaData()
  const auth = useAuth() as any
  const [now, setNow] = useState(() => Date.now())
  const [orderId, setOrderId] = useState<string | null>(null)
  const [cartId, setCartId] = useState<string | null>(null)

  // Zegar i odliczanie masownic — sekunda wystarczy, bo cykl ma 50 minut.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

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

  const kolejka: QueueOrder[] = useMemo(
    () => zlecenia
      .filter((o: any) => o.status !== 'cancelled')
      .map((o: any) => ({
        id: o.id, orderNo: o.orderNo, recipeName: o.recipeName,
        meatKg: Number(o.meatKg || 0), kgDone: Number(o.kgDone || 0),
        daySeq: o.daySeq, meatLots: o.meatLots ?? [],
      })),
    [zlecenia],
  )

  const doOdbioru = wsady.filter(c => machineState(c, now) === 'ready')
  const wolneMaszyny = MACHINES.filter(m => !wsady.some(c => c.machine_id === m.id))
  const nastepne = kolejka.find(o =>
    o.meatKg - o.kgDone - (kgInMachine[o.id] ?? 0) - (kgPrepared[o.id] ?? 0) > 0)

  const planKg = kolejka.reduce((s, o) => s + o.meatKg, 0)
  const zrobioneKg = kolejka.reduce((s, o) => s + o.kgDone, 0)
  // Słownictwo hali: „mięso na magazynie" w KILOGRAMACH, nie „palety wolne".
  const miesoKg = Math.round(
    mieso.pallets.reduce((s, p) => s + Math.max(0, p.kgNet - (mieso.taken[p.id] ?? 0)), 0),
  )

  return (
    <div data-testid="masowanie-hmi"
      style={{ ...HMI_VARS, fontFamily: HMI_FONT, height: '100%', background: 'var(--bg)' }}
      className="flex flex-col overflow-hidden">

      <header className="shrink-0 h-[76px] flex items-center gap-5 px-6"
        style={{ background: 'var(--barBg)', borderBottom: '1px solid var(--line)' }}>
        <div>
          <div className="text-xl font-extrabold uppercase leading-none tracking-tight">Masowanie</div>
          <div className="hmi-v10-mono text-[10px] font-bold uppercase tracking-[0.14em] mt-1.5"
            style={{ color: 'var(--mut)' }}>
            Masownia
          </div>
        </div>
        <Chip label="Plan dnia" value={`${Math.round(zrobioneKg)} / ${Math.round(planKg)} kg`} />
        <Chip label="Zlecenia" value={String(kolejka.length)} />
        <Chip label="Mięso na magazynie" value={`${miesoKg} kg`} />
        <Chip label="Operator" value={auth?.user?.fullName ?? '—'} accent />
        <div className="flex-1" />
        <div className="hmi-v10-mono text-[26px] font-bold tracking-tight">{hhmm(new Date(now))}</div>
      </header>

      <MachineRail charges={wsady} now={now} onPick={() => undefined} />

      <main className="flex-1 min-h-0 flex gap-3 p-3 px-6">
        <aside className="w-[498px] shrink-0 flex flex-col gap-3 min-h-0">
          <Card title="Przygotowane przyprawy" className="shrink-0 max-h-[296px]"
            right={pojemniki.length
              ? `${pojemniki.length} × pojemnik · ${Math.round(pojemniki.reduce((s, p) => s + Number(p.kg_target || 0), 0))} kg`
              : 'brak'}>
            <CartList carts={pojemniki} selectedId={cartId} onPick={setCartId} />
          </Card>
          <Card title="Kolejka dnia" className="flex-1"
            right={`${Math.round(zrobioneKg)} / ${Math.round(planKg)} kg`}>
            <DayQueue orders={kolejka} kgInMachine={kgInMachine} kgPrepared={kgPrepared}
              selectedId={orderId} onPick={setOrderId} />
          </Card>
        </aside>

        <section className="flex-1 min-w-0 flex flex-col min-h-0 rounded-xl overflow-hidden"
          style={{ background: 'var(--panel)', border: '1px solid var(--line)' }}>
          <RestScreen doOdbioru={doOdbioru} wolneMaszyny={wolneMaszyny.map(m => m)}
            pojemnikiGotowe={pojemniki.length} nastepne={nastepne?.recipeName ?? ''} />
        </section>
      </main>

      {error ? (
        <div className="shrink-0 px-6 py-2 text-sm font-bold"
          style={{ background: 'var(--redSoft)', color: 'var(--red)', borderTop: '1px solid var(--redLine)' }}>
          Brak łączności z serwerem MES — dane mogą być nieaktualne.
        </div>
      ) : null}
    </div>
  )
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

/** Spoczynek — co teraz zrobić. Dwa tory pracy i wołanie o odbiór. */
function RestScreen({ doOdbioru, wolneMaszyny, pojemnikiGotowe, nastepne }: {
  doOdbioru: Charge[]
  wolneMaszyny: { id: number; cap: number }[]
  pojemnikiGotowe: number
  nastepne: string
}) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 p-5 text-center">
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
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-4 w-full max-w-[900px]">
        <Fork title="Przygotuj przyprawy"
          desc="Odważ przyprawy na następny wsad do ponumerowanego pojemnika. Maszyny mogą przy tym spokojnie chodzić — to robota na te 50 minut."
          cta={nastepne ? `Następne: ${nastepne}` : 'Cały plan rozpisany'}
          disabled={!nastepne} />
        <Fork title="Załaduj masownicę"
          desc={wolneMaszyny.length
            ? `Wolne: ${wolneMaszyny.map(m => `${m.id} (${m.cap} kg)`).join(', ')}. ${
                pojemnikiGotowe
                  ? 'Przyprawy czekają w pojemniku — zostaje wjechać paletami i zadać wodę.'
                  : 'Nie ma gotowych przypraw — odważysz je przy maszynie.'}`
            : 'Wszystkie trzy masownice pracują. Wykorzystaj czas na przyprawy.'}
          cta={wolneMaszyny.length ? 'Wybierz wsad' : 'Brak wolnej maszyny'}
          disabled={!wolneMaszyny.length} />
      </div>
    </div>
  )
}

function Fork({ title, desc, cta, disabled }: {
  title: string; desc: string; cta: string; disabled?: boolean
}) {
  return (
    <button type="button" disabled={disabled}
      className="rounded-2xl p-6 text-left flex flex-col gap-2 min-h-[220px]"
      style={{
        background: 'var(--panel)', border: '2px solid var(--line)',
        opacity: disabled ? 0.42 : 1, cursor: disabled ? 'not-allowed' : 'pointer',
      }}>
      <span className="text-2xl font-extrabold tracking-tight">{title}</span>
      <span className="text-sm leading-relaxed" style={{ color: 'var(--mut)' }}>{desc}</span>
      <span className="mt-auto text-sm font-extrabold uppercase tracking-wider"
        style={{ color: disabled ? 'var(--mut)' : 'var(--accent)' }}>{cta} →</span>
    </button>
  )
}
