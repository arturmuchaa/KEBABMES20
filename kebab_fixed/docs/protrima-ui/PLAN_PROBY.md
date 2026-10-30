# Plan próby PROTRIMA

**Cel:** nowy wygląd biura (Pulpit, Zamówienia, Wyrób gotowy) jako osobna aplikacja Tauri,
pracująca na KOPII bazy produkcji, obok niezmienionego MES. Po próbie decyzja: wdrażać czy poprawiać.

**Poza zakresem:** backend, migracje, stary interfejs, kioski, druk etykiet, kanał aktualizacji.

Każda faza = jedna sesja Claude Code w trybie planu (`docs/protrima-ui/PROMPTY.md`),
jeden commit, odbiór w `docs/protrima-ui/ODBIOR.md`.

---

## Faza 0 — środowisko (człowiek, root na Falkenstein, ok. 20 min)

Kopia zajmie na dysku tyle co baza produkcji. `pg_dump` czyta produkcję w jednej migawce
i do końca kopii wstrzymuje tylko zmiany struktury tabel — kopiuj, gdy nie trwa wdrożenie.

```bash
# Właściwy serwer? Stary Helsinki odpowiada 308. Miejsce na kopię?
curl -sI http://127.0.0.1:8080/ | head -1
df -h /var/lib/postgresql

# Worktree próby: produkcyjny checkout /opt/kebab/kebab_new zostaje nietknięty.
cd /opt/kebab/kebab_new && git status --short
git worktree add -b protrima-ui /opt/kebab/protrima HEAD

# Pakiet: same nowe pliki, -n = niczego nie nadpisuj.
cd /opt/kebab/protrima/kebab_fixed
unzip -n /root/protrima-proba-pakiet.zip
printf '\n@docs/protrima-ui/ZASADY_PROBY.md\n' >> CLAUDE.md
chmod +x deploy/protrima_proba.sh
python3 .claude/hooks/test_straznik_proby.py        # „114/114 przypadków OK”

# Backend próby i kopia bazy.
deploy/protrima_proba.sh instaluj
ln -s /etc/nginx/sites-available/protrima-proba /etc/nginx/sites-enabled/protrima-proba
nginx -t && systemctl reload nginx
ufw allow from <IP_BIURA> to any port 8090 proto tcp  # albo firewall w panelu Hetznera
deploy/protrima_proba.sh odswiez-baze
deploy/protrima_proba.sh status   # active, 200 na :8020 i :8090, „✓ izolacja”

# Front próby: dist w worktree = strona na :8090.
npm ci && npm run build -- --mode proba
git add -A && git commit -m "Próba PROTRIMA: środowisko, strażnik, plan"
```

**Odbiór:** na http://91.98.105.107:8090/index.html stary MES loguje się zwykłym kontem
i pokazuje dane z kopii. Zmiana w próbie (np. notatka w zamówieniu) nie pojawia się na :8080.

Jak próba jest odcięta od produkcji (szczegóły w nagłówku `deploy/protrima_proba.sh`):
osobna rola bazy bez praw do produkcji (sprawdzane w `status`), strażnik env przed startem
usługi, własne sekrety tokenów, sesje z produkcji usunięte z kopii, katalogi produkcji tylko
do odczytu dla procesu próby, nginx i zapora zmieniane wyłącznie ręcznie.

---

## Faza 1 — szkielet PROTRIMA

**Pliki:** `protrima.html` (jak `magazyn.html`), `src/protrima/**`, `public/brand/**`
(z `docs/protrima-ui/prototyp-v03/public/brand`), jedna linia w `vite.config.ts` (wejście
`protrima`), dwa miejsca w `src/lib/api.ts`, zależności `@fontsource/ibm-plex-sans`
i `@fontsource/ibm-plex-mono` (jedyne nowe).

1. Powłoka z prototypu: `src/shell/*`, `src/styles/*`, `src/brand/*` → `src/protrima/`.
   Bez danych demo (`src/data/demo.ts` nie wchodzi).
2. `src/lib/api.ts`:
   ```ts
   // PRÓBA PROTRIMA: build `--mode proba` łączy się z backendem na kopii bazy.
   const SERWER_MES = import.meta.env.MODE === 'proba'
     ? 'http://91.98.105.107:8090'
     : 'http://91.98.105.107:8080'
   ```
   oraz `'protrima'` na liście `standaloneKiosk` — inaczej 401 przerzuca do `/login`,
   czyli do starego MES.
3. Logowanie: `useAuth().loginOffice` z `src/features/auth/AuthContext.tsx`, własny ekran
   w stylu PROTRIMA. Token ten sam co w starym MES (`tokenStore`).
4. Pasek „PRÓBA — kopia bazy z <data>” na każdym ekranie; data z `/proba-kopia.json`
   (web: ścieżka względna; Tauri: adres z `BASE` bez `/api`).
5. Strażnik w `main.tsx`: Tauri + tryb inny niż `proba` → ekran „To nie jest build próby”.
6. lucide-react w repo to 0.323 (prototyp miał 0.460). Nie podbijaj wersji; zamień:
   `ChartColumn→BarChart3`, `CircleCheck→CheckCircle2`, `CircleMinus→MinusCircle`,
   `TriangleAlert→AlertTriangle`, `OctagonAlert→AlertOctagon`.
7. Moduły spoza próby: zaślepka „Ten moduł jest w starym MES”.

**Odbiór:** tsc, testy i build zielone; :8090/protrima.html — logowanie, okno z logo, menu,
paskiem narzędzi i kartami, pasek PRÓBA z datą kopii; wylogowanie w innej karcie wraca do
logowania PROTRIMA; :8090/index.html bez zmian; rozmiar paczki `protrima` (gzip) w commicie.

---

## Faza 2 — Zamówienia: odczyt

1. Lista: `clientOrdersApi.list()` + `useLiveRefresh`, jak `src/pages/office/ClientOrdersPage.tsx`.
2. Mapper odpowiedzi → widok w `src/protrima/zamowienia/mapuj.ts`, eksportowany i testowany
   (CLAUDE.md: mapery są testowane). Miary wyłącznie z `src/features/orders/lineShipping.ts`
   i `orderPlanning.ts`; produkcja, pokrycie i wysyłka w osobnych kolumnach.
3. Dolny panel, zakładki Pozycje / Produkcja / Pokrycie / Palety / Dokumenty — tylko odczyt.
   Źródła jak w starych komponentach: `src/features/orders/OrderLinesTable.tsx`,
   `OrderDocumentsMenu.tsx`, `src/components/orders/PalletsEditor.tsx`.
4. Przyciski akcji widoczne, wyłączone z opisem „faza 3”.
5. Test komponentu (`*.test.tsx`, `// @vitest-environment jsdom`, `afterEach(cleanup)`):
   odpowiedź API w kształcie prawdziwej (dane syntetyczne, nie z kopii), sprawdza to, co widzi
   operator — trzy miary osobno, statusy, liczby równe wynikom `lineShipping`.

**Odbiór:** 5 zamówień z kopii porównanych: stary widok (:8090/index.html) vs nowy — tabela
w ODBIOR.md, zero rozbieżności. Sprawdzone przy 1920×1080 i 1366×768 (oraz skalowaniu 125%).

---

## Faza 3 — Zamówienia: akcje

Tylko istniejące endpointy, z tymi samymi polami co stary ekran:

| Akcja | Wzór w starym MES |
|---|---|
| status, cofnięcie realizacji, usunięcie | `clientOrdersApi.updateStatus / cofnijRealizacje / delete` (ClientOrdersPage) |
| edycja pozycji | `src/features/orders/order-form/` |
| palety | `orderPalletsApi` jak `PalletsEditor.tsx` |
| kartony z magazynu | `stockCartonsApi` jak `StockCartonModal.tsx`, `PackedCartonsSection.tsx` |
| podział | `orderSplitApi` jak `split/SplitDialog.tsx` |
| WZ | `wzApi` jak `WzNewPage.tsx` (podgląd PDF; papiery z próby nie idą w obrót) |

- Niezmiennik 8: `id`, `carton_no` i adres `(order_id, pallet_no)` palety są stałe; usunięta
  paleta nie zwalnia numeru. Test: usunięcie, zmiana kolejności, przeniesienie.
- Druk etykiet Zebra: wyłączony z opisem (ZASADY, pkt 4).
- Akcje nieodwracalne z potwierdzeniem; błąd backendu jego słowami (`detail.message`).
- Test komponentu dla każdego ekranu, w którym wpisuje się liczby trafiające do ewidencji.

**Odbiór:** każda akcja wykonana na :8090 i sprawdzona w starym widoku na tej samej kopii.
Dla zmian stanu — ruch w `stock_movements` kopii
(`psql -h 127.0.0.1 -p 5433 -U protrima_test -d kebab_protrima`, hasło w env próby).

---

## Faza 4 — Wyrób gotowy

- Pozycje: `finishedGoodsApi.list` jak `FinishedGoodsPage.tsx`; kartony `stockCartonsApi`;
  jednostki `finishedUnitsApi` jak `BatchLocationSummary.tsx`, `OfficeUnitLookup.tsx`.
- Przydział do zamówienia tymi samymi wywołaniami co w fazie 3; po przydziale zamówienie
  odświeża się od razu (wspólny stan jak w prototypie, ale źródłem prawdy jest backend).
- Ruchy i partie: tylko odczyt (`traceApi`, `traceabilityApi`).

**Odbiór:** 10 pozycji zgodnych ze starym ekranem; przydział widoczny w zamówieniu bez przeładowania.

---

## Faza 5 — Pulpit

Te same wywołania co `src/pages/office/DashboardPage.tsx`: `clientOrdersApi.list`,
`finishedGoodsApi.list`, `rawBatchesApi.list/materialTypes`, `meatStockApi.list`,
`deboningApi.list`, `seasonedMeatApi.list`, `mixingOrdersApi.list`, `productionPlansApi.list`,
`productionSessionsApi.pending`, `receptionChecksApi.pending`, `zaladunkiApi.doWydruku`.
Najpierw sam odczyt; zatwierdzenia (`productionSessionsApi.approve`,
`productionPlansApi.officeConfirm`) dopiero gdy liczby się zgadzają.

**Odbiór:** liczby zgodne ze starym pulpitem na tej samej kopii; pulpit przewija się przy 1366×768.

---

## Faza 6 — aplikacja Tauri (Windows)

1. Szablony na miejsce:
   `git mv docs/protrima-ui/faza6/tauri.protrima-test.conf.json src-tauri/` i
   `git mv docs/protrima-ui/faza6/tauri-protrima-test.yml ../.github/workflows/`.
2. `src-tauri/Cargo.toml`, w `[features]`:
   ```toml
   # Build PRÓBNY PROTRIMA (pl.protrima.test): bez sprawdzania aktualizacji przy starcie.
   # Próba nie ma kanału aktualizacji — nowa wersja to nowy instalator z CI.
   proba = []
   ```
3. `src-tauri/src/lib.rs`: blok `#[cfg(not(feature = "kiosk"))]` w `.setup(...)` (wywołanie
   `check_for_updates`) i sama funkcja `check_for_updates` dostają
   `#[cfg(not(any(feature = "kiosk", feature = "proba")))]`. Nic więcej w Rust.
4. Własny pasek tytułu: `data-tauri-drag-region` na pasie z logo (nie na przyciskach i polach),
   przyciski okna przez `getCurrentWindow()` z `@tauri-apps/api/window`
   (`minimize`, `toggleMaximize`, `close`); w przeglądarce przyciski okna ukryte.
   Uprawnienia okna są w configu próby (`app.security.capabilities`), NIE w
   `src-tauri/capabilities/` — pliki z tego katalogu dostają wszystkie buildy produkcji.
5. Nowy instalator = podbicie `version` w `tauri.protrima-test.conf.json` + push gałęzi.
   Workflow niczego nie publikuje: artefakt „PROTRIMA-Test-Windows” w zakładce Actions (14 dni).

**Odbiór:** CI zielone, łącznie z `cargo check` buildu biurowego i kiosku (zmiana w lib.rs nie
psuje produkcji); instalacja per-user bez administratora obok Kebab MES; start zmaksymalizowany,
logowanie do :8090, pasek PRÓBA, brak okna aktualizacji; Kebab MES na tym komputerze bez zmian.
Jeśli okno bez ramki źle się zachowuje (zmiana rozmiaru, przyciąganie do krawędzi):
`"decorations": true` w configu próby i ukryte własne przyciski — jedna zmiana.

---

## Faza 7 — próba w biurze

- 1–2 osoby, 3–5 dni. Praca dzieje się dalej w starym MES; w PROTRIMA te same czynności na kopii.
- Kopia odświeżana na żądanie (`deploy/protrima_proba.sh odswiez-baze` — kasuje zmiany z próby).
- Uwagi w `docs/protrima-ui/UWAGI.md`; braki API w `BRAKI_API.md`.
- Decyzja po próbie: zero rozbieżności liczb ze starym MES, typowe czynności biura szybsze
  albo pewniejsze, lista braków API z oceną. Wdrożenie produkcyjne to osobny plan.

**Sprzątanie:** `deploy/protrima_proba.sh usun`, usunięcie linku nginx (komenda wypisze się
na końcu), reguła zapory, `git -C /opt/kebab/kebab_new worktree remove /opt/kebab/protrima`
(gałąź zostaje).

---

## Pułapki w repo, które ta próba omija

- `SERWER_MES` w `src/lib/api.ts` jest wpisany na sztywno → każdy build Tauri z repo trafia
  do produkcji. Próba: tryb `proba` + strażnik w `main.tsx` + CSP tylko na :8090.
- 401 przekierowuje do `/login` (stary MES), chyba że wejście jest na liście `standaloneKiosk`.
- `backend/app/config.py` doczytuje `.env` produkcji → env próby + `sprawdz-env` przed startem.
- Build biurowy Tauri sprawdza aktualizacje przy starcie → funkcja `proba`.
- Pliki w `src-tauri/capabilities/` dotyczą wszystkich buildów → uprawnienia inline w configu próby.
- `tauri-build.yml` publikuje aktualizację biura przy każdym pushu na
  `claude/kebab-mes-dashboard-BLmao` i tagu `v*` → strażnik pozwala pushować tylko `protrima-ui`.

## Znalezione przy okazji (poza próbą, do decyzji)

1. Ważny token renderowania PDF przepuszcza każde żądanie `/api` dowolną metodą przez 120 s
   (`backend/app/auth/middleware.py`). Sprawdzone na backendzie z repo uruchomionym lokalnie:
   z takim tokenem `DELETE` przechodzi przez uwierzytelnienie. Warto ograniczyć go do GET
   i ścieżek wydruku. Dlatego próba ma własny `RENDER_TOKEN_SECRET`.
2. Tabela `sessions` trzyma tokeny jawnie (kopia bazy = kopia aktywnych sesji; w próbie kasujemy).
