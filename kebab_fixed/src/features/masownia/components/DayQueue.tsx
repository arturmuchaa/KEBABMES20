/**
 * Kolejka dnia — zlecenia masowania w kolejności planu biura.
 *
 * Operator widzi na wierszu to, co mu potrzebne do decyzji: recepturę, ile
 * z tego zrobione, i gdzie stoją kilogramy — w maszynie czy w pojemniku
 * z przyprawami. Zlecenie, które ma partie wskazane przez biuro, niesie to
 * na wierszu: przy załadunku i tak zobaczy tylko te partie.
 */
export interface QueueOrder {
  id: string
  orderNo: string
  recipeName: string
  meatKg: number
  kgDone: number
  daySeq?: number
  meatLots?: { meatLotNo: string }[]
}

const ETYKIETA = {
  done:     { text: 'Gotowe',            bg: 'var(--successSoft)', fg: 'var(--success)', line: 'var(--successLine)' },
  machine:  { text: 'W masownicy',       bg: 'var(--ambSoft)',     fg: 'var(--amb)',     line: 'var(--ambLine)' },
  prepared: { text: 'Przyprawy gotowe',  bg: 'var(--accentSoft)',  fg: 'var(--accent)',  line: '#C7CCFB' },
  running:  { text: 'W trakcie',         bg: 'var(--accentSoft)',  fg: 'var(--accent)',  line: '#C7CCFB' },
  queued:   { text: 'W kolejce',         bg: 'var(--bg)',          fg: 'var(--mut)',     line: 'var(--line)' },
} as const

export function DayQueue({ orders, kgInMachine, kgPrepared, selectedId, onPick }: {
  orders: QueueOrder[]
  /** Kilogramy zlecenia stojące w maszynach: orderId → kg. */
  kgInMachine: Record<string, number>
  /** Kilogramy zlecenia czekające w pojemnikach: orderId → kg. */
  kgPrepared: Record<string, number>
  selectedId?: string | null
  onPick: (orderId: string) => void
}) {
  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-3 flex flex-col gap-2">
      {orders.length === 0 ? (
        <div className="p-4 text-center text-[13px] font-semibold rounded-[10px]"
          style={{ color: 'var(--mut)', border: '1.5px dashed var(--line)' }}>
          Biuro nie zaplanowało masowania na dziś.
        </div>
      ) : null}
      {orders.map(o => {
        const wMaszynie = kgInMachine[o.id] ?? 0
        const wPojemniku = kgPrepared[o.id] ?? 0
        const gotowe = o.kgDone >= o.meatKg - 0.1
        const stan = gotowe ? ETYKIETA.done
          : wMaszynie > 0 ? ETYKIETA.machine
          : wPojemniku > 0 ? ETYKIETA.prepared
          : o.kgDone > 0 ? ETYKIETA.running
          : ETYKIETA.queued
        const zostalo = Math.max(0, o.meatKg - o.kgDone - wMaszynie - wPojemniku)
        const podpis = wMaszynie > 0 ? `${o.orderNo} · ${Math.round(wMaszynie)} kg w masownicy`
          : wPojemniku > 0 ? `${o.orderNo} · ${Math.round(wPojemniku)} kg w pojemniku`
          : zostalo > 0 ? `${o.orderNo} · zostało ${Math.round(zostalo)} kg`
          : o.orderNo
        const partie = (o.meatLots ?? []).map(l => l.meatLotNo).filter(Boolean)
        return (
          <button key={o.id} type="button" onClick={() => onPick(o.id)}
            className="flex items-center gap-3 p-3 rounded-[10px] text-left w-full"
            style={{
              background: gotowe ? 'var(--successSoft)' : 'var(--panel)',
              border: `${selectedId === o.id ? 2 : 1.5}px solid ${
                selectedId === o.id ? 'var(--accent)' : gotowe ? 'var(--successLine)' : 'var(--line)'}`,
            }}>
            <span className="w-8 h-8 shrink-0 rounded-full flex items-center justify-center hmi-v10-mono text-sm font-bold"
              style={gotowe
                ? { background: 'var(--success)', border: '2px solid var(--success)', color: '#fff' }
                : { background: 'var(--panel)', border: '2px solid var(--line)', color: 'var(--mut)' }}>
              {gotowe ? '✓' : (o.daySeq || '–')}
            </span>
            <span className="flex-1 min-w-0 flex flex-col gap-1.5">
              <span className="text-base font-extrabold leading-none truncate">{o.recipeName}</span>
              <span className="hmi-v10-mono text-[11px] font-semibold leading-none" style={{ color: 'var(--mut)' }}>
                {podpis}
              </span>
              {partie.length ? (
                <span className="text-[10px] font-bold uppercase tracking-wider leading-none"
                  style={{ color: 'var(--accent)' }}>
                  partie od biura: {partie.join(', ')}
                </span>
              ) : null}
              <span className="h-2 rounded-md overflow-hidden" style={{ background: 'var(--lineSoft)' }}>
                <span className="block h-full"
                  style={{
                    width: `${Math.min(100, (o.kgDone / Math.max(1, o.meatKg)) * 100)}%`,
                    background: gotowe ? 'var(--successSoft)' : 'var(--barBg)',
                    borderRight: `2px solid ${gotowe ? 'var(--success)' : 'var(--accent)'}`,
                  }} />
              </span>
            </span>
            <span className="text-right shrink-0">
              <b className="block hmi-v10-mono text-base font-bold leading-tight">
                {Math.round(o.kgDone)} / {Math.round(o.meatKg)}
              </b>
              <span className="inline-block text-[10px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-md mt-1.5"
                style={{ background: stan.bg, color: stan.fg, border: `1px solid ${stan.line}` }}>
                {stan.text}
              </span>
            </span>
          </button>
        )
      })}
    </div>
  )
}
