/**
 * Wybór przygotowanej paczki przypraw — krok PO wskazaniu mięsa.
 *
 * Kolejność jest celowa (właściciel, 18.09.2026): najpierw wiadomo, ile mięsa
 * idzie do maszyny, a dopiero potem operator sięga po worki. Wybór paczki
 * przed mięsem kazał zgadywać, czy wsad w ogóle się zgra, a niezgodne
 * przyprawy wychodzą dopiero po 50 minutach — kiedy nie ma już czego ratować.
 *
 * Paczka pasuje do wsadu tylko wtedy, gdy zrobiono ją na TE kilogramy:
 * przyprawy liczy się na konkretną wielkość, więc worek na 200 kg wsypany
 * do 600 kg to wsad trzy razy niedoprawiony. Niepasujące kafelki zostają
 * widoczne, ale szare — z powodem, bo znikający kafelek każe operatorowi
 * szukać, czy aby nie zgubił swojej roboty.
 */
import type { SpiceCart } from '../useMasowniaData'

/** Ile kilogramów różnicy jeszcze uznajemy za „ta sama wielkość wsadu". */
const TOL_KG = 1

export const workiOpis = (n: number) =>
  `${n} ${n === 1 ? 'worek' : n < 5 ? 'worki' : 'worków'}`

export function PackPicker({ carts, kgMeat, recipeName, onPick, onWeighNow, onBack }: {
  carts: SpiceCart[]
  /** Ile mięsa operator właśnie wskazał — do tego muszą pasować przyprawy. */
  kgMeat: number
  recipeName?: string
  onPick: (cart: SpiceCart) => void
  onWeighNow: () => void
  onBack: () => void
}) {
  const pasuje = (c: SpiceCart) => Math.abs(Number(c.kg_target || 0) - kgMeat) <= TOL_KG

  return (
    <>
      <div className="shrink-0 flex items-center gap-4 p-3 px-4" style={{ borderBottom: '1px solid var(--line)' }}>
        <button type="button" onClick={onBack} className="text-sm font-extrabold" style={{ color: 'var(--accent)' }}>
          ← Wróć
        </button>
        <span className="text-[22px] font-extrabold tracking-tight">Przyprawy do tego wsadu</span>
        <div className="flex-1" />
        <span className="text-[15px] font-bold" style={{ color: 'var(--mut)' }}>
          wsad <b className="hmi-v10-mono text-xl" style={{ color: 'var(--ink)' }}>{Math.round(kgMeat)}</b> kg
          {recipeName ? ` · ${recipeName}` : ''}
        </span>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-4">
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
          {carts.map(c => {
            const ok = pasuje(c)
            return (
              <div key={c.id} className="flex flex-col gap-1">
                <button type="button" disabled={!ok} onClick={() => ok && onPick(c)}
                  className="rounded-xl p-4 text-left flex flex-col gap-2 min-h-[140px]"
                  style={{
                    background: 'var(--panel)',
                    border: `2px solid ${ok ? 'var(--accent)' : 'var(--line)'}`,
                    opacity: ok ? 1 : 0.42,
                    cursor: ok ? 'pointer' : 'not-allowed',
                  }}>
                  <span className="flex items-center gap-2.5">
                    <span className="w-11 h-11 shrink-0 rounded-[10px] flex items-center justify-center text-lg font-extrabold"
                      style={{ background: ok ? 'var(--accent)' : 'var(--mut)', color: '#fff' }}>
                      {c.cart_no}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[17px] font-extrabold truncate">
                        {c.recipe_name || c.order_no || 'Przyprawy'}
                      </span>
                      <span className="block hmi-v10-mono text-[11px] font-semibold" style={{ color: 'var(--mut)' }}>
                        nr {c.cart_no} · {workiOpis(Number(c.bags || 1))}
                      </span>
                    </span>
                  </span>
                  <span className="mt-auto hmi-v10-mono text-[26px] font-bold leading-none">
                    {Math.round(Number(c.kg_target || 0))}
                    <small className="text-xs font-semibold ml-1.5" style={{ color: 'var(--mut)' }}>kg wsadu</small>
                  </span>
                </button>
                {!ok ? (
                  <span className="text-[11px] font-bold px-1" style={{ color: 'var(--mut)' }}>
                    Przyprawy na {Math.round(Number(c.kg_target || 0))} kg — ten wsad ma {Math.round(kgMeat)} kg
                  </span>
                ) : null}
              </div>
            )
          })}
          {carts.length === 0 ? (
            <div className="p-4 text-center text-[13px] font-semibold rounded-[10px] col-span-full"
              style={{ color: 'var(--mut)', border: '1.5px dashed var(--line)' }}>
              Nic nie czeka — przyprawy odważysz teraz przy maszynie.
            </div>
          ) : null}
        </div>
      </div>

      <div className="shrink-0 flex items-center gap-4 p-3 px-4"
        style={{ borderTop: '1px solid var(--line)', background: 'var(--bg)' }}>
        <span className="text-[13px] font-bold" style={{ color: 'var(--mut)' }}>
          Nie ma gotowych przypraw na ten wsad?
        </span>
        <button type="button" onClick={onWeighNow}
          className="h-[60px] px-7 rounded-[10px] text-lg font-extrabold ml-auto"
          style={{ background: 'var(--accent)', color: '#fff' }}>
          Odważ teraz przy maszynie
        </button>
      </div>
    </>
  )
}
