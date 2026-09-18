/**
 * Przygotowane przyprawy — paczki czekające na maszynę. TABLICA, nie przycisk.
 *
 * Wcześniej kliknięcie paczki zaczynało załadunek i była to trzecia droga
 * w proces obok dwóch kafelków. Paczkę wybiera się teraz w torze załadunku,
 * PO wskazaniu mięsa (`PackPicker`) — tu operator tylko widzi, co czeka.
 *
 * Na wierszu stoi wszystko, czego potrzeba przy maszynie: numer paczki
 * (ciągły od 1, jednorazowy — worek nie wraca jak umyty pojemnik), receptura,
 * wielkość wsadu i LICZBA WORKÓW. Bez tej liczby operator nie wie, czy zabrał
 * komplet, a wsypanie jednego z trzech worków widać dopiero po 50 minutach.
 */
import { workiOpis } from './PackPicker'
import type { SpiceCart } from '../useMasowniaData'

export function CartList({ carts, selectedId }: {
  carts: SpiceCart[]
  selectedId?: string | null
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
        <div key={c.id}
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
            <span className="block text-base font-extrabold truncate">
              {c.recipe_name || c.order_no || 'Przyprawy'}
            </span>
            <span className="block hmi-v10-mono text-[11px] font-semibold mt-1" style={{ color: 'var(--mut)' }}>
              nr {c.cart_no} · {workiOpis(Number(c.bags || 1))}
            </span>
          </span>
          <span className="text-right shrink-0">
            <b className="block hmi-v10-mono text-xl font-bold leading-none">{Math.round(Number(c.kg_target || 0))} kg</b>
            <span className="block hmi-v10-mono text-[10px] font-semibold mt-1" style={{ color: 'var(--mut)' }}>
              wsadu
            </span>
          </span>
        </div>
      ))}
    </div>
  )
}
