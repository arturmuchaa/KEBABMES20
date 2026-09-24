/**
 * Łańcuch etapów palety: produkcja → magazyn → karton → paleta → wydanie.
 *
 * Właściciel 24.09.2026: „P1 na auto nic mi nie mówi — chcę skład palety
 * i łańcuch skanowania, gdzie ewentualnie jaka sztuka zaginęła przy
 * reklamacji".
 *
 * NAJWAŻNIEJSZA DECYZJA: rozróżniamy „brak zdarzeń" od „brak źródła".
 *   • `pusty`      — etap MA skąd brać skany, ale tej palety nikt tu nie tknął.
 *                    To realna informacja (paleta nie była w mroźni).
 *   • `brak_zrodla` — etapu nie skanuje dziś NIKT, więc milczenie nic nie znaczy.
 *
 * Bez tego rozróżnienia okno odpowiadałoby „brak danych" na oba przypadki,
 * a przy reklamacji to różnica między „paleta ominęła mroźnię" a „dalej niż
 * paleta nie wiemy, bo hala nie skanuje sztuk".
 *
 * Stan na 24.09.2026: `finished_units` ma 89 wierszy, jeden 'produced'
 * i zero przypisanych do palety — trzy pierwsze etapy są więc bez źródła.
 * Gdy hala zacznie skanować, ożyją SAME, bez przebudowy okna.
 *
 * Zero importów z Reacta — czysta funkcja do testów.
 */
export interface ZdarzenieSkanu {
  action: string
  scanned_at: string
  operator: string
  vehicle: string
}

export interface PozycjaSkladu {
  qty: number
  kg_per_unit: number
  rodzaj: string
  receptura: string
}

export interface SladPalety {
  pallet_no: number
  status: string
  sklad: PozycjaSkladu[]
  /** Ile sztuk wg rozpisu biura kontra ile ma WŁASNY numer w systemie. */
  sztuki: { zadeklarowane: number; sledzone: number }
  zdarzenia: ZdarzenieSkanu[]
}

export type KodEtapu = 'produkcja' | 'magazyn' | 'karton' | 'paleta' | 'wydanie'
export type StanEtapu = 'jest' | 'pusty' | 'brak_zrodla'

export interface Etap {
  kod: KodEtapu
  nazwa: string
  opis: string
  stan: StanEtapu
  zdarzenia: ZdarzenieSkanu[]
}

/** Skany, które opisują PALETĘ jako całość. Reszta akcji to wydanie —
 *  patrz `etapyPalety`, nieznany rodzaj skanu nie może wyparować. */
const AKCJE_PALETY = ['cold_storage', 'reset']

interface Regula {
  kod: KodEtapu
  nazwa: string
  opis: string
  /** Etap sztukowy czyta `finished_units`; paletowy — `pallet_scans`. */
  sztukowy: boolean
  pasuje?: (akcja: string) => boolean
}

const REGULY: Regula[] = [
  { kod: 'produkcja', nazwa: 'Produkcja', opis: 'sztuka zgłoszona z produkcji', sztukowy: true },
  { kod: 'magazyn',   nazwa: 'Magazyn',   opis: 'sztuka przyjęta na stan',      sztukowy: true },
  { kod: 'karton',    nazwa: 'Karton',    opis: 'sztuka spakowana do kartonu',  sztukowy: true },
  { kod: 'paleta',    nazwa: 'Paleta',    opis: 'paleta w mroźni',              sztukowy: false,
    pasuje: a => AKCJE_PALETY.includes(a) },
  { kod: 'wydanie',   nazwa: 'Wydanie',   opis: 'paleta na aucie',              sztukowy: false,
    pasuje: a => !AKCJE_PALETY.includes(a) },
]

export function etapyPalety(p: SladPalety): Etap[] {
  const zdarzenia = p.zdarzenia ?? []
  const sledzone = p.sztuki?.sledzone ?? 0

  return REGULY.map(r => {
    // Etapy sztukowe nie mają dziś własnych zdarzeń — backend oddaje z nich
    // wyłącznie liczbę sztuk. Gdy hala zacznie skanować, wejdą tu skany
    // sztuk i ta sama funkcja policzy stan bez żadnej zmiany.
    const moje = r.sztukowy ? [] : zdarzenia.filter(z => r.pasuje!(z.action))
    const maZrodlo = r.sztukowy ? sledzone > 0 : true
    return {
      kod: r.kod,
      nazwa: r.nazwa,
      opis: r.opis,
      zdarzenia: moje,
      stan: moje.length > 0 ? 'jest' : maZrodlo ? 'pusty' : 'brak_zrodla',
    } as Etap
  })
}
