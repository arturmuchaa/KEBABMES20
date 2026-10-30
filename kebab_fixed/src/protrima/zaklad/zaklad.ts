/**
 * ZAKŁAD — jedno miejsce na wszystko, czym różnią się wdrożenia PROTRIMA.
 *
 * Zasada (właściciel, 30.10.2026): PROTRIMA ma się dać wdrożyć w innym zakładzie
 * w miarę łatwo — JEDEN kod, a dane zakładu to konfiguracja, nie kod. Nigdzie
 * poza tym plikiem nie wpisujemy nazw firm, logo, standardów pakowania ani dat
 * wdrożenia. Opis wdrożenia: docs/protrima-ui/WDROZENIE_ZAKLADU.md.
 *
 * Skąd biorą się dane:
 *  - firma (nazwa, NIP, adres, nr weterynaryjny) — serwer zakładu, `/api/settings/company`;
 *  - próg kontroli HACCP — serwer (ustawiany przy wdrożeniu, lista `haccp-pending`);
 *  - słowniki (surowce, receptury, klienci, dostawcy) — serwer;
 *  - profil (standard pakowania, logo) — na razie PROFIL_DOMYSLNY poniżej (pierwszy
 *    zakład); docelowo ustawienia na serwerze (BRAKI_API: `/api/settings/protrima`) —
 *    wtedy zmienia się tylko `profilZakladu()`, ekrany zostają.
 */

export interface Firma {
  name?: string; address?: string; postalCode?: string; city?: string; nip?: string
  phone?: string; email?: string; vetNumber?: string
}

export interface StandardPakowania {
  /** Sztuk na pełną paletę według wagi sztuki (kg → szt). */
  sztukNaPalete: Readonly<Record<number, number>>
  /** Wagi pakowane na dwa sposoby „w zależności od zamówienia” — pierwszy wariant domyślny. */
  warianty: Readonly<Record<number, readonly number[]>>
  /** Górna granica palety z resztek. */
  maxKgResztki: number
  /** Docelowa masa palety dla wagi spoza standardu. */
  kgPaletyNietypowej: number
}

export interface ProfilZakladu {
  pakowanie: StandardPakowania
}

/**
 * Profil pierwszego wdrożenia. Standard pakowania podał właściciel 30.10.2026:
 * 70×10, 60×12, 50×15, 40×20, 35×25/20, 30×30, 25×35/30, 20×40, 15×60, 10×80;
 * palety 800–950 kg.
 */
export const PROFIL_DOMYSLNY: ProfilZakladu = {
  pakowanie: {
    sztukNaPalete: { 70: 10, 60: 12, 50: 15, 40: 20, 35: 25, 30: 30, 25: 35, 20: 40, 15: 60, 10: 80 },
    warianty: { 35: [25, 20], 25: [35, 30] },
    maxKgResztki: 950,
    kgPaletyNietypowej: 900,
  },
}

/** Profil zakładu, w którym działa aplikacja. Dziś domyślny; docelowo z serwera. */
export const profilZakladu = (): ProfilZakladu => PROFIL_DOMYSLNY

/**
 * Logo na dokumentach (zamówienie dla klienta, stan magazynu).
 * Przejściowo: plik pierwszego zakładu jest w paczce aplikacji i pokazuje się
 * TYLKO, gdy serwer przedstawia się jego nazwą — inny zakład dostaje dokument
 * bez cudzego logo. Docelowo logo przychodzi z serwera zakładu (BRAKI_API).
 */
export function logoDokumentu(firma: Firma | null | undefined): string | null {
  return (firma?.name ?? '').toLocaleLowerCase('pl').includes('księżyc') ? '/logo-ksiezyc-print.png' : null
}
