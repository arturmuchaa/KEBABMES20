# Próba PROTRIMA — zasady dla Claude Code

Ten plik jest dołączony do CLAUDE.md (`@docs/protrima-ui/ZASADY_PROBY.md`). Obowiązuje w każdej sesji
w worktree próby. Reguły z CLAUDE.md (niezmienniki domeny, testy komponentów) obowiązują dalej.

## Co robimy

Nowy wygląd biura (PROTRIMA) jako OSOBNE wejście `protrima.html`, na gałęzi `protrima-ui`:
Pulpit, Zamówienia (z dolnym panelem), Wyrób gotowy. Dane z KOPII bazy produkcji. Stary MES działa
dalej bez zmian. Plan faz: `docs/protrima-ui/PLAN_PROBY.md`. Wzór wyglądu: `docs/protrima-ui/prototyp-v03/`.

## Gdzie co jest

| Co | Próba | Produkcja (nie ruszać) |
|---|---|---|
| Kod | `/opt/kebab/protrima` (worktree, gałąź `protrima-ui`) | `/opt/kebab/kebab_new`, `/opt/kebab/app` |
| Baza | `kebab_protrima`, rola `protrima_test` | baza z `/opt/kebab/config/.env` |
| Backend | usługa `protrima-proba`, 127.0.0.1:8020 | usługa `kebab-mes`, 127.0.0.1:8010 |
| WWW | http://91.98.105.107:8090/protrima.html (stary wygląd na tej samej kopii: `/index.html`) | :8080 |
| Desktop | `pl.protrima.test`, bez aktualizacji, instalator z CI | `pl.kebabmes.*` |
| Env | `/opt/kebab/config/protrima.env` (zarządza skrypt) | `/opt/kebab/config/.env` (sekrety — nie czytać) |

Obsługa środowiska wyłącznie przez `deploy/protrima_proba.sh status | odswiez-baze`.
`odswiez-baze` kasuje wszystkie zmiany zrobione w próbie i bierze świeżą kopię.

## Twarde zasady

1. **Backend bez zmian.** Front woła tylko istniejące endpointy. Brakuje czegoś w API → wpis
   w `docs/protrima-ui/BRAKI_API.md` i przycisk wyłączony z opisem „brak w API”. Nie udawaj funkcji.
2. **Stary interfejs bez zmian.** Wolno dotknąć tylko: `vite.config.ts` (nowe wejście),
   `src/lib/api.ts` (adres serwera wg trybu + `protrima` na liście samodzielnych wejść),
   `src-tauri/src/lib.rs` i `Cargo.toml` (funkcja `proba`, faza 6). Reszta nowego kodu w `src/protrima/`.
3. **Trzy miary osobno:** produkcja (zgłoszenia z tabletów, diagnostyka), pokrycie (magazyn + wydano),
   wysyłka (wydano). Nigdy jeden wspólny procent. Liczymy istniejącymi funkcjami
   (`src/features/orders/lineShipping.ts`, `orderPlanning.ts`, `docs/ORDER_PROGRESS_POLICY.md`).
4. **Żadnego druku etykiet (Zebra) w próbie.** Kopia ma prawdziwe numery palet i adresy QR, a numery
   nadane w kopii produkcja nada później innym paletom (niezmiennik 8). Druk: wyłączony z opisem.
   Dokumenty PDF można podglądać; papierów z próby nie używa się w obrocie.
5. **Git:** tylko gałąź `protrima-ui`, bez tagów, bez force-push, bez merge do `main`.
   Commit po każdej fazie; push tylko po zgodzie człowieka.
6. **Wersja próby jest oznaczona:** pasek „PRÓBA — kopia bazy z <data>” (data z `/proba-kopia.json`)
   na każdym ekranie PROTRIMA. Build desktopowy bez trybu `proba` nie startuje.
7. **Dane demonstracyjne prototypu nie trafiają do kodu próby.** Na ekranie są tylko dane z API kopii.

## Strażnik

`.claude/hooks/straznik_proby.py` blokuje m.in. deploy/rollback, usługę `kebab-mes`, przeładowanie
nginx, bazę i sekrety produkcji, zapisy w `/opt/kebab/app` i `/opt/kebab/kebab_new`, zmiany backendu,
pip/apt, tagi i push poza `protrima-ui`. Blokada to sygnał, że krok jest dla człowieka:
nie obchodź jej innym poleceniem — napisz, co trzeba zrobić i dlaczego.

## Sprawdzenie przed „gotowe”

`npx tsc --noEmit` · `npm test` · `npm run build -- --mode proba` · `git diff main --stat` pokazuje
tylko dozwolone pliki · lista do sprawdzenia przez człowieka na :8090 (co kliknąć, co ma być widać,
przy 1920×1080 i 1366×768). Dane kopii możesz czytać przez
`psql -h 127.0.0.1 -p 5433 -U protrima_test -d kebab_protrima` (hasło w `/opt/kebab/config/protrima.env`).
