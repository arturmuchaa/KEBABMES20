/**
 * Ważenie PEŁNEGO kartonu przed wjazdem do mroźni (spec 2026-09-29).
 *
 * Operator wybiera paletę (tara z widełkami z biura), wjeżdża na wagę
 * najazdową, ekran pokazuje brutto na żywo i podgląd werdyktu. „Zatwierdź"
 * zapisuje ważenie, wstawia karton do mroźni i drukuje etykietę 100×150.
 *
 * Niezgodna waga NIE blokuje — tylko czerwony werdykt i „NIEZGODNA" na
 * etykiecie (decyzja właściciela). Waga niedostępna → brutto wpisane ręcznie,
 * zapis i etykieta mają „RĘCZNIE".
 */
import { useState } from 'react'
import { magazynApi, type KartonDoWazenia, type PaletaMrozni, type WazenieMrozni } from '@/lib/api'
import { useScale } from '@/features/deboning/useScale'
import { drukujEtykieteWagi } from './drukEtykietyWagi'
import { kgPl, opisPozycji, roznicaPl, werdyktWagi } from './wazenieMrozni'

const OSTATNIA_PALETA = 'magazyn.mroznia.paleta'

function pamietana(): string {
  try { return localStorage.getItem(OSTATNIA_PALETA) ?? '' } catch { return '' }
}

export function WazenieKartonu({ karton, palety, onGotowe, onAnuluj, onPozniej }: {
  karton: KartonDoWazenia
  palety: PaletaMrozni[]
  /** Po zapisie; `bladDruku` = zapisane, ale etykieta nie wyszła. */
  onGotowe: (w: WazenieMrozni, bladDruku: string | null) => void
  onAnuluj: () => void
  /** „Zważ później" — karton wjeżdża bez ważenia, na liście „do zważenia". */
  onPozniej?: () => void
}) {
  const waga = useScale()
  const [paletaId, setPaletaId] = useState(() => {
    const p = pamietana()
    return palety.some(x => x.id === p) ? p : ''
  })
  // Wybór operatora; bez wagi ręczny wpis i tak jest jedyną drogą.
  const [recznyWybrany, setReczny] = useState(false)
  const reczny = recznyWybrany || !waga.available
  const [wpis, setWpis] = useState('')
  const [zapis, setZapis] = useState(false)
  const [blad, setBlad] = useState('')

  const paleta = palety.find(p => p.id === paletaId)
  const netto = karton.netKg ?? 0
  const bruttoReczne = Number(wpis.replace(',', '.'))
  const brutto = reczny ? (Number.isFinite(bruttoReczne) ? bruttoReczne : 0) : waga.gross
  const odczytGotowy = reczny
    ? bruttoReczne > 0
    : waga.connected && !waga.error && waga.stable && waga.gross > 0
  const podglad = paleta && brutto > 0 ? werdyktWagi(netto, brutto, paleta) : null
  const mozna = !!paleta && odczytGotowy && !zapis

  function wybierz(id: string) {
    setPaletaId(id)
    try { localStorage.setItem(OSTATNIA_PALETA, id) } catch { /* bez pamięci */ }
  }

  async function zatwierdz() {
    if (!paleta || !karton.code) return
    setZapis(true); setBlad('')
    try {
      const w = await magazynApi.mrozniaWazenie({
        code: karton.code, palletTypeId: paleta.id, grossKg: brutto, mode: reczny ? 'manual' : 'auto' })
      const bladDruku = await drukujEtykieteWagi(w)
      onGotowe(w, bladDruku)
    } catch (e) {
      setBlad(e instanceof Error ? e.message : 'Nie udało się zapisać ważenia')
      setZapis(false)
    }
  }

  let stanWagi = ''
  if (!reczny) {
    if (!waga.connected) stanWagi = 'BRAK POŁĄCZENIA Z WAGĄ'
    else if (waga.error) stanWagi = 'WAGA PRZECIĄŻONA'
    else if (!waga.stable) stanWagi = 'waga się ustala…'
    else if (waga.gross <= 0) stanWagi = 'wjedź kartonem na wagę'
  }

  return (
    <div role="dialog" aria-label="Ważenie kartonu" className="fixed inset-0 z-40 flex flex-col"
      style={{ background: 'var(--bg)' }}>
      <header className="flex items-center gap-4 px-6 py-4" style={{ borderBottom: '1px solid var(--line)' }}>
        <div className="min-w-0 flex-1">
          <div className="text-[12px] font-extrabold uppercase tracking-[0.12em]" style={{ color: 'var(--mut)' }}>
            Wjedź kartonem na wagę · karton {karton.cartonNo}
          </div>
          <div className="truncate text-[26px] font-extrabold">{karton.clientName || 'na magazyn'}</div>
          {karton.scannerless ? <p className="text-sm font-bold text-amber-800">Bez skanów sztuk — porównanie z rozpisem. Zatwierdź tylko po sprawdzeniu fizycznej zawartości kartonu.</p> : null}
          <div className="hmi-v10-mono truncate text-[14px]" style={{ color: 'var(--mut)' }}>
            {karton.orderNo || 'MAGAZYN'} · {(karton.lines ?? []).map(opisPozycji).join(' · ')}
          </div>
          {karton.batches?.length ? (
            <div className="hmi-v10-mono truncate text-[14px]" style={{ color: 'var(--mut)' }}>
              partie: {karton.batches.map(b => `${b.qty} szt ${b.batchNo}`).join(' · ')}
            </div>
          ) : null}
        </div>
        <div className="text-right">
          <div className="text-[12px] font-extrabold uppercase tracking-[0.12em]" style={{ color: 'var(--mut)' }}>{karton.scannerless ? 'Netto z rozpisu' : 'Netto ze sztuk'}</div>
          <div className="hmi-v10-mono text-[40px] font-bold leading-none">{kgPl(netto)} kg</div>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 gap-4 p-6" style={{ gridTemplateColumns: '380px minmax(0, 1fr)' }}>
        <section className="flex flex-col gap-3">
          <div className="text-[12px] font-extrabold uppercase tracking-[0.12em]" style={{ color: 'var(--mut)' }}>1 · Paleta</div>
          {palety.map(p => {
            const wybrana = p.id === paletaId
            return (
              <button key={p.id} type="button" onClick={() => wybierz(p.id)} aria-pressed={wybrana}
                className="rounded-2xl px-5 py-4 text-left"
                style={{
                  background: wybrana ? 'var(--accentSoft)' : 'var(--panel)',
                  border: `2px solid ${wybrana ? 'var(--accent)' : 'var(--line)'}`,
                }}>
                <span className="block text-[22px] font-extrabold">{p.name}</span>
                <span className="hmi-v10-mono block text-[14px]" style={{ color: 'var(--mut)' }}>
                  tara {p.tareMinKg === p.tareMaxKg ? kgPl(p.tareMinKg, 2) : `${kgPl(p.tareMinKg, 2)}–${kgPl(p.tareMaxKg, 2)}`} kg
                </span>
              </button>
            )
          })}
        </section>

        <section className="flex min-h-0 flex-col gap-4">
          <div className="text-[12px] font-extrabold uppercase tracking-[0.12em]" style={{ color: 'var(--mut)' }}>
            2 · Brutto {reczny ? '(wpis ręczny)' : 'z wagi'}
          </div>
          <div className="rounded-2xl p-6" style={{ background: 'var(--panel)', border: '1px solid var(--line)' }}>
            {reczny ? (
              <input aria-label="Brutto ręcznie" inputMode="decimal" autoFocus value={wpis}
                onChange={e => setWpis(e.target.value)} placeholder="np. 780"
                className="hmi-v10-mono w-full bg-transparent text-[88px] font-bold leading-none outline-none" />
            ) : (
              <div className="hmi-v10-mono text-[96px] font-bold leading-none" data-testid="brutto">
                {waga.connected && !waga.error ? `${kgPl(waga.gross)} kg` : '— kg'}
              </div>
            )}
            {stanWagi ? <div className="mt-2 text-[16px] font-bold" style={{ color: 'var(--mut)' }}>{stanWagi}</div> : null}
            <div className="mt-3 flex gap-2">
              {waga.available ? (
                <button type="button" className="rounded-lg px-3 py-2 text-[13px] font-bold"
                  style={{ border: '1px solid var(--line)' }} onClick={() => setReczny(r => !r)}>
                  {reczny ? 'Wróć do wagi' : 'Wpisz ręcznie'}
                </button>
              ) : null}
            </div>
          </div>

          {podglad ? (
            <div className="rounded-2xl px-6 py-5" data-testid="werdykt"
              style={{
                background: podglad.ok ? 'var(--successSoft)' : '#fee2e2',
                border: `2px solid ${podglad.ok ? 'var(--successLine)' : '#dc2626'}`,
                color: podglad.ok ? '#166534' : '#991b1b',
              }}>
              <div className="text-[40px] font-extrabold leading-none">
                {podglad.ok ? 'ZGODNA' : `NIEZGODNA ${roznicaPl(podglad.diffKg)}`}
              </div>
              <div className="mt-1 text-[14px]">
                brutto {kgPl(brutto)} − tara ok. {kgPl(podglad.tareKg, 2)} = {kgPl(brutto - podglad.tareKg)} kg
                · {karton.scannerless ? 'z rozpisu' : 'ze sztuk'} {kgPl(netto)} kg{!podglad.ok ? ' — karton i tak wjedzie, etykieta pokaże różnicę' : ''}
              </div>
            </div>
          ) : !paleta ? (
            <div className="rounded-2xl px-6 py-5 text-[16px]" style={{ border: '1px dashed var(--line)', color: 'var(--mut)' }}>
              Wybierz paletę, na której stoi karton.
            </div>
          ) : null}

          {blad ? <div role="alert" className="rounded-xl px-4 py-3 text-[14px] font-bold"
            style={{ background: '#fee2e2', color: '#991b1b' }}>{blad}</div> : null}

          <div className="mt-auto flex gap-3">
            <button type="button" onClick={onAnuluj} disabled={zapis}
              className="rounded-2xl px-6 py-5 text-[18px] font-bold" style={{ border: '1px solid var(--line)' }}>
              Anuluj
            </button>
            {onPozniej ? (
              <button type="button" onClick={onPozniej} disabled={zapis}
                className="rounded-2xl px-6 py-5 text-[18px] font-bold" style={{ border: '1px solid var(--line)' }}>
                Zważ później
              </button>
            ) : null}
            <button type="button" onClick={() => void zatwierdz()} disabled={!mozna}
              className="flex-1 rounded-2xl px-6 py-5 text-[24px] font-extrabold"
              style={{ background: mozna ? 'var(--accent)' : 'var(--line)', color: '#fff' }}>
              {zapis ? 'Zapisuję…' : 'Zatwierdź, drukuj etykietę i do mroźni'}
            </button>
          </div>
        </section>
      </div>
    </div>
  )
}
