/**
 * Rozpoznanie KOMPLETNEGO kodu palety i strażnik podwójnej wysyłki.
 *
 * Skaner HID „wpisuje" kod jak klawiatura. Gdy nie ma ustawionego sufiksu
 * Enter, formularz nigdy się nie wysyła i wygląda to jak awaria MES — tak
 * padł pierwszy test DS2278 w zakładzie (17.09.2026: kod wpadał w pole,
 * paleta zostawała `created`, bo żądanie nie wychodziło).
 *
 * Konfiguracja skanera jest rzeczą, która ginie: przy wymianie urządzenia,
 * resecie do ustawień fabrycznych albo drugim skanerze na innej hali problem
 * wraca. Dlatego MES rozpoznaje kompletny kod SAM i wysyła go bez Entera.
 *
 * Logika stoi tutaj, poza Reactem, bo to jest reguła, a nie widok — i da się
 * ją przetestować bez montowania ekranu.
 */

/** Token z kartki (`PAL|<zamówienie>|<nr>`) albo adres z kodu QR
 *  (`…/m/p/<zamówienie>/<nr>`). Backend przyjmuje OBIE formy —
 *  `pallets_service.parse_code`. Host w adresie nie ma znaczenia: kartki
 *  drukowane z aplikacji desktopowej niosą `tauri.localhost`. */
const TOKEN = /^PAL\|[^|]+\|\d+$/
const ADRES = /\/m\/p\/[^/]+\/\d+(?:$|[^\d])/

/** Czy to KOMPLETNY kod palety — a więc taki, który wolno wysłać bez Entera.
 *  Człowiek nie napisze takiego ciągu z klawiatury przypadkiem, więc ryzyko
 *  fałszywej wysyłki jest znikome. Wszystko inne (numer wpisany ręcznie,
 *  fragment kodu) czeka na Enter, jak dotąd. */
export function czyKompletnyKodPalety(wartosc: string): boolean {
  const s = (wartosc ?? '').trim()
  if (!s) return false
  return TOKEN.test(s) || ADRES.test(s)
}

/**
 * Strażnik: ten sam kod nie leci dwa razy pod rząd.
 *
 * Okno jest CZASOWE, nie wieczne. Blokada na zawsze psułaby przypadki
 * poprawne — ponowienie po błędzie sieci albo powtórny skan tej samej palety
 * po jej cofnięciu. Dwie sekundy pokrywają to, o co naprawdę chodzi:
 * auto-wysyłkę i Enter, który przychodzi zaraz po niej.
 */
export function utworzStraznikaWysylki(oknoMs = 2000) {
  let ostatniKod: string | null = null
  let ostatniCzas = 0
  return {
    /** Zwraca true, gdy wolno wysłać (i zapamiętuje wysyłkę). */
    wolno(kod: string, teraz: number = Date.now()): boolean {
      const s = (kod ?? '').trim()
      if (!s) return false
      if (s === ostatniKod && teraz - ostatniCzas < oknoMs) return false
      ostatniKod = s
      ostatniCzas = teraz
      return true
    },
    /** Po nieudanej wysyłce zdejmujemy blokadę — operator ma prawo ponowić
     *  ten sam skan od razu, bez czekania na wygaśnięcie okna. */
    zwolnij(): void {
      ostatniKod = null
      ostatniCzas = 0
    },
  }
}


/**
 * Czy to wpisał SKANER, a nie człowiek.
 *
 * Właściciel (17.09.2026): „chciałbym, aby wpadało wszystko automatycznie bez
 * Entera, tak jak było na telefonie kamerą". Kamera miała łatwiej — oddawała
 * gotowy kod prosto do obsługi, z pominięciem formularza. Przy skanerze HID
 * kod przychodzi znak po znaku i trzeba wiedzieć, KIEDY się skończył.
 *
 * Wyliczanie wszystkich formatów (palety, sztuki, kartony) byłoby zgadywaniem
 * — pierwszy nieznany kod znowu by nie zadziałał. Dlatego rozpoznajemy nie
 * treść, tylko TEMPO: skaner wrzuca kilkanaście znaków w kilkadziesiąt
 * milisekund, człowiek potrzebuje na to sekund. Margines jest ogromny
 * (skaner ~1 ms/znak, pisanie ręczne ~200 ms/znak), więc pomyłka w żadną
 * stronę nie jest realna.
 *
 * Krótkie ciągi odrzucamy: kilka znaków może wpaść z klawiatury przypadkiem,
 * a żaden kod w zakładzie nie jest tak krótki.
 */
export const MIN_ZNAKOW_SKANU = 8
export const MAX_MS_SKANU = 250

export function czyWpisalSkaner(
  dlugosc: number,
  czasTrwaniaMs: number,
): boolean {
  if (dlugosc < MIN_ZNAKOW_SKANU) return false
  return czasTrwaniaMs <= MAX_MS_SKANU
}
