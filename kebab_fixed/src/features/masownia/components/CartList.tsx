/**
 * Przygotowane przyprawy — ponumerowane pojemniki czekające na maszynę.
 *
 * Numer pojemnika jest CAŁĄ tożsamością odważonych przypraw: papierowa
 * etykieta na mokrym pojemniku odpada, a dwa pojemniki tej samej receptury
 * o różnym wsadzie są po zamknięciu pokrywy nie do rozróżnienia. Dlatego
 * numer stoi na kaflu wielki i pierwszy.
 */
import type { SpiceCart } from '../useMasowniaData'

export function CartList({ carts, selectedId, onPick }: {
  carts: SpiceCart[]
  selectedId?: string | null
  onPick: (cartId: string) => void
}) {
  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-3 flex flex-col gap-2">
      {carts.length === 0 ? (
        <div className="p-4 text-center text-[13px] font-semibold leading-relaxed rounded-[10px]"
          style={{ color: 'var(--mut)', border: '1.5px dashed var(--line)' }}>
          Nic nie czeka.<br />Póki masownice chodzą, odważ przyprawy na następne wsady.
        </div>
      ) : null}
      {carts.map(c => (
        <button key={c.id} type="button" onClick={() => onPick(c.id)}
          className="flex items-center gap-3 p-3 rounded-[10px] text-left w-full"
          style={{
            background: selectedId === c.id ? 'var(--accentSoft)' : 'var(--panel)',
            border: `${selectedId === c.id ? 2 : 1.5}px solid ${selectedId === c.id ? 'var(--accent)' : 'var(--line)'}`,
          }}>
          <span className="w-10 h-10 shrink-0 rounded-[10px] flex items-center justify-center text-xl font-extrabold"
            style={{ background: selectedId === c.id ? 'var(--accent)' : 'var(--ink)', color: '#fff' }}>
            {c.cart_no}
          </span>
          <span className="flex-1 min-w-0">
            <span className="block text-base font-extrabold truncate">{c.order_no ?? 'Zlecenie'}</span>
            <span className="block hmi-v10-mono text-[11px] font-semibold mt-1" style={{ color: 'var(--mut)' }}>
              pojemnik {c.cart_no} · {(c.ingredients ?? []).length} {(c.ingredients ?? []).length === 1 ? 'składnik' : 'składników'}
            </span>
          </span>
          <span className="hmi-v10-mono text-xl font-bold shrink-0">{Math.round(c.kg_target)} kg</span>
        </button>
      ))}
    </div>
  )
}
