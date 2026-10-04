/**
 * Ramkowanie strumienia ze skanera HID — wspólne dla pól HMI i nasłuchu
 * globalnego.
 *
 * Hala 02.10.2026: dwie szybko zeskanowane etykiety sklejały się w jeden
 * długi, niepoprawny kod. Pole czekało na 150 ms ciszy (efekt Reacta
 * obserwujący stan pola), a skaner bez sufiksu Enter wystukiwał następny kod,
 * zanim ta cisza nastała. Skracanie przerwy nie pomaga — przy serii po
 * ~500 sztuk dziennie zawsze trafi się kod szybszy niż przerwa.
 *
 * Dlatego granicę ramki wyznacza TREŚĆ, nie czas, wszędzie tam, gdzie się da:
 *   - kod sztuki `U?<20 hex>` i kartonu `SCARTON?<20 hex>` mają STAŁĄ długość
 *     — zamykamy je w chwili, gdy dotrze 20. znak hex; następny znak zaczyna
 *     nową ramkę,
 *   - Enter / CR / LF / Tab / ETX kończą ramkę od razu; STX zaczyna nową,
 *   - kartka palety (`PAL|zam|nr`, adres `…/m/p/zam/nr`) ma numer ZMIENNEJ
 *     długości: „1" może być początkiem „12". Zamyka ją terminator, STX,
 *     cisza `CISZA_RAMKI_MS` albo POTWIERDZONA następna ramka. Znaki po
 *     numerze trzymamy jako podgląd (lookahead): paleta wychodzi dopiero,
 *     gdy podgląd stanie się pełną sztuką / kartonem albo kompletną kartką
 *     palety. Podgląd, który nie pasuje do początku żadnego znanego kodu
 *     („PAL|Zam1|12SPAM"), albo niedokończony przy końcu ramki, odrzuca
 *     CAŁY odczyt jako błąd — poprawny prefiks nie może zrobić mutacji,
 *   - wszystko inne (obcy kod) czeka na terminator albo ciszę — i idzie
 *     w całości, NIE jest dzielone na „niby-poprawne" etykiety.
 *
 * Tryb 'globalny' (nasłuch na menu) oddaje ramkę po Enter/Tab TYLKO, gdy to
 * skan (tempo skanera, ≥ MIN_ZNAKOW_SKANU) albo kompletna kartka palety.
 * Klawisze człowieka przepadają, a Enter/Tab zostaje przyciskowi.
 *
 * Cisza jest dłuższa niż zacięcie skanera Bluetooth w połowie kodu
 * (hala 29.09.2026: 500–600 ms), więc taki kod przychodzi w całości.
 * Niepełny kod sztuki/kartonu po ciszy NIE jest wysyłany jako sztuka —
 * wraca jako błąd do rozliczenia przez ekran.
 *
 * Moduł jest czysty (czas podaje wołający), żeby dało się go przetestować
 * bez Reacta i bez prawdziwego zegara. `utworzStrumienSkanu` dokłada timer.
 */
import { czyWpisalSkaner, czyZaczetyKod, luznaKartkaPalety, MIN_ZNAKOW_SKANU, oczyscKod } from './skanKodu'

/** Cisza, po której ramka bez terminatora jest kompletna (paleta, obcy kod)
 *  albo niepełna (ucięta sztuka). Dłuższa niż zacięcie Bluetooth 500–600 ms. */
export const CISZA_RAMKI_MS = 800
/** Jak długo po samoczynnym zamknięciu ramki Enter/Tab uznajemy za spóźniony
 *  sufiks skanera (połykany), a nie za klawisz człowieka. */
export const SUFIKS_MS = 500
/** Nasłuch globalny: pojedyncze klawisze człowieka (nie skan) porzucamy
 *  po tej przerwie, żeby nie dokleiły się do następnego skanu. */
export const PRZERWA_OBCA_MS = 400
/** Najdłuższy kod w zakładzie to adres QR palety (~60 znaków). Dłuższy bufor
 *  bez końca ramki to śmieci — zgłaszamy błąd zamiast rosnąć bez końca. */
export const MAX_DLUGOSC_RAMKI = 200

export type Ramka =
  | { rodzaj: 'kod'; kod: string }
  | { rodzaj: 'blad'; powod: 'niepelny' | 'za-dlugi' | 'niejednoznaczny' | 'przerwany'; fragment: string; komunikat: string }

const SZTUKA_PELNA = /^[uU][^0-9A-Za-z]?[0-9a-fA-F]{20}$/
const KARTON_PELNY = /^SCARTON[^0-9A-Za-z]?[0-9a-fA-F]{20}$/i
/** Ucięta sztuka / karton: znany początek, mniej niż 20 hex. Stare krótkie
 *  id kartonów (`SCARTON|k3`) nie są hex — te idą dalej jako kod. */
const SZTUKA_CZESC = /^[uU](?:[^0-9A-Za-z][0-9a-fA-F]{0,19}|[0-9a-fA-F]{1,19})$/
const KARTON_CZESC = /^SCARTON[^0-9A-Za-z]?[0-9a-fA-F]{0,19}$/i
/** Kartka palety, która KOŃCZY SIĘ numerem — kolejna cyfra może ją wydłużyć. */
const PALETA_TOKEN = /^PAL\|[^|]+\|\d+$/
const PALETA_ADRES = /\/m\/p\/[^/]+\/\d+$/
/** Niedokończony prefiks AIM („]", „]Q") — reszta kodu jeszcze nie dotarła. */
const AIM_CZESC = /^\](?:[A-Za-z][0-9A-Za-z]?)?$/

const TERMINATORY = new Set(['\r', '\n', '\t', '\u0003', '\u0004'])
const STX = '\u0002'

function czyPaletaNaKoncu(s: string): boolean {
  return PALETA_TOKEN.test(s) || PALETA_ADRES.test(s) || luznaKartkaPalety(s) !== null
}

function czyNiepelny(s: string): boolean {
  if (SZTUKA_CZESC.test(s) || KARTON_CZESC.test(s)) return true
  // Zaczęta kartka palety (PAL|…, http…/m/p/…) bez numeru. Karton z krótkim,
  // starym id to nie „zaczęty" kod — ten idzie dalej.
  return czyZaczetyKod(s) && !/^scarton/i.test(s)
}

/** Czy podgląd po numerze palety może jeszcze być początkiem znanego kodu:
 *  sztuki, kartonu, kartki palety albo adresu QR (także z prefiksem AIM). */
function zgodnyPoczatek(surowy: string): boolean {
  if (AIM_CZESC.test(surowy)) return true
  const t = oczyscKod(surowy)
  if (!t) return true
  return /^[uU]$/.test(t) || SZTUKA_CZESC.test(t)
    || /^s(?:c(?:a(?:r(?:t(?:o(?:n)?)?)?)?)?)?$/i.test(t) || KARTON_CZESC.test(t)
    || /^p(?:a(?:l)?)?$/i.test(t) || /^pal[^0-9A-Za-z]/i.test(t)
    || /^h(?:t(?:t(?:p(?:s)?)?)?)?$/i.test(t) || /^https?[^0-9A-Za-z]/i.test(t)
}

function skrot(s: string): string {
  return s.length > 40 ? `${s.slice(0, 40)}…` : s
}

export function bladNiepelny(fragment: string): Ramka {
  return { rodzaj: 'blad', powod: 'niepelny', fragment,
    komunikat: `Niepełny odczyt „${skrot(fragment)}" — nic nie zapisano, zeskanuj ponownie.` }
}

function bladPrzerwany(fragment: string): Ramka {
  return { rodzaj: 'blad', powod: 'przerwany', fragment: skrot(fragment),
    komunikat: `Przerwany odczyt „${skrot(fragment)}" — początek kodu przepadł przy zmianie ekranu; nic nie zapisano, zeskanuj ponownie.` }
}

function bladNiejednoznaczny(fragment: string): Ramka {
  return { rodzaj: 'blad', powod: 'niejednoznaczny', fragment: skrot(fragment),
    komunikat: `Nieczytelny odczyt „${skrot(fragment)}" — kartka palety z doklejonym nieznanym ciągiem; nic nie zapisano, zeskanuj ponownie.` }
}

/**
 * Czysty bufor ramek. `tryb`:
 *   - 'pole' — pole skanu: tekst człowieka zostaje w polu do Entera,
 *     nigdy nie znika sam,
 *   - 'globalny' — nasłuch na dokumencie: pojedyncze klawisze, które nie są
 *     skanem, porzucamy po `PRZERWA_OBCA_MS`.
 */
export function utworzBuforSkanu(opcje: { tryb: 'pole' | 'globalny' }) {
  const globalny = opcje.tryb === 'globalny'
  let surowy = ''
  let start = 0
  let ostatni = 0
  let zamknieto = Number.NEGATIVE_INFINITY
  /** Indeks w `surowy`, od którego trwa podgląd po numerze palety; -1 = brak. */
  let granica = -1
  let startGranicy = 0
  /** Podgląd nie pasuje do żadnego znanego kodu — cały odczyt będzie błędem. */
  let zepsuta = false
  /** Ostatni znak ogona porzuconego przez `wyczysc` (zmiana kontekstu w połowie
   *  kodu); -∞ = nic nie porzucono albo ciąg dalszy już się rozliczył. */
  let porzucony = Number.NEGATIVE_INFINITY
  /** Ramka zaczęła się tuż po porzuconym ogonie — to reszta przerwanego kodu,
   *  nie nowy kod. Pierwsza ramka, która z niej wyjdzie, jest błędem. */
  let skazona = false

  const tekst = () => oczyscKod(surowy)
  const wyzeruj = () => { surowy = ''; start = 0; ostatni = 0; granica = -1; zepsuta = false }
  const tempoSkanera = (s: string) => czyWpisalSkaner(s.length, ostatni - start)
  /** Skan (a nie klawisz człowieka) — tylko on może zamknąć się po ciszy. */
  const wygladaNaSkan = (s: string) => s.length >= MIN_ZNAKOW_SKANU && tempoSkanera(s)

  /** Każda ramka wychodzi tędy: reszta przerwanego kodu nie może zostać
   *  wysłana jako (śmieciowy) kod. */
  function wyjdz(out: Ramka[], r: Ramka) {
    if (skazona) {
      skazona = false
      porzucony = Number.NEGATIVE_INFINITY
      if (r.rodzaj === 'kod') r = bladPrzerwany(r.kod)
    }
    out.push(r)
  }

  /** Koniec ramki z terminatora: oddajemy wszystko, co jest — decyduje
   *  obsługa/serwer. Wyjątek: ucięta sztuka/karton to błąd, nie kod. */
  function zakonczRamke(out: Ramka[]) {
    if (granica >= 0) {
      // Paleta z podglądem: wychodzi tylko, gdy po numerze nie było nic
      // znaczącego. Niedokończony albo obcy podgląd = błąd CAŁEGO odczytu.
      const paleta = oczyscKod(surowy.slice(0, granica))
      const ogon = oczyscKod(surowy.slice(granica))
      const calosc = tekst()
      const ok = !zepsuta && !ogon
      wyzeruj()
      wyjdz(out, ok ? { rodzaj: 'kod', kod: paleta } : bladNiejednoznaczny(calosc))
      return
    }
    const s = tekst()
    wyzeruj()
    if (!s) return
    if (SZTUKA_CZESC.test(s) || KARTON_CZESC.test(s)) wyjdz(out, bladNiepelny(s))
    else wyjdz(out, { rodzaj: 'kod', kod: s })
  }

  /** Enter / Tab / CR / LF. Nasłuch globalny NIE oddaje klawiszy człowieka
   *  (zwykłe „a" + Enter na menu): porzuca je i nie liczy Entera jako
   *  sufiksu, więc ten trafia do przycisku. */
  function zakonczTerminatorem(out: Ramka[], teraz: number) {
    if (!surowy) return
    if (globalny && granica < 0) {
      const s = tekst()
      // Reszta przerwanego kodu kończy się jak skan (błąd, Enter połknięty),
      // nawet krótka — jej Enter to sufiks skanera, nie klawisz człowieka.
      if (!s || (!czyPaletaNaKoncu(s) && !wygladaNaSkan(s) && !skazona)) { wyzeruj(); return }
    }
    zakonczRamke(out)
    zamknieto = teraz
  }

  /** Znak dopisany do podglądu po numerze palety. */
  function podglad(out: Ramka[], teraz: number) {
    if (zepsuta) return
    const surowyOgon = surowy.slice(granica)
    const ogon = oczyscKod(surowyOgon)
    const paleta = oczyscKod(surowy.slice(0, granica))
    // Pełna sztuka/karton PRZED sprawdzeniem prefiksu: zgodnyPoczatek zna
    // tylko niepełne formy (≤ 19 hex), więc 20. hex uznałby za śmieci.
    if (SZTUKA_PELNA.test(ogon) || KARTON_PELNY.test(ogon)) {
      wyzeruj(); zamknieto = teraz
      wyjdz(out, { rodzaj: 'kod', kod: paleta }); wyjdz(out, { rodzaj: 'kod', kod: ogon })
      return
    }
    if (!zgodnyPoczatek(surowyOgon)) { zepsuta = true; return }
    if (czyPaletaNaKoncu(ogon)) {
      // Potwierdzona następna kartka palety — poprzednia wychodzi, ta zbiera
      // dalej numer (może mieć więcej cyfr).
      wyjdz(out, { rodzaj: 'kod', kod: paleta })
      surowy = surowyOgon
      start = startGranicy
      granica = -1
    }
  }

  /** Termin najbliższej decyzji po ciszy, albo null — nic nie czeka na zegar. */
  function nastepnyTik(): number | null {
    if (!surowy) return null
    if (granica >= 0) return ostatni + CISZA_RAMKI_MS
    const s = tekst()
    if (!s) return globalny ? ostatni + PRZERWA_OBCA_MS : null
    if (czyPaletaNaKoncu(s) || wygladaNaSkan(s)) return ostatni + CISZA_RAMKI_MS
    if (globalny) return ostatni + (czyNiepelny(s) ? CISZA_RAMKI_MS : PRZERWA_OBCA_MS)
    return null
  }

  function tik(teraz: number, out: Ramka[] = []): Ramka[] {
    if (!surowy) return out
    const termin = nastepnyTik()
    if (termin == null || teraz < termin) return out
    if (granica >= 0) {
      zakonczRamke(out); zamknieto = teraz
      return out
    }
    const s = tekst()
    if (s && czyPaletaNaKoncu(s)) {
      wyzeruj(); zamknieto = teraz
      wyjdz(out, { rodzaj: 'kod', kod: s })
    } else if (s && wygladaNaSkan(s)) {
      wyzeruj(); zamknieto = teraz
      wyjdz(out, czyNiepelny(s) ? bladNiepelny(s) : { rodzaj: 'kod', kod: s })
    } else {
      // Tylko globalny: klawisz człowieka na menu albo urwany początek
      // krótszy niż jakikolwiek kod — to nie był skan.
      wyzeruj()
    }
    return out
  }

  function dodajZnak(ch: string, teraz: number, out: Ramka[]) {
    // Ramka, której cisza już minęła (timer się spóźnił), zamyka się PRZED
    // nowym znakiem — inaczej znak dokleiłby się do starego kodu.
    tik(teraz, out)
    if (TERMINATORY.has(ch)) {
      zakonczTerminatorem(out, teraz)
      return
    }
    if (ch === STX) {
      if (surowy) { zakonczRamke(out); zamknieto = teraz }
      return
    }
    const c = ch.charCodeAt(0)
    if (c < 0x20 || c === 0x7f) return

    if (surowy && granica < 0 && !/\d/.test(ch) && czyPaletaNaKoncu(tekst())) {
      // „PAL|zam|12" + coś: numer się skończył ALBO to śmieci. Paleta czeka,
      // aż podgląd potwierdzi następny kod (albo przyjdzie terminator).
      granica = surowy.length
      startGranicy = teraz
    }
    if (!surowy) {
      start = teraz
      // Ciąg dalszy (w tempie skanera, z zacięciem Bluetooth) ogona, który
      // przepadł przy zmianie kontekstu.
      skazona = teraz - porzucony <= CISZA_RAMKI_MS
    }
    surowy += ch
    ostatni = teraz

    if (granica >= 0) {
      podglad(out, teraz)
      if (surowy.length > MAX_DLUGOSC_RAMKI) zaDlugi(out, teraz)
      return
    }

    const s = tekst()
    if (SZTUKA_PELNA.test(s) || KARTON_PELNY.test(s)) {
      wyzeruj(); zamknieto = teraz
      wyjdz(out, { rodzaj: 'kod', kod: s })
      return
    }
    if (surowy.length > MAX_DLUGOSC_RAMKI) zaDlugi(out, teraz)
  }

  function zaDlugi(out: Ramka[], teraz: number) {
    const s = tekst()
    wyzeruj(); zamknieto = teraz
    wyjdz(out, { rodzaj: 'blad', powod: 'za-dlugi', fragment: skrot(s),
      komunikat: `Nieczytelny odczyt (ponad ${MAX_DLUGOSC_RAMKI} znaków bez końca kodu) — nic nie zapisano, zeskanuj ponownie.` })
  }

  return {
    /** Znaki ze skanera (klawisze, zmiana pola, wklejenie). Zwraca gotowe
     *  ramki W KOLEJNOŚCI; niekompletny ogon zostaje w buforze. */
    dodaj(tekstWe: string, teraz: number): Ramka[] {
      const out: Ramka[] = []
      for (const ch of tekstWe ?? '') dodajZnak(ch, teraz, out)
      return out
    },
    /** Enter / Tab z klawiatury. Pusty bufor nic nie oddaje; w trybie
     *  globalnym klawisze człowieka też nic (przepadają). */
    zakoncz(teraz: number): Ramka[] {
      const out: Ramka[] = []
      tik(teraz, out)
      zakonczTerminatorem(out, teraz)
      return out
    },
    /** Pole zmienione inaczej niż dopisaniem na końcu (Backspace, edycja
     *  w środku): bufor przyjmuje nową treść. Czas startu zostaje — człowiek
     *  poprawiający tekst nie staje się nagle „skanerem". */
    zastap(tekstWe: string, teraz: number): Ramka[] {
      const out: Ramka[] = []
      const bylStart = surowy ? start : 0
      wyzeruj()
      for (const ch of tekstWe ?? '') dodajZnak(ch, teraz, out)
      if (surowy && bylStart) start = bylStart
      return out
    },
    tik(teraz: number): Ramka[] { return tik(teraz, []) },
    nastepnyTik,
    /** Enter/Tab tuż po samoczynnym zamknięciu ramki — sufiks skanera. */
    poznySufiks(teraz: number): boolean { return !surowy && teraz - zamknieto <= SUFIKS_MS },
    /** Niekompletny ogon — to, co ma zostać widoczne w polu. */
    reszta(): string { return surowy },
    /** Czy ramka trwa i ostatni znak przyszedł nie dawniej niż `ms` temu. */
    trwa(teraz: number, ms: number): boolean { return !!surowy && teraz - ostatni <= ms },
    /** Zmiana kontekstu: ogon przepada. Jego ciąg dalszy (skaner pisze
     *  dalej) wychodzi jako błąd `przerwany`, a Enter/Tab tuż po ogonie
     *  jest połykany jak sufiks — nie kliknie przycisku w nowym kontekście.
     *  Oddanych już ramek to nie dotyczy. */
    wyczysc(): void {
      if (surowy) { porzucony = ostatni; zamknieto = ostatni }
      wyzeruj()
    },
  }
}

export type BuforSkanu = ReturnType<typeof utworzBuforSkanu>

/**
 * Bufor + zegar: ramki zamykane ciszą wychodzą same. `onRamka` wołane
 * synchronicznie, w kolejności — ono tylko KOLEJKUJE, nie czeka na API.
 * `onReszta` mówi, że ogon zmienił się poza zdarzeniem (timer).
 */
export function utworzStrumienSkanu(opcje: {
  tryb: 'pole' | 'globalny'
  onRamka: (r: Ramka) => void
  onReszta?: (reszta: string) => void
  zegar?: () => number
}) {
  const bufor = utworzBuforSkanu({ tryb: opcje.tryb })
  const teraz = opcje.zegar ?? (() => Date.now())
  let timer: ReturnType<typeof setTimeout> | null = null
  let zatrzymany = false

  const zaplanuj = () => {
    if (timer) { clearTimeout(timer); timer = null }
    if (zatrzymany) return
    const t = bufor.nastepnyTik()
    if (t == null) return
    timer = setTimeout(() => {
      timer = null
      const r = bufor.tik(teraz())
      zaplanuj()
      opcje.onReszta?.(bufor.reszta())
      oddaj(r)
    }, Math.max(0, t - teraz()))
  }
  const oddaj = (ramki: Ramka[]) => { for (const r of ramki) opcje.onRamka(r) }
  const po = (ramki: Ramka[]) => { zaplanuj(); oddaj(ramki); return ramki }

  return {
    bufor,
    wpisz: (t: string) => po(bufor.dodaj(t, teraz())),
    zastap: (t: string) => po(bufor.zastap(t, teraz())),
    zakoncz: () => po(bufor.zakoncz(teraz())),
    poznySufiks: () => bufor.poznySufiks(teraz()),
    trwa: (ms: number) => bufor.trwa(teraz(), ms),
    reszta: () => bufor.reszta(),
    /** Zmiana kontekstu / blokada: ogon przepada, nic nie wychodzi. */
    wyczysc: () => { bufor.wyczysc(); zaplanuj() },
    /** Odmontowanie: timer skasowany na stałe. */
    zatrzymaj: () => { zatrzymany = true; bufor.wyczysc(); if (timer) { clearTimeout(timer); timer = null } },
    wznow: () => { zatrzymany = false },
  }
}

export type StrumienSkanu = ReturnType<typeof utworzStrumienSkanu>
