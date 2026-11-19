/**
 * Okno druku montowane na żądanie (własny korzeń React w <body>) — działa na
 * każdej stronie, także w osobnych oknach wydruku, bez zmian w App.
 */
import React from 'react'
import { createRoot } from 'react-dom/client'
import { OknoDruku, type WynikOkna, type ZrodloDruku } from './OknoDruku'
import type { RodzajDruku } from './rodzaje'

let otwarte: Promise<WynikOkna> | null = null

export function otworzOknoDruku(p: { rodzaj: RodzajDruku; tytul: string; zrodlo: ZrodloDruku }): Promise<WynikOkna> {
  if (otwarte) return otwarte // drugi klik „Drukuj”, gdy okno już stoi
  const host = document.createElement('div')
  host.className = 'okno-druku-host'
  document.body.appendChild(host)
  const korzen = createRoot(host)
  otwarte = new Promise<WynikOkna>(resolve => {
    const zamknij = (w: WynikOkna) => {
      korzen.unmount(); host.remove(); otwarte = null
      resolve(w)
    }
    korzen.render(<OknoDruku rodzaj={p.rodzaj} tytul={p.tytul} zrodlo={p.zrodlo} onZamknij={zamknij} />)
  })
  return otwarte
}
