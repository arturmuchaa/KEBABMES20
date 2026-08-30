/**
 * receptionRegisterRows — dane MES → wiersze kart HACCP 1.1.1 i 1.1.1/2.
 *
 * Karta 1.1.1 rejestruje DOSTAWY (jeden wiersz = jeden numer przyjęcia),
 * karta 1.1.1/2 rozbija każdą dostawę na NUMERY PORZĄDKOWE.
 *
 * Karty NIE są równorzędne i to jest tu najważniejsze:
 *   * 1.1.1 ma sześć kolumn powstających PRZY AUCIE (ocena wizualna,
 *     temperatura komory i mięsa, zgodność kg, kwalifikacja, podpisy).
 *     Tych nie wypełniamy nigdy — nie ma ich skąd wziąć, a wydruk na koniec
 *     miesiąca i tak nie da się już uzupełnić długopisem przy dostawie.
 *     System podaje wyłącznie kolumny a-e (numery, dostawca, asortyment,
 *     data, dokument) i służy to sprawdzeniu albo odtworzeniu karty.
 *   * 1.1.1/2 nie ma ŻADNEJ kolumny pomiarowej, więc drukuje się kompletna:
 *     wszystko poza uwagami i podpisem system zna, łącznie z mięsem
 *     z rozbioru.
 *
 * Zero importów z React/UI — moduł ma się dać przetestować w vitest.
 */
import type { Reception } from '@/types'

/** Formy prawne obcinane w kolumnie „skrócona nazwa dostawcy". */
const LEGAL_FORMS = [
  /\s+SP[ÓO]ŁKA\s+Z\s+OGRANICZON[ĄA]\s+ODPOWIEDZIALNO[ŚS]CI[ĄA].*$/i,
  /\s+SP[ÓO]ŁKA\s+(AKCYJNA|JAWNA|KOMANDYTOWA).*$/i,
  /\s+SP\.\s*Z\s*O\.?\s*O\.?.*$/i,
  /\s+S\.?A\.?$/i,
]

/**
 * shortSupplier — kolumna (b) ma 27 mm, a pełna nazwa z KRS ma 45 znaków.
 * Obcinamy formę prawną, nie nazwę: „KOKO SPÓŁKA Z OGRANICZONĄ…" → „KOKO".
 */
export function shortSupplier(name: string): string {
  let out = (name || '').trim().replace(/^["„]|["”]$/g, '')
  for (const re of LEGAL_FORMS) out = out.replace(re, '')
  return out.replace(/["„”]/g, '').trim()
}

/** ISO → dd.mm.rrrr; puste zostaje puste (pusta kratka, nie „Invalid Date"). */
export function plDate(iso: string): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return ''
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}.${m}.${y}`
}

/** Liczba po polsku, bez zer końcowych: 5235 → „5235", 12.5 → „12,5". */
export function plNum(n: number, decimals = 1): string {
  if (!Number.isFinite(n) || n === 0) return ''
  return n.toLocaleString('pl-PL', { maximumFractionDigits: decimals })
}

/**
 * liveBatches — numery porządkowe, które NAPRAWDĘ przyjechały.
 *
 * Anulowana rejestracja to korekta naszej własnej pomyłki przy wpisywaniu,
 * a nie zdarzenie przy rampie: w bazie ma techniczny numer „ANUL-<id>",
 * którego nie wolno wydrukować na karcie HACCP, i podbijałaby wagę dostawy
 * (7/08/2026 FARMEX: 20 010 kg zamiast 10 005). Dostawa ODRZUCONA przy aucie
 * to co innego — tę rejestruje się normalnie i opisuje w kolumnie oceny.
 */
function liveBatches(r: Reception) {
  return r.batches.filter(b => b.status !== 'cancelled')
}

/**
 * documentLabel — kolumna (e): „HDI lub numer faktury, WZ lub inny dokument
 * przywozowy". HDI dostawcy ma własny numer i osobno wskazuje dokument
 * handlowy („Nr 33656 do dokumentu WZ 388/MDU/08/2026"), więc na karcie
 * podajemy oba — inspektor po każdym z nich trafi do tej samej dostawy.
 */
export function documentLabel(hdiNo: string, documentNo: string): string {
  const hdi = (hdiNo || '').trim()
  const doc = (documentNo || '').trim()
  if (hdi && doc) return `HDI ${hdi} / ${doc}`
  return hdi ? `HDI ${hdi}` : doc
}

/**
 * assortmentLabel — kolumna (c): rodzaj surowca, a przy blokach także STAN.
 *
 * Stan dopisujemy tylko mrożonemu i tylko dlatego, że inaczej karta sama
 * sobie przeczy: legenda podaje próg +7 °C dla mięsa czerwonego, a obok
 * stoi wpisane ręką −15 °C i wygląda to jak niezgodność. Chłodzony dopisku
 * nie dostaje — to stan domyślny i zaśmiecałby wąską kolumnę.
 *
 * To nie jest wypełnianie kolumny pomiarowej: stan deklaruje biuro przy
 * rejestracji dostawy, tak samo jak rodzaj surowca obok.
 */
export function assortmentLabel(materialName: string, storageState?: string): string {
  const nazwa = (materialName || '').trim()
  if (!nazwa) return ''
  return storageState === 'mrozony' ? `${nazwa} (mrożona)` : nazwa
}

/**
 * mainRows — karta 1.1.1: jeden wiersz na DOSTAWĘ.
 *
 * Kolumny f–m (ocena wizualna, temperatury, zgodność, uwagi, kwalifikacja,
 * podpisy) zostają puste — wypełnia je odbierający przy aucie.
 */
export function mainRows(receptions: Reception[], cols: number): string[][] {
  return [...receptions]
    .filter(r => liveBatches(r).length > 0)
    .sort((a, b) => a.receivedDate.localeCompare(b.receivedDate) ||
      a.receptionNo.localeCompare(b.receptionNo, 'pl', { numeric: true }))
    .map(r => {
      const assortment = [...new Set(liveBatches(r)
        .map(b => assortmentLabel(b.materialName || '', b.storageState))
        .filter(Boolean))]
      const row = [
        r.receptionNo,
        shortSupplier(r.supplierName),
        assortment.join(', '),
        plDate(r.receivedDate),
        documentLabel(r.hdiNo, r.documentNo),
      ]
      return [...row, ...Array(Math.max(0, cols - row.length)).fill('')]
    })
}

/**
 * detailRows — karta 1.1.1/2: jeden wiersz na NUMER PORZĄDKOWY.
 *
 * Ta karta NIE ma kolumn pomiarowych (temperatur, oceny wizualnej), więc
 * w odróżnieniu od 1.1.1 drukuje się kompletna na koniec miesiąca.
 * „Mięso [kg]" (g) jest wtedy już znane z rozbioru; partia jeszcze
 * nierozebrana zostaje pusta, zamiast pokazywać zero.
 */
export function detailRows(receptions: Reception[], cols: number): string[][] {
  const out: string[][] = []
  for (const r of [...receptions].sort((a, b) =>
    a.receivedDate.localeCompare(b.receivedDate) ||
    a.receptionNo.localeCompare(b.receptionNo, 'pl', { numeric: true }))) {
    for (const b of liveBatches(r)) {
      const row = [
        r.receptionNo,
        b.internalBatchNo,
        plNum(Number(b.kgReceived)),
        plDate(b.slaughterDate),
        plDate(b.expiryDate),
        plNum(Number(b.pricePerKg), 2),
        plNum(Number(b.kgMeat ?? 0)),
      ]
      out.push([...row, ...Array(Math.max(0, cols - row.length)).fill('')])
    }
  }
  return out
}

/**
 * paginate — wiersze na kartki.
 *
 * Zawsze co najmniej jedna strona: miesiąc bez dostaw ma się wydrukować jako
 * pusta karta do ręcznego wypełnienia, a nie zniknąć.
 */
export function paginate<T>(rows: T[], perPage: number): T[][] {
  if (rows.length === 0) return [[]]
  const pages: T[][] = []
  for (let i = 0; i < rows.length; i += perPage) pages.push(rows.slice(i, i + perPage))
  return pages
}
