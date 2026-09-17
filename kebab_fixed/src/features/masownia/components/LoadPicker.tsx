/**
 * Krok 1 załadunku — wolna masownica i wsad.
 *
 * Wsadem jest ALBO gotowy pojemnik z przyprawami (wtedy zlecenie i kilogramy
 * są już przesądzone), ALBO zlecenie z kolejki, gdy operator odważa przyprawy
 * przy maszynie. Panel nie wybiera zlecenia za operatora: przy trzech
 * maszynach i kilku zleceniach „pierwsze z brakiem kilogramów" bywa nie tym,
 * które stoi przy nim na palecie.
 */
import { MACHINES, fitsMachine } from '../machines'
import type { SpiceCart } from '../useMasowniaData'
import type { QueueOrder } from './DayQueue'

export function LoadPicker({ carts, orders, zajeteMaszyny, machineId, cartId, orderId, onMachine, onCart, onOrder, onNext, onBack }: {
  carts: SpiceCart[]
  orders: (QueueOrder & { zostalo: number })[]
  zajeteMaszyny: number[]
  machineId: number | null
  cartId: string | null
  orderId: string | null
  onMachine: (id: number) => void
  onCart: (cart: SpiceCart) => void
  onOrder: (orderId: string) => void
  onNext: () => void
  onBack: () => void
}) {
  const maszyna = MACHINES.find(m => m.id === machineId) ?? null
  const gotowe = Boolean(machineId && (cartId || orderId))

  return (
    <>
      <div className="shrink-0 flex items-center gap-4 p-3 px-4" style={{ borderBottom: '1px solid var(--line)' }}>
        <button type="button" onClick={onBack} className="text-sm font-extrabold" style={{ color: 'var(--accent)' }}>
          ← Wróć
        </button>
        <span className="text-[22px] font-extrabold tracking-tight">Wsad i masownica</span>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-4">
        <div className="text-[10px] font-extrabold uppercase tracking-[0.14em] mb-2.5" style={{ color: 'var(--mut)' }}>
          Masownica
        </div>
        <div className="grid grid-cols-3 gap-3">
          {MACHINES.map(m => {
            const zajeta = zajeteMaszyny.includes(m.id)
            const on = machineId === m.id
            return (
              <button key={m.id} type="button" disabled={zajeta} onClick={() => onMachine(m.id)}
                aria-label={`Masownica ${m.id}`}
                className="rounded-xl p-4 text-left flex flex-col gap-1.5 min-h-[128px]"
                style={{
                  background: on ? 'var(--accentSoft)' : 'var(--panel)',
                  border: `2px solid ${on ? 'var(--accent)' : 'var(--line)'}`,
                  opacity: zajeta ? 0.42 : 1, cursor: zajeta ? 'not-allowed' : 'pointer',
                }}>
                <span className="text-lg font-extrabold uppercase tracking-wide">Masownica {m.id}</span>
                <span className="hmi-v10-mono text-[38px] font-bold leading-none tracking-tighter"
                  style={on ? { color: 'var(--accent)' } : undefined}>
                  {m.cap} kg
                </span>
                <span className="mt-auto text-xs font-extrabold uppercase tracking-wider"
                  style={{ color: zajeta ? 'var(--mut)' : 'var(--success)' }}>
                  {zajeta ? 'Pracuje' : 'Wolna'}
                </span>
              </button>
            )
          })}
        </div>

        {carts.length ? (
          <>
            <div className="text-[10px] font-extrabold uppercase tracking-[0.14em] mt-5 mb-2.5" style={{ color: 'var(--mut)' }}>
              Gotowe przyprawy
            </div>
            <div className="grid grid-cols-3 gap-3">
              {carts.map(c => {
                const pasuje = !maszyna || fitsMachine(Number(c.kg_target), maszyna.cap)
                const on = cartId === c.id
                return (
                  <button key={c.id} type="button" disabled={!pasuje} onClick={() => onCart(c)}
                    aria-label={`Pojemnik ${c.cart_no}`}
                    className="rounded-xl p-4 text-left flex flex-col gap-1.5 min-h-[128px]"
                    style={{
                      background: on ? 'var(--accentSoft)' : 'var(--panel)',
                      border: `2px solid ${on ? 'var(--accent)' : 'var(--line)'}`,
                      opacity: pasuje ? 1 : 0.42, cursor: pasuje ? 'pointer' : 'not-allowed',
                    }}>
                    <span className="w-10 h-10 rounded-[10px] flex items-center justify-center text-xl font-extrabold"
                      style={{ background: on ? 'var(--accent)' : 'var(--ink)', color: '#fff' }}>
                      {c.cart_no}
                    </span>
                    <span className="text-base font-extrabold truncate">{c.order_no ?? 'Zlecenie'}</span>
                    <span className="hmi-v10-mono text-xs font-semibold" style={{ color: 'var(--mut)' }}>
                      pojemnik {c.cart_no} · {Math.round(Number(c.kg_target))} kg
                    </span>
                    {!pasuje ? (
                      <span className="text-[11px] font-bold" style={{ color: 'var(--mut)' }}>
                        nie zmieści się w tej masownicy
                      </span>
                    ) : null}
                  </button>
                )
              })}
            </div>
          </>
        ) : null}

        <div className="text-[10px] font-extrabold uppercase tracking-[0.14em] mt-5 mb-2.5" style={{ color: 'var(--mut)' }}>
          {carts.length ? 'Albo zlecenie — przyprawy odważysz przy maszynie' : 'Zlecenie'}
        </div>
        <div className="grid grid-cols-3 gap-3">
          {orders.map(o => {
            const on = orderId === o.id && !cartId
            return (
              <button key={o.id} type="button" onClick={() => onOrder(o.id)}
                aria-label={`Wsad ${o.orderNo}`}
                className="rounded-xl p-4 text-left flex flex-col gap-1.5 min-h-[112px]"
                style={{
                  background: on ? 'var(--accentSoft)' : 'var(--panel)',
                  border: `2px solid ${on ? 'var(--accent)' : 'var(--line)'}`,
                }}>
                <span className="text-lg font-extrabold truncate">{o.recipeName}</span>
                <span className="hmi-v10-mono text-xs font-semibold" style={{ color: 'var(--mut)' }}>
                  {o.orderNo} · zostało {Math.round(o.zostalo)} kg
                </span>
                {(o.meatLots ?? []).length ? (
                  <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--accent)' }}>
                    partie od biura: {(o.meatLots ?? []).map(l => l.meatLotNo).join(', ')}
                  </span>
                ) : null}
              </button>
            )
          })}
          {orders.length === 0 ? (
            <div className="p-4 text-center text-[13px] font-semibold rounded-[10px] col-span-full"
              style={{ color: 'var(--mut)', border: '1.5px dashed var(--line)' }}>
              Cały plan dnia jest rozpisany.
            </div>
          ) : null}
        </div>
      </div>

      <div className="shrink-0 flex items-center gap-4 p-3 px-4"
        style={{ borderTop: '1px solid var(--line)', background: 'var(--bg)' }}>
        <span className="text-[15px] font-bold" style={{ color: 'var(--mut)' }}>
          {machineId ? `Masownica ${machineId}` : 'Wskaż masownicę'}
          {cartId ? ' · pojemnik wskazany' : orderId ? ' · zlecenie wskazane' : ' · wskaż wsad'}
        </span>
        <button type="button" disabled={!gotowe} onClick={onNext}
          className="h-[60px] px-7 rounded-[10px] text-lg font-extrabold ml-auto"
          style={{
            background: 'var(--accent)', color: '#fff',
            opacity: gotowe ? 1 : 0.35, cursor: gotowe ? 'pointer' : 'not-allowed',
          }}>
          Dalej — mięso
        </button>
      </div>
    </>
  )
}
