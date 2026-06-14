# Logowanie i konta z rolami w Kebab MES — projekt (spec)

Data: 2026-06-14
Status: do zatwierdzenia

## 1. Cel i kontekst

Wprowadzić realne uwierzytelnianie i kontrolę dostępu w MES:

- **Biuro** — logowanie login + hasło, pełny dostęp (planowanie, dokumenty, finanse, zakładanie kont).
- **Operatorzy hali** — zakładani przez biuro, biuro nadaje PIN i przypisuje działy.
  Na ekranie działu operator **wybiera swoje nazwisko z listy → wpisuje PIN → wchodzi**.
  Operator widzi tylko panele swoich działów.

Stan obecny: brak uwierzytelniania użytkowników. Istnieje tylko `app/utils/auth.py`
(`require_admin`, nagłówek `X-Admin-Token`, tryb miękki) na hipotetyczne `/api/admin/*`.
Istnieje już tabela **`workers`** (`name, role, pin, active, rate_per_kg, contract_type…`)
— operatorzy to workerzy z PIN-em. Front ma `OfficeLayout` (biuro) i `TabletLayout` (hala).

To jest **warunek wstępny przed wystawieniem dostępu zdalnego** (Cloudflare/Tailscale,
patrz wcześniejsze ustalenia wdrożeniowe).

## 2. Decyzje (zatwierdzone)

| Temat | Decyzja |
|---|---|
| Logowanie biura | login + hasło |
| Logowanie operatora | wybór nazwiska z listy + PIN (per dział) |
| Zakres operatora | per dział, możliwe wiele działów; biuro = wszystko |
| Sesja na kiosku | trwa do **ręcznego wylogowania** (bez auto-timeoutu); akcje przypisane do zalogowanego |
| Architektura | Wariant 1: sesje w bazie + reużycie `workers` + middleware po prefiksach |
| Hashowanie | bcrypt dla haseł i PIN-ów; blokada po kilku błędnych próbach |

## 3. Role i działy

**Role kont:**
- `admin` — właściciel. Wszystko + zarządzanie kontami biura. Tworzony przy bootstrapie.
- `office` — pełny dostęp do aplikacji (planowanie, dokumenty, finanse) + zarządzanie operatorami.
  Nie zarządza kontami biura.
- operator — dostęp wyłącznie do paneli przypisanych działów.

**Działy (kanoniczne slugi):** `rozbior`, `produkcja`, `pakowanie`, `wydanie`.
(Lista rozszerzalna; powiązana z flagą `MODULES` z wdrożenia — `MODULES` decyduje, które
panele w ogóle istnieją u klienta, działy decydują, który operator je widzi.)

## 4. Model danych

Reużywamy `workers` dla operatorów; osobna mała tabela dla biura; tabela sesji.

**`workers`** (rozszerzenie):
- `+ departments JSONB DEFAULT '[]'` — lista slugów działów operatora.
- `+ pin_hash TEXT` — bcrypt PIN-u (zastępuje jawny `pin`; `pin` zostaje przejściowo,
  usuwany w planie po migracji).
- `+ failed_attempts INT DEFAULT 0`, `+ locked_until TIMESTAMP NULL` — blokada PIN.

**`app_users`** (nowa — konta biura):
- `id` (cuid), `login` (unikalny), `password_hash`, `role` (`admin`|`office`),
  `display_name`, `active BOOL`, `must_change_password BOOL`,
  `failed_attempts INT`, `locked_until TIMESTAMP NULL`, `created_at`.

**`sessions`** (nowa):
- `token` (32 losowe bajty, PK), `subject_type` (`office`|`operator`),
  `subject_id` (→ `app_users.id` lub `workers.id`), `created_at`, `last_seen`,
  `label` (np. „kiosk rozbiór"), `expires_at NULL` (rezerwa na przyszłość).

Wszystkie zmiany przez `app/migrations.py` (CREATE/ALTER … IF NOT EXISTS, idempotentne).

## 5. Przepływy uwierzytelniania

**Logowanie biura:** `POST /api/auth/login` `{login, password}` → weryfikacja bcrypt,
sprawdzenie `active`/`locked_until` → utworzenie wpisu w `sessions` → zwrot `{token, user}`.
Po błędzie: `failed_attempts++`, po N (np. 5) `locked_until = now + 15 min`.

**Logowanie operatora:**
- `GET /api/auth/operators?department=rozbior` → lista `{id, name}` aktywnych workerów
  z tym działem (publiczne w ramach LAN; tylko id+nazwisko, bez PIN).
- `POST /api/auth/login-pin` `{worker_id, pin}` → weryfikacja bcrypt PIN, `active`, blokada →
  `sessions` → `{token, user}`. Blokada analogiczna.

**Wylogowanie:** `POST /api/auth/logout` (kasuje wpis w `sessions`). Przycisk „Wyloguj /
zmień operatora" w nagłówku `TabletLayout` i menu `OfficeLayout`.

**Kontekst użytkownika:** `GET /api/auth/me` → `{type, role, departments, name}` (aktualizuje
`last_seen`). Front używa do guardów i menu.

## 6. Egzekwowanie po stronie backendu

Lekki **middleware** mapujący prefiks ścieżki → wymagane uprawnienie. Zasada **default-deny**:
nieznane `/api/*` wymaga co najmniej `office`.

- **Publiczne:** `/api/auth/login`, `/api/auth/login-pin`, `/api/auth/operators`,
  `/api/health`, statyczny SPA/asset.
- **Tylko biuro (`office`/`admin`):** dokumenty i planowanie — `clients, suppliers, orders,
  hdi, wz, cmr, carriers, invoices, raw_batches, meat_stock, finished_goods, production_plans,
  product_types, recipes, settings, day_closures, cost, traceability, label_templates,
  vehicles, vies, byproducts, pallets, dispatches` (widok/zarządzanie).
- **Per dział (operator z działem LUB biuro):**
  - `rozbior` → `/api/deboning*`
  - `produkcja` → `/api/mixing*`, `/api/production_sessions*`, `/api/seasoned_meat*`
  - `pakowanie` → `/api/packaging*`, `/api/finished_units*`, pack-to-pallet
  - `wydanie` → `/api/dispatches*` (operacje hali), załadunek
- **Tylko `admin`:** `/api/app-users*` (zarządzanie kontami biura).

> Dokładna mapa endpoint→uprawnienie zostanie zweryfikowana w planie przez audyt
> `app/routes/*` (część routów obsługuje i biuro, i halę — wtedy „dział LUB office").

Implementacyjnie: dependency `current_session` (czyta token z nagłówka `Authorization: Bearer`,
ładuje sesję→podmiot→uprawnienia) + funkcja `permission_for_path(path)`; middleware łączy oba.

**PDF/wydruki:** `pdf_render.py` renderuje własne strony aplikacji przez headless chrome
(brak tokenu użytkownika). Strony wydruku dostają **jednorazowy token renderowania**
(podpisany, krótki) przekazywany przez `pdf_render`, akceptowany z pominięciem auth użytkownika.

**Hashowanie:** dodać `bcrypt` (lub `passlib[bcrypt]`) do `requirements_pg.txt`.

**Bootstrap:** przy starcie, jeśli brak konta `admin` → utwórz z `deploy/.env`
(`ADMIN_LOGIN`, `ADMIN_PASSWORD`); jeśli brak w env → utwórz `admin` z losowym hasłem
wypisanym RAZ do logów, `must_change_password=true`. Pierwsze logowanie wymusza zmianę hasła.

## 7. Egzekwowanie po stronie frontu

- **AuthContext** — trzyma `token` + `user` w pamięci, `token` w `localStorage`.
  Interceptor axios dokleja `Authorization: Bearer`; na `401` czyści token i przekierowuje
  do właściwego logowania.
- **Ekrany logowania:**
  - `/login` (biuro) — login + hasło; ekran wymuszonej zmiany hasła przy `must_change_password`.
  - `/panel` (hala) — kiosk przypięty do działu (ustawienie `kebab.kiosk.department`
    w `localStorage`). Pokazuje listę nazwisk działu + klawiaturę PIN. Jeśli dział nieustawiony
    → najpierw wybór działu.
- **Guardy tras:**
  - wrapper `OfficeLayout` → wymaga `office`/`admin`, inaczej redirect `/login`.
  - wrapper paneli hali → wymaga operatora z danym działem (lub biuro), inaczej redirect `/panel`.
- **Menu:** pozycje „Konta biura" widoczne tylko dla `admin`; operatorzy nie widzą menu biura.
- **Przycisk „Wyloguj / zmień operatora"** w nagłówkach.

**UI zarządzania kontami (biuro):**
- „Operatorzy" (office/admin) — rozszerzenie istniejącej strony workerów: dodawanie operatora
  (nazwisko + PIN + działy[]), reset PIN, dezaktywacja.
- „Konta biura" (admin) — tworzenie/edycja/dezaktywacja kont biura, reset hasła.

## 8. Testy

- **Backend (pytest):** hashowanie i weryfikacja hasła/PIN; logowanie poprawne/błędne;
  blokada po N próbach; walidacja sesji; `permission_for_path` (mapa prefiksów); middleware
  (operator bez działu → 403 na endpoint działu; operator → 403 na endpoint biura; biuro → OK);
  bootstrap admina. Logikę czystą (mapa uprawnień, hashe) testować bez DB.
- **Frontend (Playwright, CI):** logowanie biura; wybór operatora + PIN; redirecty guardów;
  ukrywanie menu biura operatorowi. Dokłada się do istniejącego e2e (uruchamiane w CI).

## 9. Bezpieczeństwo

- bcrypt dla haseł i PIN; blokada po błędnych próbach (anty-brute-force PIN-u).
- Sesje odwoływalne (kasowanie wpisu = natychmiastowe wylogowanie); podgląd aktywnych sesji.
- Middleware default-deny.
- Token w `localStorage` — akceptowalne dla aplikacji LAN/kiosk; przy dostępie zdalnym
  obowiązkowo TLS (Cloudflare/reverse proxy) — to spec jest właśnie warunkiem przed wystawieniem.
- Token renderowania PDF: krótkożyciowy, tylko do stron wydruku.

## 10. Poza zakresem (YAGNI)

Auto-wylogowanie po bezczynności; granularne uprawnienia per-ekran per-osoba; polityki
złożoności haseł poza minimalną długością; 2FA; pełny dziennik audytu (rozważyć później);
dodatkowe role biura poza `admin`/`office`.

## 11. Założenia / do potwierdzenia w planie

- Kiosk przypisany do działu przez ustawienie urządzenia (`localStorage`).
- Strony wydruku traktowane jako biuro (poza tokenem renderowania).
- Ostateczna mapa endpoint→uprawnienie po audycie `app/routes/*` (rozstrzygnięcie routów
  współdzielonych biuro/hala).
