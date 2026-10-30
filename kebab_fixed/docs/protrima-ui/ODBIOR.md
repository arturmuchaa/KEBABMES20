# Odbiór faz próby PROTRIMA

Każda faza dopisuje sekcję: data, commit, wyniki tsc / testów / builda, rozmiar paczki
`protrima` (gzip), zrzuty, porównanie ze starym MES na tej samej kopii, otwarte sprawy.

## Faza 0 — środowisko

- [ ] `status`: usługa active, 200 na :8020 i :8090, „✓ izolacja”
- [ ] stary MES na :8090/index.html loguje się i pokazuje dane z kopii
- [ ] zmiana zrobiona na :8090 nie pojawia się na :8080

**30.10.2026 — wykonane (Claude, sesja na Helsinkach przez SSH):** worktree `/opt/kebab/protrima`
z `main` 5dfebc0e, pakiet rozpakowany (`-n`), strażnik 114/114, `instaluj` + link nginx + `nginx -t` +
reload, `odswiez-baze`: kopia 62 MB, usunięte 253 sesje, „✓ izolacja”, :8020 i :8090 → 200.
Produkcja :8080 po wszystkim → 200, `kebab-mes` active. **Zapora: :8090 NIE otwarte** (krok dla człowieka).
Uwaga ze `status`: rola `protrima_test` może zakładać NOWE tabele w `public` bazy produkcji
(domyślne prawo PG < 15) — istniejących danych nie dotyczy; decyzja dla produkcji.

## Fazy 1, 2, 4 (odczyt), 5 (odczyt), 6 — pierwsze przejście, 30.10.2026

Zakres: powłoka z prototypu v0.3 w `src/protrima/`, logowanie kontem biurowym, pasek PRÓBA z datą kopii
(tytuł + pasek stanu + logowanie), Zamówienia / Wyrób gotowy / Pulpit na danych z API kopii — tylko odczyt.
Akcje zapisu (potwierdzenie, edycja pozycji, palety, przydział, WZ, anulowanie, nowe zamówienie) pokazują
komunikat „faza 3 — zrób to w starym MES na tej samej kopii”. Druk etykiet: wyłączony z opisem.
Dane demo prototypu (`demo.ts`, łańcuchy partii, kursy, surowce) nie weszły.

- Miary: magazyn/wydano z `lineShipping.ts`, masowanie z `line.mixing` backendu (zaokrąglenie po recepturze),
  produkcja = `line.production.reportedQty` (diagnostyka, osobna kolumna).
- Pulpit: plany w toku, mięso przyprawione (wolne vs potrzeba z zamówień), sesje do potwierdzenia,
  dostawy bez HACCP, kursy po załadunku — te same endpointy co stary pulpit.
- `npx tsc --noEmit` — 0 błędów · `vitest src/protrima` — 15/15 · `npm run build -- --mode proba` — OK,
  `protrima-*.js` 198 kB (gzip 59 kB) + `protrima-*.css` 52 kB (gzip 10 kB) + wspólny vendor.
- `cargo check` lokalnie (Linux): `--features proba` OK (1 ostrzeżenie: nieużywany import updatera — tylko w próbie),
  biuro OK, kiosk OK.

Do sprawdzenia przez człowieka (1920×1080 i 1366×768): logowanie; 5 zamówień stary widok vs nowy
(zamówiono, w magazynie, wydano, brak, palety); 10 pozycji wyrobu; liczby Pulpitu vs stary pulpit.

## Faza 4a — zapis w Przyjęciach surowca, 30.10.2026

Nowe przyjęcie i edycja w karcie roboczej (`modules/przyjecia/formularz/`), anulowanie (cała dostawa albo
pojedynczy numer) i kontrola HACCP karty 1.1.1 z podpisami PIN — zakładka panelu. Reguły i DTO ze starego
MES (`receptionSplit`, `receptionEditView`, `validateReception`, `receptionCheck`), backend bez zmian.
Zawieszki palet — dalej stary MES (druk etykiet w próbie wyłączony).

Poprawione względem starego formularza (stary MES ma te błędy nadal):
- dołożony numer w EDYCJI wysyłał etykietę „nowy” jako numer — backend odpowiada 400
  „Numer partii musi być liczbą” (sprawdzone PUT-em na kopii),
- zdjęcie numeru ze środka dostawy w edycji nie przesuwało `batchIds` — pozycje trafiały pod cudzą partię.

Próba na kopii (e2e, sesja `claude-probe`, posprzątana): przyjęcie 51/10 KOKO 1000 + 500,5 kg → nr 680/681,
pojemniki 67/34, cena 7,20; F2 → edycja 1000 → 1100 kg; HACCP b/z, b/z, 2,5 °C / 3,1 °C, K; anulowanie
całej dostawy → oba numery `cancelled`, numery wróciły do puli. `vitest src/protrima` 107/107, `tsc` 0 błędów.

## Wydania i druki, 30.10.2026 (0.3.8–0.4.0)

- **WZ — ceny:** jedna cena za kg dla wszystkich pozycji + karta „Ceny” (według wyrobu, wspólny VAT, waluta).
  Wartość liczona ZA KG jak serwer (`value = total_kg × price`); wcześniej podgląd mnożył cenę przez sztuki.
- **Kartki na palety:** A4 poziomo, 2 kopie, wybór palet (menu Drukuj zamówienia, zakładka Palety). Treść
  jak stary MES (`buildCartonLabelContent`, nazwy z kartoteki odbiorcy, sufit 90 pt). W PRÓBIE: podgląd ze znakiem
  PRÓBA, bez QR, druk zablokowany (ZASADY pkt 4); w buildzie produkcyjnym druk z QR `PAL|id|nr`.
- **WZ z zaznaczonych w Wyrobie gotowym** (bez zamówienia): odbiorca z kartoteki (podpowiedź przy jednym kliencie
  w zaznaczeniu), nazwy pozycji wg kartoteki odbiorcy, `createManual` bez `orderId`. Ostrzeżenie o cudzej rezerwacji
  porównuje stempel z nazwą handlową I pełną odbiorcy (stary MES tylko z pełną → fałszywe ostrzeżenia, np. DEM`S).
  E2e na kopii: WZ/65/10/26 z 2 wierszy (12 + 3 szt.) → stan 0/0 → anulowanie → 12/3.

## Pilot produkcyjny — PROTRIMA obok starego MES (od 30.10.2026)

Decyzja właściciela: „powoli uruchamiamy PROTRIMA”. Osobny instalator **PROTRIMA** (`pl.protrima.biuro`,
`src-tauri/tauri.protrima.conf.json`, workflow `tauri-protrima.yml`, artefakt `PROTRIMA-Windows`):
- build `--mode produkcja` → serwer zakładu :8080 (ta sama baza co stary MES), bez znaczników PRÓBA,
  druk kartek palet z QR włączony; funkcja Cargo `protrima` wyłącza sprawdzanie aktualizacji starego MES;
- instaluje się OBOK starego MES (inny identyfikator) i obok „PROTRIMA Test” (kopia :8090);
- backend bez zmian; funkcje jeszcze nieprzeniesione mówią „działa na razie w starym MES” (`W_STARYM_MES`);
- strażnik w workflow: identyfikator, `--mode produkcja`, CSP tylko :8080, brak :8090 w paczce.
Plan: jeden komputer biura → uwagi → kolejne stanowiska → wyłączenie starego MES dopiero na sygnał właściciela.
