/**
 * Odświeżenie ekranu po serii zapisów — zbiorczo, bez gubienia końcowego stanu.
 *
 * Każdy skan sztuki odświeżał plan i postęp skanów: seria 50 sztuk to 100
 * odczytów pod rząd, każdy z pełną listą planu. Tu w locie jest najwyżej
 * JEDNO odświeżenie; prośby, które przyszły w jego trakcie, składają się
 * w jedno dodatkowe — uruchomione PO nim, więc ostatni zapis serii zawsze
 * kończy się świeżym odczytem (końcowa synchronizacja).
 *
 * Dotyczy wyłącznie odczytu na ekran. Zapis (skan) idzie swoją kolejką
 * i nic tu na niego nie czeka.
 *
 * Ograniczenie: „najwyżej jedno w locie" dotyczy TYLKO odczytów wyzwalanych
 * skanami przez tę jedną instancję. Okresowe odświeżanie ekranu
 * (`useLiveRefresh`) i inne odczyty idą osobno i mogą trwać równolegle;
 * nowa instancja (np. po zmianie funkcji `refetch`) nie wie o odczycie
 * poprzedniej.
 */
export function utworzOdswiezanieZbiorcze(odswiez: () => Promise<unknown>): () => void {
  let wToku = false
  let ponow = false
  return () => {
    if (wToku) { ponow = true; return }
    wToku = true
    void (async () => {
      try {
        do {
          ponow = false
          // Odświeżenie ekranu połyka błędy (`useApi`) — gdyby jednak rzuciło,
          // następna prośba ma ruszyć, a nie utknąć za „wToku".
          try { await odswiez() } catch { /* stan pokaże następny odczyt */ }
        } while (ponow)
      } finally {
        wToku = false
      }
    })()
  }
}
