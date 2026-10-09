/**
 * Etykieta ważenia kartonu przy wjeździe do mroźni — ZPL 100×150 mm, 203 dpi.
 *
 * Firmowe potwierdzenie ważenia z HMI magazynu (nie kartka A4 z biura).
 * Logo jak na dokumentach, netto ZE SZTUK, brutto Z WAGI i zapisany werdykt.
 * QR do załadunku: osobne pole 32×32 mm, minimum 4 moduły białego marginesu.
 * Dane i kod pochodzą z zapisanego ważenia — dodruk nie przelicza wyniku.
 */
import QRCode from 'qrcode'
import type { WazenieMrozni } from '@/lib/api'
import logo from './assets/ksiezyc-logo-203dpi.grf?raw'
import { kgPl, opisPozycji, roznicaPl } from './wazenieMrozni'

export const WAGA_DPI = 203
export const WAGA_W_MM = 100
export const WAGA_H_MM = 150
const M = 5 // wspólna lewa krawędź wszystkich sekcji

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
  return (v ?? '').replace(/[\^~\r\n\t]/g, ' ')
}

/** Pole tekstowe; `maxMm` = szerokość dostępna od `x`. */
function t(x: number, y: number, fontMm: number, value: string, maxMm: number, odwrocony = false, center = false): string {
  const text = esc(value)
  const f = dopasuj(text, fontMm, maxMm, Math.min(2.6, fontMm))
  const h = mm(f)
  // Ekstremalnie długie pole zwężamy zamiast wychodzić na sąsiednią kolumnę.
  const width = Math.min(h, Math.max(1, Math.floor(mm(maxMm) / (Math.max(1, text.length) * A0_SZER))))
  return `^FO${mm(x)},${mm(y)}^A0N,${h},${width}${center ? `^FB${mm(maxMm)},1,0,C` : ''}${odwrocony ? '^FR' : ''}^FD${text}^FS`
}

function kreska(y: number): string {
  return `^FO${mm(M)},${mm(y)}^GB${mm(WAGA_W_MM - 2 * M)},2,2^FS`
}

function dwieLinie(text: string): string[] {
  const srodek = Math.ceil(text.length / 2)
  const spacje = Array.from(text.matchAll(/ /g), m => m.index!)
  const podzial = spacje.length
    ? spacje.reduce((a, b) => Math.abs(b - srodek) < Math.abs(a - srodek) ? b : a)
    : srodek
  return [text.slice(0, podzial), text.slice(podzial).trim()]
}

/** Długi odbiorca: dwa wiersze zamiast drobnego napisu w nagłówku. */
function klient(value: string): string[] {
  const text = esc(value || 'NA MAGAZYN').trim()
  if (szerokoscMm(text, 3.4) <= 47) return [t(48, 28, 5.5, text, 47)]
  return dwieLinie(text).map((line, i) => t(48, 28 + i * 4.2, 3.4, line, 47))
}

/** Rozmiar z pełnego kodu (UUID), a nie z krótkiego przykładu „c1”.
 * Tryb bajtowy daje bezpieczny górny limit liczby modułów dla auto-ZPL.
 * ^FO wskazuje symbol; biały margines mieści się w zarezerwowanym polu. */
function qr(kod: string): string {
  const text = esc(kod)
  const modules = QRCode.create([{ data: new TextEncoder().encode(text), mode: 'byte' }], { errorCorrectionLevel: 'Q' }).modules.size
  const box = mm(32)
  const magnification = Math.min(10, Math.floor(box / (modules + 8)))
  const inset = Math.floor((box - modules * magnification) / 2)
  return `^FO${mm(63) + inset},${mm(113) + inset}^BQN,2,${magnification}^FDQA,${text}^FS`
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
  const netto = `${kgPl(w.netKg)} kg`
  const brutto = `${kgPl(w.grossKg)} kg`
  const fontMasy = Math.min(dopasuj(netto, 11, 43), dopasuj(brutto, 11, 43))
  const operator = esc(`Operator: ${w.operator || '—'}`)
  const operatorLines = szerokoscMm(operator, 3.2) <= 53 ? [operator] : dwieLinie(operator)

  const body: string[] = [
    `^FO${mm(M)},${mm(5)}${logo.trim()}^FS`,
    t(M, 21, 3, 'POTWIERDZENIE WAŻENIA', W),
    kreska(25),
    t(M, 28, 2.7, 'KARTON', 39),
    t(M, 32.5, 8.5, w.cartonNo, 39),
    ...klient(w.clientName),
    t(48, 38.5, 2.8, nosnik, 47),
    kreska(43),
    t(M, 46, 2.7, w.scannerless ? 'ROZPIS — BEZ SKANÓW SZTUK' : 'SKŁAD KARTONU', W),
    ...pozycje.map((l, i) => t(M, 50.5 + i * 4.5, 4, opisPozycji(l), W)),
  ]
  if (reszta > 0) body.push(t(62, 46, 2.7, `+ ${reszta} poz. więcej`, 33))

  // PARTIE — właściciel 29.09.2026: „ile sztuk z jakiej partii, ładnie
  // rozpisane w słupku". Dwa słupki „ilość | partia", wypełniane najpierw
  // w dół; to, co się nie zmieści przed kreską NETTO, idzie w „+N".
  const partie = w.batches ?? []
  if (partie.length) {
    const yEtykiety = 52 + pozycje.length * 4.5
    const y0 = yEtykiety + 4
    const KROK = 4
    const wierszy = Math.max(1, 1 + Math.floor((77 - y0 - 3.4) / KROK))
    const miejsc = wierszy * 2
    const widoczne = partie.length > miejsc ? partie.slice(0, miejsc - 1) : partie
    const ukryte = partie.length - widoczne.length
    body.push(t(M, yEtykiety, 2.7, 'PARTIE', W))
    widoczne.forEach((p, i) => {
      const x = i < wierszy ? M : 52
      const y = y0 + (i % wierszy) * KROK
      body.push(t(x, y, 3.2, `${p.qty} szt`, 12), t(x + 13, y, 3.4, p.batchNo, 30))
    })
    if (ukryte > 0) {
      body.push(t(52, y0 + (wierszy - 1) * KROK, 3, `+ ${ukryte} partii więcej`, 43))
    }
  }

  body.push(
    kreska(78),
    t(M, 81, 3, w.scannerless ? 'NETTO (rozpis)' : 'NETTO (sztuki)', 43),
    t(M, 85.5, fontMasy, netto, 43),
    t(52, 81, 3, 'BRUTTO (waga)', 43),
    t(52, 85.5, fontMasy, brutto, 43),
    `^FO${mm(49)},${mm(81)}^GB2,${mm(15)},2^FS`,
    // Właściciel 29.09.2026: na etykiecie sam rodzaj palety, bez widełek tary.
    t(M, 98, 3.2, `Paleta ${w.palletTypeName}`, W),
    // Spokojna ramka = zgodna. Pełna czerń wyróżnia tylko niezgodność.
    `^FO${mm(M)},${mm(104)}^GB${mm(W)},${mm(9)},${w.ok ? 3 : mm(9)}^FS`,
    t(M + 3, 105.8, 7, werdykt, W - 6, !w.ok, true),
    t(M, 118, 2.7, 'WAŻONO', 53),
    t(M, 123, 4.5, dataGodzina(w.weighedAt), 53),
    ...operatorLines.map((line, i) => t(M, 131 + i * 4.5, 3.2, line, 53)),
    ...(w.weighMode === 'manual' ? [t(M, 141, 3.2, 'RĘCZNIE', 53)] : []),
    // Pełne pole 32×32 mm jest wolne od tekstu, ramek i linii.
    qr(kod),
  )

  return [
    '^XA',
    '^CI28',
    `^PW${mm(WAGA_W_MM)}`,
    `^LL${mm(WAGA_H_MM)}`,
    '^LH0,0',
    '^PON',
    '^FWN',
    '^LRN',
    '^MNY',
    '^LS0',
    ...body,
    '^XZ',
  ].join('\n')
}
