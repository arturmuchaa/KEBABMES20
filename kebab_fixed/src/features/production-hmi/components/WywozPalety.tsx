/**
 * Wynik skanu palety mięsa przyprawionego przy wywozie z chłodni na halę.
 *
 * Właściciel 26.11.2026: „kierownik skanuje, co bierze na halę, i system go
 * puszcza albo nie, w zależności od tego, co robi z planu". Zielone: paleta
 * jest w planie na dziś i system mówi, do której pozycji. Czerwone: blokada
 * z powodem z serwera — zostaje na ekranie, dopóki kierownik jej nie zamknie
 * (patrzy na wózek, nie na monitor).
 */
export type WynikWywozu =
  | { ok: true; again?: boolean; palletNo: number | string; batchNo: string; recipeName?: string; lines: { lineId: string; label: string }[] }
  | { ok: false; komunikat: string }

export function WywozPalety({ wynik, onZamknij }: { wynik: WynikWywozu | null; onZamknij: () => void }) {
  if (!wynik) return null
  const ok = wynik.ok
  return (
    <div role={ok ? 'status' : 'alert'} data-testid="wywoz-palety"
      className="flex items-center gap-4 px-5 py-3"
      style={{
        borderRadius: 12, margin: '8px 12px 0',
        background: ok ? '#ECFDF3' : '#FEF2F2',
        border: `1.5px solid ${ok ? '#86EFAC' : '#FCA5A5'}`,
        color: ok ? '#14532D' : '#7F1D1D',
      }}>
      <span className="text-[30px] font-extrabold leading-none" aria-hidden>{ok ? '✓' : '✕'}</span>
      <div className="flex-1 min-w-0">
        {wynik.ok ? (
          <>
            <div className="text-[19px] font-extrabold">
              Paleta {wynik.palletNo} · partia <span className="hmi-v10-mono">{wynik.batchNo}</span> — {wynik.again ? 'już wywieziona do tego planu' : 'można brać na halę'}
            </div>
            <div className="text-[15px] font-bold mt-0.5">
              {wynik.lines.map(l => l.label).join('  ·  ')}
            </div>
          </>
        ) : (
          <>
            <div className="text-[19px] font-extrabold">Nie bierz tej palety</div>
            <div className="text-[15px] font-bold mt-0.5">{(wynik as { komunikat: string }).komunikat}</div>
          </>
        )}
      </div>
      <button type="button" onClick={onZamknij} className="text-[15px] font-bold"
        style={{ height: 48, padding: '0 20px', borderRadius: 10, border: '1px solid currentColor', background: 'transparent', color: 'inherit' }}>
        {ok ? 'OK' : 'Rozumiem'}
      </button>
    </div>
  )
}
