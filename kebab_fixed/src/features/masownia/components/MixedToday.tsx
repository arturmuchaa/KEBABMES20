/**
 * Dzisiejsze mieszania — lista odbiorów z podziałem na masownice, z dodrukiem
 * etykiet (właściciel, 18.09.2026).
 *
 * Otwiera się kliknięciem w kafelek „Wymieszane" na dolnym pasku, czyli
 * dokładnie w tę liczbę, na którą operator i tak patrzy przez cały dzień.
 *
 * Dodruk jest tu, a nie przy odbiorze, bo etykieta psuje się PÓŹNIEJ: zacina
 * się w drukarce, rozmazuje albo odkleja od mokrej palety, kiedy odbiór jest
 * od dawna zaksięgowany i nie ma już czego „potwierdzać jeszcze raz".
 */
import { MACHINES } from '../machines'
import type { Charge } from '../useMasowniaData'

const kg = (n: number) => `${Math.round(Number(n) || 0)}`

const godzina = (iso?: string | null) => {
  const d = new Date(iso ?? '')
  if (Number.isNaN(d.getTime())) return '—'
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}`
}

export function MixedToday({ charges, busyId, onPrint, onClose }: {
  /** Wsady odebrane dzisiaj (backend: /masownia/wsady/dzis). */
  charges: Charge[]
  /** Wsad, którego etykieta właśnie idzie do drukarki. */
  busyId?: string | null
  onPrint: (charge: Charge) => void
  onClose: () => void
}) {
  const razem = charges.reduce((s, c) => s + Number((c as any).kg_output || 0), 0)

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center p-8"
      style={{ background: 'rgba(15,23,42,.5)' }}>
      <div className="rounded-2xl w-[1080px] max-h-full flex flex-col overflow-hidden"
        style={{ background: 'var(--panel)' }}>
        <div className="shrink-0 p-4 px-6 flex items-center gap-4" style={{ borderBottom: '1px solid var(--line)' }}>
          <h3 className="m-0 text-[24px] font-extrabold">Dziś wymieszane</h3>
          <span className="hmi-v10-mono text-[15px] font-bold" style={{ color: 'var(--mut)' }}>
            {charges.length} {charges.length === 1 ? 'wsad' : 'wsady'} · {kg(razem)} kg
          </span>
          <button type="button" onClick={onClose}
            className="h-[52px] px-6 rounded-[10px] text-base font-extrabold ml-auto"
            style={{ background: 'var(--panel)', border: '1.5px solid var(--line)' }}>
            Zamknij
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-4 flex flex-col gap-4">
          {charges.length === 0 ? (
            <div className="p-6 text-center text-[15px] font-semibold rounded-[10px]"
              style={{ color: 'var(--mut)', border: '1.5px dashed var(--line)' }}>
              Dziś nic jeszcze nie zeszło z masownic.
            </div>
          ) : null}

          {MACHINES.map(m => {
            const wsady = charges.filter(c => c.machine_id === m.id)
            if (!wsady.length) return null
            const suma = wsady.reduce((s, c) => s + Number((c as any).kg_output || 0), 0)
            return (
              <div key={m.id} className="rounded-xl overflow-hidden" style={{ border: '1.5px solid var(--line)' }}>
                <div className="flex items-center gap-3 py-2.5 px-4" style={{ background: 'var(--bg)' }}>
                  <span className="text-[17px] font-extrabold uppercase tracking-wide">Masownica {m.id}</span>
                  <span className="hmi-v10-mono text-[13px] font-bold" style={{ color: 'var(--mut)' }}>
                    {wsady.length} × · {kg(suma)} kg
                  </span>
                </div>
                {wsady.map(c => (
                  <div key={c.id} className="flex items-center gap-4 py-3 px-4"
                    style={{ borderTop: '1px solid var(--line)' }}>
                    <span className="hmi-v10-mono text-[15px] font-bold w-[110px] shrink-0" style={{ color: 'var(--mut)' }}>
                      {godzina((c as any).started_at)} → {godzina((c as any).finished_at)}
                    </span>
                    <span className="hmi-v10-mono text-[22px] font-bold w-[110px] shrink-0">
                      {c.batch_no || '—'}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-[16px] font-extrabold truncate">{c.recipe_name || '—'}</span>
                      <span className="block hmi-v10-mono text-[11px] font-semibold" style={{ color: 'var(--mut)' }}>
                        {(c.meat ?? []).map((x: any) => x.pallet_no || `partia ${x.lot_no}`).join(' · ') || '—'}
                      </span>
                    </span>
                    <span className="text-right shrink-0 w-[120px]">
                      <b className="block hmi-v10-mono text-[19px] font-bold leading-none">
                        {kg((c as any).kg_output)} kg
                      </b>
                      <span className="block hmi-v10-mono text-[11px] font-semibold mt-1" style={{ color: 'var(--mut)' }}>
                        z {kg(c.kg_meat)} kg mięsa
                      </span>
                    </span>
                    <button type="button" disabled={busyId === c.id} onClick={() => onPrint(c)}
                      className="h-[52px] px-5 rounded-[10px] text-[15px] font-extrabold shrink-0"
                      style={{
                        background: 'var(--accent)', color: '#fff',
                        opacity: busyId === c.id ? 0.5 : 1,
                      }}>
                      {busyId === c.id ? 'Drukuję…' : 'Drukuj etykietę'}
                    </button>
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
