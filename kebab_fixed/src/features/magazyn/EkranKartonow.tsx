/**
 * KARTONY, poziom 2 — co pakować i czym pakować.
 *
 * Dwie różne rzeczy z dwóch źródeł (spec §5.1):
 *   - CO pakować: otwarte kartony z biura (palety zamówień + kartony
 *     magazynowe). Magazyn ich nie zakłada — tylko je widzi.
 *   - CZYM pakować: sztuki z produkcji, których nie ma jeszcze w żadnym
 *     kartonie. Nikt tej listy nie wprowadza — wylicza się sama.
 *
 * Wybór kartonu tylko ustawia DOMYŚLNY cel (cisza przy pasujących
 * sztukach). Można też od razu skanować — pierwsza sztuka sama wskaże
 * karton, a skan etykiety kartonu przełącza aktywny.
 */
import { useMemo } from 'react'
import { usePakowanie } from './usePakowanie'
import { pulaPoDniach, krotkaData, kgTxt } from './pula'
import { brakuje, dokadKarton, skladKartonu } from './opisKartonu'
import { Karta, Znacznik } from './components/Karta'

export function EkranKartonow({ onWybor }: { onWybor: (kartonId: string | null) => void }) {
  const { kontenery, spakowane, pula, ladowanie, blad } = usePakowanie()
  const dni = useMemo(() => pulaPoDniach(pula, new Date()), [pula])
  const zalegle = dni.filter(d => d.zalegle).reduce((s, d) => s + d.sztuk, 0)
  const doSpakowania = dni.reduce((s, d) => s + d.sztuk, 0)

  return (
    <div className="grid min-h-0 flex-1 gap-3 p-4 px-6"
      style={{ gridTemplateColumns: 'minmax(0, 1.35fr) minmax(0, 1fr)' }}>
      <Karta tytul="Otwarte kartony" tresc={false}
        prawo={<>definiuje biuro · <b style={{ color: 'var(--ink)' }}>{kontenery.length}</b></>}>
        {blad ? (
          <div className="m-4 rounded-lg p-3 text-sm"
            style={{ background: 'var(--redSoft)', border: '1px solid var(--redLine)', color: 'var(--red)' }}>
            Brak połączenia z serwerem — lista może być nieaktualna.
          </div>
        ) : null}
        <div className="flex flex-col gap-2.5 p-4">
          {kontenery.map(k => {
            const b = brakuje(k)
            const proc = k.targetQty ? k.packedQty / k.targetQty : 0
            return (
              <button key={k.id} type="button" onClick={() => onWybor(k.id)}
                className="flex w-full items-center gap-4 rounded-xl px-4 py-3.5 text-left transition hover:shadow-md"
                style={{ background: 'var(--panel)', border: '1.5px solid var(--line)', color: 'var(--ink)' }}>
                <span className="hmi-v10-mono grid shrink-0 place-items-center rounded-lg text-[13px] font-bold"
                  style={{ width: 74, height: 46, background: 'var(--accentSoft)', color: 'var(--accent)',
                           border: '1.5px solid var(--accentLine)' }}>
                  {k.cartonNo || '—'}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-[20px] font-extrabold leading-tight">{k.clientName || 'na magazyn'}</span>
                    <Znacznik ton={k.kind === 'order' ? 'akcja' : 'szary'}>
                      {k.kind === 'order' ? 'zamówienie' : 'magazyn'}
                    </Znacznik>
                  </span>
                  <span className="mt-0.5 block truncate text-[13.5px]" style={{ color: 'var(--mut)' }}>
                    {skladKartonu(k)} · {dokadKarton(k)}
                  </span>
                  <span className="mt-2 block h-1.5 overflow-hidden rounded-full" style={{ background: 'var(--lineSoft)' }}>
                    <span className="block h-full rounded-full"
                      style={{ width: `${Math.round(proc * 100)}%`, background: 'var(--accent)' }} />
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="hmi-v10-mono block text-[22px] font-bold leading-none">
                    {k.packedQty}<span style={{ color: '#9AA3B0' }}>/{k.targetQty}</span>
                  </span>
                  <span className="mt-1 block text-[12px]" style={{ color: 'var(--mut)' }}>
                    brakuje {b} szt
                  </span>
                </span>
              </button>
            )
          })}
          {spakowane.length ? (
            <div data-testid="spakowane" className="mt-2 flex flex-col gap-2">
              <div className="text-[11px] font-extrabold uppercase tracking-[0.1em]" style={{ color: 'var(--success)' }}>
                Spakowane — do mroźni · {spakowane.length}
              </div>
              {spakowane.map(k => (
                <button key={k.id} type="button" onClick={() => onWybor(k.id)}
                  className="flex w-full items-center gap-4 rounded-xl px-4 py-3 text-left"
                  style={{ background: 'var(--successSoft)', border: '1.5px solid var(--successLine)', color: 'var(--ink)' }}>
                  <span className="hmi-v10-mono grid shrink-0 place-items-center rounded-lg text-[13px] font-bold"
                    style={{ width: 74, height: 46, background: '#fff', color: 'var(--success)',
                             border: '1.5px solid var(--successLine)' }}>{k.cartonNo || '—'}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[19px] font-extrabold leading-tight">✓ {k.clientName || 'na magazyn'}</span>
                    <span className="block truncate text-[13px]" style={{ color: '#166534' }}>
                      ❄ zeskanuj kartkę i wjedź do mroźni
                    </span>
                  </span>
                  <span className="hmi-v10-mono shrink-0 text-[20px] font-bold" style={{ color: 'var(--success)' }}>
                    {k.packedQty}/{k.targetQty}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
          {!kontenery.length && !ladowanie ? (
            <div className="rounded-xl p-6 text-center text-[15px]"
              style={{ border: '1.5px dashed var(--line)', color: 'var(--mut)' }}>
              Biuro nie otworzyło żadnego kartonu. Kartony zakłada się przy zamówieniu
              (rozpis palet) albo w Magazynie wyrobu gotowego (karton magazynowy).
            </div>
          ) : null}
        </div>
      </Karta>

      <div className="flex min-h-0 flex-col gap-3">
        <button type="button" onClick={() => onWybor(null)} disabled={!kontenery.length}
          className="shrink-0 rounded-2xl px-6 py-5 text-left transition active:scale-[0.99]"
          style={{ background: kontenery.length ? 'var(--accent)' : 'var(--bg)',
                   color: kontenery.length ? '#fff' : 'var(--mut)',
                   border: kontenery.length ? 'none' : '1.5px solid var(--line)',
                   cursor: kontenery.length ? 'pointer' : 'not-allowed' }}>
          <span className="block text-[24px] font-extrabold leading-tight">Skanuj od razu</span>
          <span className="mt-1 block text-[14.5px]" style={{ opacity: 0.85 }}>
            Pierwsza sztuka sama wskaże karton. Każda następna idzie tam, gdzie należy.
          </span>
        </button>

        <Karta tytul="Do spakowania" tresc={false} className="flex-1"
          prawo={<>
            {zalegle ? <Znacznik ton="uwaga">{zalegle} szt zaległych</Znacznik> : null}
            <span>z produkcji · <b style={{ color: 'var(--ink)' }}>{doSpakowania} szt</b></span>
          </>}>
          {dni.map(d => (
            <div key={d.data || 'brak'}>
              <div className="flex items-center gap-3 px-4 py-2"
                style={{ background: d.zalegle ? 'var(--ambSoft)' : 'var(--bg)',
                         borderTop: '1px solid var(--lineSoft)', borderBottom: '1px solid var(--lineSoft)' }}>
                <b className="hmi-v10-mono text-[14px]">{krotkaData(d.data)}</b>
                <span className="text-[10px] font-extrabold uppercase tracking-[0.1em]"
                  style={{ color: d.zalegle ? 'var(--amb)' : 'var(--mut)' }}>{d.etykieta}</span>
                <span className="hmi-v10-mono ml-auto text-[14px] font-bold">{d.sztuk} szt</span>
              </div>
              {d.pozycje.map((p, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-2.5"
                  style={{ borderTop: i ? '1px solid var(--lineSoft)' : undefined }}>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14.5px] font-bold">
                      {p.recipeName || '—'} · {kgTxt(p.kgPerUnit)} kg
                    </span>
                    <span className="block truncate text-[12px]" style={{ color: 'var(--mut)' }}>
                      {p.clientName || 'na magazyn'}{p.productTypeName ? ` · ${p.productTypeName}` : ''}
                      {p.tuleja ? ` · ${p.tuleja}` : ''}
                    </span>
                  </span>
                  <span className="hmi-v10-mono shrink-0 text-[17px] font-bold">{p.qty}</span>
                </div>
              ))}
            </div>
          ))}
          {!dni.length && !ladowanie ? (
            <div className="p-6 text-center text-[14px]" style={{ color: 'var(--mut)' }}>
              Wszystko, co zeszło z produkcji, leży już w kartonach.
            </div>
          ) : null}
        </Karta>
      </div>
    </div>
  )
}
