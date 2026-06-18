# Offline — walidacja lokalna skanu (prefetch uprawnionych sztuk)

Data: 2026-06-18 · Status: zatwierdzony · Rozszerza: offline-pakowanie

## Cel
Offline sprawdzać od ręki, czy skanowana sztuka pasuje do kartonu i nie jest
dublem — bez czekania na synchronizację. Dotyczy KARTONÓW MAGAZYNOWYCH (stock_cartons).

## Model
Karton = spec (klient+receptura+rodzaj+tuleja+waga) + target_qty; wypełniany
pasującymi sztukami. „Uprawnione sztuki" = finished_units status='produced',
carton_id IS NULL, zgodne ze spec kartonu (recipe+product_type+tuleja+kg).

## Backend
- `stock_cartons_service.eligible_units_for_carton(carton_id)` → lista
  `{code: qr_code, batchNo}` uprawnionych sztuk.
- Endpoint `GET /api/stock-cartons/{id}/eligible-units`.

## Frontend
- `stockCartonsApi.eligibleUnits(id)`.
- Otwarcie kartonu (online): prefetch uprawnionych → IndexedDB store `eligibleUnits`
  (keyed cartonId). Offline: czyta z IndexedDB.
- Pure `validateScanLocally({code, eligible:Set, scanned:Set})` → {ok, reason}:
  scanned.has → „już zeskanowana"; !eligible.has → „nie pasuje do kartonu"; inaczej ok.
  (TDD vitest)
- MobilePakowaniePage (karton magazynowy, offline): waliduj lokalnie zanim wrzucisz
  do kolejki. Niezgodne/dubel → odrzuć od razu (bez kolejki). Zgodne → enqueue +
  optymistycznie. `scanned` = kody z kolejki dla tego kartonu. Brak listy
  uprawnionych (np. nie pobrano) → fallback optymistyczny (jak dziś).

## Zakres
- Tylko kartony magazynowe. Palety zamówień: fallback optymistyczny (bez zmian).

## Haczyk (uczciwie)
Lista uprawnionych = migawka z momentu online. Jeśli ktoś inny offline-okresie
spakuje sztukę gdzie indziej → konflikt wyjdzie dopiero przy synchronizacji.
Redukuje błędy, nie eliminuje (ostateczna prawda na serwerze).

## Testy
- `validateScanLocally` (pure): wszystkie gałęzie.
- backend `eligible_units_for_carton`: zwraca pasujące produced/unpacked, wyklucza
  złą spec / packed / planned.
