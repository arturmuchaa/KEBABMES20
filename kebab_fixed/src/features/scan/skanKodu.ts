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
