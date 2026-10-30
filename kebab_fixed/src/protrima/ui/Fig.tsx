import React from 'react'

/**
 * Liczba z jednostką na wskaźniku: „8 295 kg” → 8 295 + mniejsze, jaśniejsze „kg”.
 * Bohaterem jest liczba; jednostka jest podpisem, nie drugą liczbą.
 * Tekst bez jednostki zostaje bez zmian. Styl: `.fig small`.
 */
export function fig(text: string): React.ReactNode {
  const m = /^(.*\d)\s*([^\d\s][^\d]*)$/.exec(text)
  return m ? <>{m[1]}<small>{m[2]}</small></> : text
}
