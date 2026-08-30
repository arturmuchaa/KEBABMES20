/**
 * storageState — stan surowca przy przyjęciu: chłodzony albo mrożony.
 *
 * STAN JEST CECHĄ DOSTAWY, NIE RODZAJU SUROWCA. Ta sama wołowina 80/20
 * przyjeżdża raz świeża, raz w blokach; ten sam łój otokowy też. Gdyby stan
 * był cechą rodzaju, słownik podwoiłby się, a receptura („ile łoju
 * otokowego" w product_types.components) musiałaby wybierać między mrożonym
 * a świeżym — a jej to nie obchodzi: instrukcja 2.5 pkt 5.1.1 każe blok
 * rozdrobnić na wilku i wymieszać z mięsem chłodzonym, więc do masowania
 * jedno i drugie wchodzi tak samo.
 *
 * Progi temperatury przy przyjęciu — instrukcja 1.1 oPRP („Kontrola
 * temperatury w komorze"):
 *
 *     drób chłodzony        nie więcej niż  +4 °C
 *     mięso czerwone chł.   nie więcej niż  +7 °C
 *     surowiec mrożony      W KSIĘDZE PROGU NIE MA
 *
 * Ostatni wiersz to luka zgłoszona 30.08.2026: zakład ma magazyn nr 6
 * (−18 °C) i kupuje mrożoną wołowinę, a instrukcja 1.1 wymienia progi
 * wyłącznie dla mięsa chłodzonego. Do czasu poprawki księgi wozimy własny
 * próg −12 °C oznaczony `wKsiedze: false` — karta 1.1.1 pokazuje go jako
 * założenie zakładowe, żeby wydruk nie przypisywał księdze zdania, którego
 * w niej nie ma.
 *
 * Zero importów z React/UI — czysta logika, testowana w node.
 */

export type StorageState = 'chlodzony' | 'mrozony'

/** Kolejność dla selecta; chłodzony pierwszy, bo tak jeździ większość dostaw. */
export const STORAGE_STATES: StorageState[] = ['chlodzony', 'mrozony']

/**
 * Dostawy sprzed wprowadzenia stanu to surowiec chłodzony — jedyny, jaki
 * zakład dotąd przyjmował (drób z magazynu nr 3).
 */
export const DEFAULT_STATE: StorageState = 'chlodzony'

export function normalizeStan(state: string | undefined | null): StorageState {
  return state === 'mrozony' ? 'mrozony' : DEFAULT_STATE
}

const ETYKIETY: Record<StorageState, string> = {
  chlodzony: 'Chłodzony',
  mrozony:   'Mrożony',
}

export function etykietaStanu(state: string | undefined | null): string {
  return ETYKIETY[normalizeStan(state)]
}

export interface MagazynStanu {
  /** Numer pomieszczenia z zestawienia zakładu (projekt technologiczny). */
  nr:    number
  nazwa: string
  /** Temperatura POMIESZCZENIA — nie mylić z progiem przyjęcia. */
  temp:  string
}

const MAGAZYNY: Record<StorageState, MagazynStanu> = {
  chlodzony: { nr: 3, nazwa: 'Magazyn surowców',         temp: 'do +3 °C' },
  mrozony:   { nr: 6, nazwa: 'Magazyn surowca mrożonego', temp: '−18 °C' },
}

/** Do którego magazynu fizycznie idzie ta dostawa. */
export function magazynStanu(state: string | undefined | null): MagazynStanu {
  return MAGAZYNY[normalizeStan(state)]
}

export interface ProgTemperatury {
  maxC: number
  /** Gotowy do wydruku, z półpauzą minus (nie łącznikiem). */
  opis: string
  /** false = próg zakładowy, instrukcja 1.1 go NIE zawiera. */
  wKsiedze: boolean
}

/**
 * Próg temperatury dla kolumny „Komora [°C]" karty 1.1.1.
 *
 * Stan wygrywa nad kategorią: blok mrożony ocenia się tak samo, niezależnie
 * od tego, czy to wołowina, czy drób.
 */
export function progPrzyjecia(
  category: string | undefined | null,
  state: string | undefined | null,
): ProgTemperatury {
  if (normalizeStan(state) === 'mrozony') {
    return { maxC: -12, opis: '≤ −12 °C', wKsiedze: false }
  }
  return czyCzerwone(category)
    ? { maxC: 7, opis: '≤ +7 °C', wKsiedze: true }
    : { maxC: 4, opis: '≤ +4 °C', wKsiedze: true }
}

/**
 * Czy rodzaj surowca jest mięsem czerwonym.
 *
 * Jedno miejsce na tę decyzję, bo wisi na niej i zbiorcza zakładka przyjęcia,
 * i zakładka magazynu, i to, czy formularz w ogóle pyta o stan. Drób jeździ
 * do tego zakładu wyłącznie świeży, a formularz przyjęcia biuro wypełnia ~45
 * razy w miesiącu — pole, które zawsze ma tę samą wartość, byłoby tam tylko
 * zaproszeniem do pomyłki. Gdyby kiedyś przyjechał mrożony filet z kurczaka,
 * poszerza się TĘ funkcję, a nie trzy ekrany osobno.
 */
export function czyCzerwone(category: string | undefined | null): boolean {
  return category === 'czerwone'
}
