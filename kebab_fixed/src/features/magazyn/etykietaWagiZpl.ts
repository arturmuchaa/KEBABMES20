/**
 * Etykieta ważenia kartonu przy wjeździe do mroźni — ZPL 100×150 mm, 203 dpi.
 *
 * Nakleja się ją na karton przed mroźnią (właściciel, 29.09.2026): skład
 * („15 × 50 kg ZAGROS"), NETTO ze sztuk, BRUTTO z wagi, paleta, werdykt
 * ZGODNA / NIEZGODNA ±X kg w negatywie oraz DATA I GODZINA ważenia.
 * QR niesie ten sam kod co kartka kartonu — etykietę też da się zeskanować.
 *
 * Czcionka skalowalna A0: długie nazwy (klient, receptura) zmniejszają się,
 * zamiast wychodzić poza taśmę. Test liczy szerokość każdego pola.
 */
import type { WazenieMrozni } from '@/lib/api'
import { kgPl, opisPozycji, roznicaPl } from './wazenieMrozni'

export const WAGA_DPI = 203
export const WAGA_W_MM = 100
export const WAGA_H_MM = 150
const M = 4 // margines

/** Średnia szerokość znaku A0 względem wysokości — z zapasem na wersaliki. */
export const A0_SZER = 0.62

export function mm(v: number, dpi = WAGA_DPI): number {
  return Math.round((v * dpi) / 25.4)
}

/** Szacunkowa szerokość napisu w mm dla fontu A0 o wysokości `fontMm`. */
export function szerokoscMm(tekst: string, fontMm: number): number {
  return tekst.length * fontMm * A0_SZER
}

/** Największa czcionka ≤ `fontMm`, przy której napis mieści się w `maxMm`. */
export function dopasuj(tekst: string, fontMm: number, maxMm: number, minMm = 3): number {
  if (!tekst) return fontMm
  return Math.max(minMm, Math.min(fontMm, maxMm / (tekst.length * A0_SZER)))
}

function esc(v: string): string {
  return (v ?? '').replace(/[\^~]/g, ' ')
}

/** Pole tekstowe; `maxMm` = szerokość dostępna od `x`. */
function t(x: number, y: number, fontMm: number, value: string, maxMm: number, odwrocony = false): string {
  const f = dopasuj(value, fontMm, maxMm)
  const h = mm(f)
  return `^FO${mm(x)},${mm(y)}^A0N,${h},${h}${odwrocony ? '^FR' : ''}^FD${esc(value)}^FS`
}

function kreska(y: number): string {
  return `^FO${mm(M)},${mm(y)}^GB${mm(WAGA_W_MM - 2 * M)},${mm(0.6)},${mm(0.6)}^FS`
}

/** „29.09.2026 10:24" w czasie lokalnym panelu. */
export function dataGodzina(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export interface OpcjeEtykiety { kod: string; dpi?: number }

export function etykietaWagiZpl(w: WazenieMrozni, { kod }: OpcjeEtykiety): string {
  const W = WAGA_W_MM - 2 * M
  const pozycje = w.lines.slice(0, 3)
  const reszta = w.lines.length - pozycje.length
  const werdykt = w.ok ? 'ZGODNA' : `NIEZGODNA ${roznicaPl(w.diffKg)}`
  const nosnik = w.containerKind === 'order'
    ? `ZAMÓWIENIE ${w.orderNo}`.trim()
    : 'MAGAZYN'

  const body: string[] = [
    t(M, 4, 9, `KARTON ${w.cartonNo}`, W),
    t(M, 15, 8, w.clientName || 'na magazyn', W),
    t(M, 25, 4.5, nosnik, W),
    kreska(31.5),
    t(M, 33.5, 3.2, 'SKŁAD', W),
    ...pozycje.map((l, i) => t(M, 37.5 + i * 6, 5, opisPozycji(l), W)),
  ]
  if (reszta > 0) body.push(t(55, 33.5, 3.2, `+ ${reszta} poz. więcej`, W - 51))

  // PARTIE — właściciel 29.09.2026: „ile sztuk z jakiej partii, ładnie
  // rozpisane w słupku". Dwa słupki „ilość | partia", wypełniane najpierw
  // w dół; to, co się nie zmieści przed kreską NETTO, idzie w „+N".
  const partie = w.batches ?? []
  if (partie.length) {
    const yEtykiety = 37.5 + pozycje.length * 6 + 0.5
    const y0 = yEtykiety + 4
    const KROK = 5
    const wierszy = Math.max(1, Math.floor((73 - y0) / KROK))
    const miejsc = wierszy * 2
    const widoczne = partie.length > miejsc ? partie.slice(0, miejsc - 1) : partie
    const ukryte = partie.length - widoczne.length
    body.push(t(M, yEtykiety, 3.2, 'PARTIE', W))
    widoczne.forEach((p, i) => {
      const x = i < wierszy ? M : 52
      const y = y0 + (i % wierszy) * KROK
      body.push(t(x, y, 4.3, `${p.qty} szt`, 16.5), t(x + 17, y, 4.3, p.batchNo, 27))
    })
    if (ukryte > 0) {
      body.push(t(52, y0 + (wierszy - 1) * KROK, 3.5, `+ ${ukryte} partii więcej`, 40))
    }
  }

  body.push(
    kreska(74),
    t(M, 77, 3.5, 'NETTO (sztuki)', 44),
    t(M, 81.5, 11, `${kgPl(w.netKg)} kg`, 44),
    t(52, 77, 3.5, 'BRUTTO (waga)', 44),
    t(52, 81.5, 11, `${kgPl(w.grossKg)} kg`, 44),
    // Właściciel 29.09.2026: na etykiecie sam rodzaj palety, bez widełek tary.
    t(M, 94.5, 5, `Paleta ${w.palletTypeName}`, W),
    // Werdykt w negatywie: czarne pole, biały napis — widać z drugiego końca mroźni.
    `^FO${mm(M)},${mm(101)}^GB${mm(W)},${mm(17)},${mm(17)}^FS`,
    t(M + 3, 104, 11, werdykt, W - 6, true),
    t(M, 122, 3.5, 'WAŻONO', 66),
    t(M, 126.5, 7, dataGodzina(w.weighedAt), 66),
    t(M, 136, 4, [w.operator, w.weighMode === 'manual' ? 'RĘCZNIE' : ''].filter(Boolean).join(' · '), 66),
    // QR: kod kartki kartonu (PAL|… / SCARTON|…), prawy dolny róg.
    `^FO${mm(73)},${mm(121)}^BQN,2,4^FDQA,${esc(kod)}^FS`,
  )

  return [
    '^XA',
    '^CI28',
    `^PW${mm(WAGA_W_MM)}`,
    `^LL${mm(WAGA_H_MM)}`,
    '^LH0,0',
    '^MNY',
    '^LS0',
    ...body,
    '^XZ',
  ].join('\n')
}
