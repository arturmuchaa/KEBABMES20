import React from 'react'

/** Szerokości pasków — różne, żeby szkielet wyglądał jak dane, a nie jak siatka. */
const SZER = [72, 46, 88, 58, 64, 38, 80, 52]

/**
 * Szkielet wierszy tabeli na czas PIERWSZEGO wczytania — zamiast napisu
 * „Pobieranie…” i zamiast mylącego „Brak pozycji”, zanim dane w ogóle przyszły.
 */
export function SzkieletWierszy({ kolumny, wiersze = 8 }: { kolumny: number; wiersze?: number }) {
  return (
    <>
      {Array.from({ length: wiersze }, (_, i) => (
        <tr key={i} className="sk-row" aria-hidden={i > 0 ? true : undefined}>
          {Array.from({ length: kolumny }, (_, j) => (
            <td key={j}>
              {i === 0 && j === 0 && <span className="sr" role="status">Wczytywanie danych…</span>}
              <span className="sk" style={{ width: `${SZER[(i * 3 + j) % SZER.length]}%` }} />
            </td>
          ))}
        </tr>
      ))}
    </>
  )
}

/** Szkielet bloku (formularz, panel) — kilka pasków tekstu. */
export function SzkieletBloku({ linie = 4, opis = 'Wczytywanie…' }: { linie?: number; opis?: string }) {
  return (
    <div className="sk-block" role="status" aria-label={opis}>
      {Array.from({ length: linie }, (_, i) => <span key={i} className="sk" style={{ width: `${SZER[i % SZER.length]}%` }} />)}
    </div>
  )
}
