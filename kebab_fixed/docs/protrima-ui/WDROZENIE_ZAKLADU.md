# PROTRIMA w kolejnym zakładzie

Zasada właściciela (30.10.2026): **PROTRIMA ma się dać wdrożyć w innym zakładzie w miarę łatwo.**
Jeden kod i jeden instalator dla wszystkich; to, czym zakłady się różnią, jest **konfiguracją albo
danymi na serwerze zakładu**, nigdy kodem. Model wdrożenia: osobna instancja na zakład (single-tenant,
osobna baza), patrz `deploy/` i `deploy/nowy-klient.sh`.

## Co jest czyje

| Co | Gdzie mieszka | Stan |
|---|---|---|
| Dane firmy (nazwa, NIP, adres, nr weterynaryjny, telefon) | serwer zakładu, `/api/settings/company` (Ustawienia → Firma) | ✅ PROTRIMA czyta z serwera (`zaklad/firma.ts`) |
| Klienci, dostawcy, receptury, rodzaje, tuleje, surowce, przewoźnicy | baza zakładu (kartoteki) | ✅ |
| Numeracja dokumentów (zamówienia, WZ, HDI, CMR, przyjęcia) | serwer zakładu (sekwencje) | ✅ |
| Próg kontroli HACCP przyjęć | serwer (`app_settings.haccp_checks_from`, ustawiany przy wdrożeniu) | ✅ PROTRIMA bierze listę z `haccp-pending` |
| Standard pakowania palet (szt./paletę wg wagi, warianty, max kg resztek) | `src/protrima/zaklad/zaklad.ts` → `PROFIL_DOMYSLNY` | ⚠️ w kodzie (jedno miejsce); docelowo serwer — BRAKI_API |
| Logo firmy na dokumentach | przejściowo plik w paczce + warunek po nazwie firmy (`logoDokumentu`) | ⚠️ docelowo serwer — BRAKI_API |
| Włączone moduły (np. zakład bez rozbioru ćwiartki) | — | ❌ do zrobienia: profil zakładu + menu z profilu |
| Adres serwera zakładu (aplikacja desktopowa) | dziś w `src/lib/api.ts` (próba: kopia :8090) | ❌ do zrobienia przy buildzie produkcyjnym (niżej) |
| Marka produktu PROTRIMA (logo, nazwa okna) | kod — wspólna dla wszystkich | ✅ celowo stała |

**Reguła dla nowego kodu:** nazwy firm, logo, adresy, daty wdrożeń, standardy i progi zakładowe nie trafiają
do modułów. Albo przychodzą z serwera, albo z `src/protrima/zaklad/`. Przegląd: `grep -rni "księżyc\|91\.98" src/protrima`.

## Do zrobienia przed pierwszym wdrożeniem poza pierwszym zakładem

1. **Adres serwera przy pierwszym uruchomieniu** (build produkcyjny PROTRIMA): pole „Serwer zakładu” na ekranie
   logowania, zapamiętane na komputerze; `src/lib/api.ts` bierze je dla wejścia `protrima`; osobny
   `tauri.protrima.conf.json` z `connect-src` dopuszczającym adres zakładu. W PRÓBIE adres zostaje zablokowany na kopię.
2. **Profil zakładu na serwerze** (zmiana backendu — decyzja właściciela): `GET/PUT /api/settings/protrima`
   (JSON w `app_settings`: standard pakowania, moduły) + logo firmy (upload, `GET /api/settings/logo`).
   Po stronie PROTRIMA zmienia się tylko `profilZakladu()` / `logoDokumentu()` i dochodzi ekran „Ustawienia zakładu”.
3. **Moduły z profilu**: menu i Pulpit pokazują tylko to, co zakład ma (np. bez „Ćwiartka i rozbiór”).

## Nowy zakład — kroki (docelowo)

1. Serwer: `bash deploy/nowy-klient.sh <slug>` (czysta baza, własne sekrety).
2. Ustawienia → Firma: nazwa, NIP, adres, nr weterynaryjny; logo.
3. Kartoteki: klienci, dostawcy, receptury, rodzaje, tuleje; profil zakładu (pakowanie, moduły).
4. Konta biura (login + rola).
5. Komputer biura: instalator PROTRIMA → przy pierwszym uruchomieniu adres serwera zakładu → logowanie.
