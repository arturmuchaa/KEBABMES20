/**
 * Kafelki mięsa — jedyne miejsce, w którym panel decyduje, co wolno wrzucić
 * do masownicy.
 *
 * Kafelek to PALETA z ważenia zbiorczego albo PARTIA bez palety (filet
 * z mostka, indyk, mięso kupione z zewnątrz — tego hala nie waży zbiorczo,
 * więc operator wpisuje kilogramy z paleciaka).
 *
 * Bramka partii: jeśli biuro wskazało partie w planie masowania, klikalne są
 * tylko one. Reszta ZOSTAJE na ekranie — szara, z powodem pod spodem. Mięso
 * jest, tylko nie to; znikający kafelek kazałby operatorowi szukać.
 */
import { useMemo, useState } from 'react'
import { buildMeatTiles, type MeatTilesInput } from '../meatTiles'
import { gateMeatTiles, officeChoiceLabel, type OrderLot } from '../meatGate'
import { NumPad, numpadValue } from './NumPad'

export interface MeatTake {
  palletId: string | null
  lotNo: string
  meatStockId: string
  kg: number
}

const kg = (n: number) => `${Math.round(n * 10) / 10}`.replace('.', ',')
const dPl = (iso: string) => (iso || '').slice(8, 10) + '.' + (iso || '').slice(5, 7)

export function MeatPicker({ meat, orderLots, targetKg, onConfirm, onBack }: {
  meat: MeatTilesInput
  orderLots: OrderLot[]
  targetKg: number
  onConfirm: (take: MeatTake[]) => void
  onBack: () => void
}) {
  const kafelki = useMemo(
    () => gateMeatTiles(buildMeatTiles(meat), orderLots),
    [meat, orderLots],
  )
  const [wybrane, setWybrane] = useState<Record<string, MeatTake[]>>({})
  const [paleciak, setPaleciak] = useState<{ key: string; lotNo: string; meatStockId: string; max: number } | null>(null)
  const [wpis, setWpis] = useState('')

  const wsad = Object.values(wybrane).flat()
  const razem = Math.round(wsad.reduce((s, t) => s + t.kg, 0) * 10) / 10
  const etykietaPlanu = officeChoiceLabel(orderLots)

  const przelacz = (kafel: (typeof kafelki)[number]) => {
    if (!kafel.allowed) return
    if (wybrane[kafel.key]) {
      const { [kafel.key]: _, ...reszta } = wybrane
      return setWybrane(reszta)
    }
    if (kafel.kind === 'lot') {
      // Partia bez palety — kilogramy zna tylko paleciak z wagą, którego
      // system nie czyta, więc operator je wpisuje.
      setPaleciak({ key: kafel.key, lotNo: kafel.lots[0].lotNo, meatStockId: kafel.lots[0].meatStockId, max: kafel.kgFree })
      setWpis('')
      return
    }
    setWybrane({
      ...wybrane,
      [kafel.key]: kafel.lots.map(l => ({
        palletId: kafel.palletId || null, lotNo: l.lotNo, meatStockId: l.meatStockId, kg: l.kg,
      })),
    })
  }

  const zapiszPaleciak = () => {
    const ile = numpadValue(wpis)
    if (!paleciak || Number.isNaN(ile) || ile <= 0) return
    setWybrane({
      ...wybrane,
      [paleciak.key]: [{ palletId: null, lotNo: paleciak.lotNo, meatStockId: paleciak.meatStockId, kg: ile }],
    })
    setPaleciak(null)
  }

  return (
    <>
      <div className="shrink-0 flex items-center gap-4 p-3 px-4" style={{ borderBottom: '1px solid var(--line)' }}>
        <button type="button" onClick={onBack} className="text-sm font-extrabold" style={{ color: 'var(--accent)' }}>
          ← Wróć
        </button>
        <span className="text-[22px] font-extrabold tracking-tight">Mięso do wsadu</span>
        <div className="flex-1" />
        <span className="text-[15px] font-bold" style={{ color: 'var(--mut)' }}>
          wsad <b className="hmi-v10-mono text-xl" style={{ color: 'var(--ink)' }}>{kg(razem)}</b> / {Math.round(targetKg)} kg
        </span>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-4">
        {etykietaPlanu ? (
          <div className="flex items-center gap-2.5 py-2.5 px-3.5 rounded-[9px] mb-3 text-[13px] font-bold"
            style={{ background: 'var(--accentSoft)', color: 'var(--accent)' }}>
            Biuro wskazało {orderLots.length > 1 ? 'partie' : 'partię'}: {etykietaPlanu} — reszta mięsa jest wygaszona.
          </div>
        ) : null}

        <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(196px, 1fr))' }}>
          {kafelki.map(k => {
            const on = Boolean(wybrane[k.key])
            return (
              <div key={k.key} className="flex flex-col gap-1">
                <button type="button" disabled={!k.allowed} onClick={() => przelacz(k)}
                  className="rounded-[10px] p-3 px-3.5 text-left flex flex-col gap-1.5"
                  style={{
                    background: on ? 'var(--accent)' : k.mixed ? 'var(--ambSoft)' : 'var(--panel)',
                    color: on ? '#fff' : undefined,
                    border: `1.5px solid ${on ? 'var(--accent)' : k.mixed ? 'var(--ambLine)' : 'var(--line)'}`,
                    opacity: k.allowed ? 1 : 0.42,
                    cursor: k.allowed ? 'pointer' : 'not-allowed',
                  }}>
                  <span className="hmi-v10-mono text-sm font-bold tracking-tight">
                    {k.kind === 'pallet' ? k.palletNo : `partia ${k.lots[0].lotNo}`}
                  </span>
                  <span className="hmi-v10-mono text-2xl font-bold leading-none">
                    {kg(k.kgFree)}
                    <small className="text-xs font-semibold ml-1.5"
                      style={{ color: on ? 'rgba(255,255,255,.8)' : 'var(--mut)' }}>kg</small>
                  </span>
                  <span className="text-[11px] font-bold leading-relaxed"
                    style={{ color: on ? 'rgba(255,255,255,.8)' : 'var(--mut)' }}>
                    {k.kind === 'pallet'
                      ? `partia ${k.lots.map(l => l.lotNo).join(' + ')} · do ${dPl(k.expiryDate)}`
                      : `${k.materialName} · paleciak · do ${dPl(k.expiryDate)}`}
                  </span>
                  {k.mixed ? (
                    <span className="inline-block text-[10px] font-extrabold uppercase tracking-wide px-1.5 py-0.5 rounded"
                      style={on
                        ? { background: 'rgba(255,255,255,.16)', color: '#fff', border: '1px solid rgba(255,255,255,.34)' }
                        : { background: 'var(--ambSoft)', color: 'var(--amb)', border: '1px solid var(--ambLine)' }}>
                      mieszana
                    </span>
                  ) : null}
                </button>
                {k.reason ? (
                  <span className="text-[11px] font-bold px-1" style={{ color: 'var(--mut)' }}>{k.reason}</span>
                ) : null}
              </div>
            )
          })}
          {kafelki.length === 0 ? (
            <div className="p-4 text-center text-[13px] font-semibold rounded-[10px] col-span-full"
              style={{ color: 'var(--mut)', border: '1.5px dashed var(--line)' }}>
              Magazyn mięsa jest pusty — rozbiór nic jeszcze nie zważył.
            </div>
          ) : null}
        </div>
      </div>

      <div className="shrink-0 flex items-center gap-4 p-3 px-4"
        style={{ borderTop: '1px solid var(--line)', background: 'var(--bg)' }}>
        <span className="text-[15px] font-bold" style={{ color: 'var(--mut)' }}>
          Wsad <b className="hmi-v10-mono text-[25px] font-bold" style={{ color: 'var(--ink)' }}>{kg(razem)}</b> kg
        </span>
        <button type="button" disabled={wsad.length === 0} onClick={() => onConfirm(wsad)}
          className="h-[60px] px-7 rounded-[10px] text-lg font-extrabold ml-auto"
          style={{
            background: 'var(--accent)', color: '#fff',
            opacity: wsad.length === 0 ? 0.35 : 1,
            cursor: wsad.length === 0 ? 'not-allowed' : 'pointer',
          }}>
          Załaduj
        </button>
      </div>

      {paleciak ? (
        <div className="absolute inset-0 z-50 flex items-center justify-center p-9"
          style={{ background: 'rgba(15,23,42,.5)' }}>
          <div className="rounded-2xl w-[880px] flex flex-col overflow-hidden" style={{ background: 'var(--panel)' }}>
            <div className="p-4 px-6 flex items-center gap-3.5" style={{ borderBottom: '1px solid var(--line)' }}>
              <h3 className="m-0 text-[22px] font-extrabold">Partia {paleciak.lotNo} — ile kg bierzesz?</h3>
            </div>
            <div className="p-5 px-6 flex gap-6 items-center">
              <div className="flex-1">
                <div className="text-[10px] font-extrabold uppercase tracking-[0.14em]" style={{ color: 'var(--mut)' }}>
                  Odczyt z paleciaka
                </div>
                <div className="rounded-xl p-4 px-5 mt-2 text-right" style={{ border: '2px solid var(--line)', background: 'var(--bg)' }}>
                  <span className="hmi-v10-mono text-[60px] font-bold leading-tight">
                    {wpis || '0'}<i className="not-italic text-[26px] ml-2" style={{ color: 'var(--mut)' }}>kg</i>
                  </span>
                </div>
                <div className="text-[13px] font-semibold mt-2" style={{ color: 'var(--mut)' }}>
                  Na stanie zostało {kg(paleciak.max)} kg tej partii.
                </div>
              </div>
              <NumPad value={wpis} onChange={setWpis} />
            </div>
            <div className="p-4 px-6 flex gap-3 items-center" style={{ borderTop: '1px solid var(--line)', background: 'var(--bg)' }}>
              <button type="button" onClick={() => setPaleciak(null)}
                className="h-[52px] px-6 rounded-[10px] text-base font-extrabold"
                style={{ background: 'var(--panel)', border: '1.5px solid var(--line)' }}>
                Anuluj
              </button>
              <button type="button" onClick={zapiszPaleciak}
                className="h-[52px] px-7 rounded-[10px] text-base font-extrabold ml-auto"
                style={{ background: 'var(--accent)', color: '#fff' }}>
                Zatwierdź
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
