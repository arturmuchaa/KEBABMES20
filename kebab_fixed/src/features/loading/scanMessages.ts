/**
 * Komunikaty skanu załadunku — czysta funkcja, bez Reacta.
 *
 * Operator musi NATYCHMIAST wiedzieć, co się stało, a magazyn nie jest
 * miejscem na czytanie zdań złożonych. Stąd dwa poziomy: krótki nagłówek
 * (czytelny z dwóch metrów) i jedno zdanie szczegółu pod spodem.
 *
 * Źródłem jest KOD z backendu, nie treść komunikatu — tłumaczenie albo
 * literówka po stronie serwera nie może po cichu zepsuć obsługi błędu.
 * Techniczne błędy backendu (stack trace, SQL) nigdy nie trafiają na ekran:
 * nieznany kod dostaje zdanie ogólne, a szczegół ląduje tylko w konsoli.
 */
import type { PozaKolejnoscia, ScanResultCode } from '@/lib/api'

/** 'OFFLINE' nie przychodzi z backendu — powstaje, gdy żądanie w ogóle
 *  nie doszło. Traktujemy je jak osobny wynik, bo operator musi wiedzieć,
 *  że skan NIE został zapisany. */
export type WynikSkanu = ScanResultCode | 'OFFLINE'

export interface KomunikatSkanu {
  ok: boolean
  /** Wielki napis — to widzi operator jako pierwsze. */
  naglowek: string
  /** Jedno zdanie kontekstu (numer palety, zamówienie). */
  szczegol: string
  /** Kolor ekranu. Domyślnie wynika z `ok` (zielony/czerwony); `uwaga` to
   *  trzeci przypadek: skan PRZESZEDŁ, ale operator ma coś sprawdzić.
   *  Bez tego skan poza kolejnością musiałby udawać sukces (zielono,
   *  niezauważalnie) albo błąd (czerwono, choć paleta jest zaliczona). */
  ton?: 'uwaga'
}

export interface KontekstSkanu {
  palletNo?: number
  orderNo?: string
  kg?: number
  /** Komunikat z backendu — używany TYLKO dla kodów opisowych (WRONG_ORDER). */
  wiadomosc?: string
}

function paleta(ctx: KontekstSkanu): string {
  return ctx.palletNo ? `Paleta P${ctx.palletNo}` : 'Paleta'
}

export function komunikatSkanu(
  wynik: WynikSkanu,
  ctx: KontekstSkanu = {},
): KomunikatSkanu {
  switch (wynik) {
    case 'SUCCESS': {
      const kg = ctx.kg ? ` · ${Math.round(ctx.kg)} kg` : ''
      return {
        ok: true,
        naglowek: 'PALETA ZESKANOWANA',
        szczegol: `${paleta(ctx)}${ctx.orderNo ? ` · ${ctx.orderNo}` : ''}${kg}`,
      }
    }
    case 'ALREADY_SCANNED':
      return {
        ok: false,
        naglowek: 'PALETA JUŻ ZESKANOWANA',
        szczegol: `${paleta(ctx)} jest już na tym samochodzie — nie liczy się drugi raz.`,
      }
    case 'WRONG_ORDER':
      return {
        ok: false,
        naglowek: 'PALETA NIE NALEŻY DO TEGO ZAMÓWIENIA',
        szczegol: ctx.wiadomosc
          || `${paleta(ctx)} pochodzi z zamówienia, którego nie ma na tym samochodzie.`,
      }
    case 'ON_OTHER_VEHICLE':
      // Zamówienie bywa dzielone na dwa auta. Bez tego przypadku operator
      // drugiego samochodu dostawał „już zeskanowana" i szedł dalej
      // przekonany, że paleta mu się zaliczyła — a ona jechała gdzie indziej.
      return {
        ok: false,
        naglowek: 'PALETA JEST NA INNYM SAMOCHODZIE',
        szczegol: ctx.wiadomosc
          || `${paleta(ctx)} została już załadowana na inne auto.`,
      }
    case 'ALREADY_COMPLETED':
      return {
        ok: false,
        naglowek: 'ZAMÓWIENIE JUŻ ZREALIZOWANE',
        szczegol: 'Dokument został wystawiony, towar zszedł ze stanu. Zgłoś to biuru.',
      }
    case 'INVALID':
      return {
        ok: false,
        naglowek: 'NIEZNANA PALETA',
        szczegol: 'Ten kod nie pasuje do żadnej palety. Zeskanuj kartkę jeszcze raz.',
      }
    case 'OFFLINE':
      return {
        ok: false,
        naglowek: 'BRAK POŁĄCZENIA — SPRÓBUJ PONOWNIE',
        szczegol: 'Skan NIE został zapisany. Poczekaj na sieć i zeskanuj ponownie.',
      }
    default:
      return {
        ok: false,
        naglowek: 'BŁĄD — SPRÓBUJ PONOWNIE',
        szczegol: 'Skan nie został przyjęty. Jeśli się powtarza, zawołaj biuro.',
      }
  }
}


/** Odmowa operacji na LIŚCIE auta (dodanie/zdjęcie/kolejność/wyczyszczenie).
 *
 *  Te odmowy nie mają kodu — backend pisze konkretne zdanie („na aucie stoi
 *  5 palet tego zamówienia, najpierw zdejmij je przyciskiem cofnięcia").
 *  Wtłaczanie ich w słownik kodów skanu dawało operatorowi „BŁĄD — SPRÓBUJ
 *  PONOWNIE" i gubiło jedyną informację, która mogła mu pomóc.
 *
 *  Zdania backendu pokazujemy, techniczne błędy — nie. Kryterium jest proste
 *  i celowo ostrożne: ślad wyjątku, SQL-a albo kodu HTTP dyskwalifikuje tekst.
 */
const TECHNICZNE = /psycopg2|Traceback|SQL|relation |column |HTTP \d|Internal Server|<[a-z]/i

export function komunikatOdmowy(e: unknown, offline: boolean): KomunikatSkanu {
  if (offline) return komunikatSkanu('OFFLINE')
  const tekst = e instanceof Error ? (e.message || '').trim() : ''
  const czytelny = tekst && tekst.length <= 220 && !TECHNICZNE.test(tekst)
  return {
    ok: false,
    naglowek: 'NIE UDAŁO SIĘ',
    szczegol: czytelny ? tekst : 'Operacja nie przeszła. Spróbuj ponownie albo zawołaj biuro.',
  }
}


/** Skan PRZESZEDŁ, ale zamówienie jest poza ustawioną kolejnością załadunku.
 *
 *  Hala (21.09.2026): „ustawiam POLAT → POTRM → NAZAR — czy system blokuje
 *  załadowanie NAZARA między POLAT-em?". Nie blokuje i świadomie nie będzie:
 *  paleta bywa akurat pod ręką, a kolejność bywa ustawiona błędnie. Ekran ma
 *  to natomiast POWIEDZIEĆ, na żółto i od razu, póki jest czas cofnąć skan.
 *
 *  Liczby („4 z 9 palet") są w zdaniu celowo: bez nich operator nie wie, czy
 *  chodzi o pomyłkę, czy o dwie palety, które po prostu jeszcze nie przyjechały.
 */
export function komunikatPozaKolejnoscia(
  poza: PozaKolejnoscia,
  ctx: KontekstSkanu = {},
): KomunikatSkanu {
  const kto = poza.czeka.clientName || poza.czeka.orderNo || 'poprzednie zamówienie'
  return {
    ok: true,
    ton: 'uwaga',
    naglowek: 'POZA KOLEJNOŚCIĄ — PALETA ZALICZONA',
    szczegol: `${paleta(ctx)} jest ${poza.pozycja}. w kolejce, a ${kto} `
      + `(${poza.czeka.pozycja}.) ma dopiero ${poza.czeka.loaded} z `
      + `${poza.czeka.total} palet. Sprawdź, czy to na pewno ta paleta.`,
  }
}
