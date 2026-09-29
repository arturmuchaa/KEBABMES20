# Ważenie kartonu przy wjeździe do mroźni — projekt

Data: 2026-09-29. Zatwierdzone przez właściciela w rozmowie (wariant „tylko ostrzeżenie").

## Cel
Pełny karton (paleta zamówienia albo karton magazynowy), zanim wjedzie do mroźni
składowej, wjeżdża na wagę najazdową podłączoną do kiosku magazynu. System porównuje
brutto z wagi z netto wynikającym ze sztuk w kartonie i drukuje etykietę 100×150
potwierdzającą wagę, werdykt i godzinę ważenia. Etykietę nakleja się na karton.

## Reguły
- **Obowiązkowe dla PEŁNEGO kartonu**: karton magazynowy `status='packed'`, paleta
  zamówienia `status='packed'` (dopakowana skanem sztuk). Niepełny: bez zmian —
  karton magazynowy nadal NOT_FULL, rozpisana paleta zamówienia (`created`) wjeżdża
  starym skanem (decyzja 09.09.2026: mroźnia opcjonalna, sztuk nie skanują).
- **Niezgodność tylko ostrzega**: karton wjeżdża, etykieta ma wielkie „NIEZGODNA ±X kg".
- **Netto systemowe** = suma `finished_units.weight_kg` sztuk w kartonie.
- **Palety (tary) — lista w biurze**, każda pozycja: nazwa, tara od, tara do, zapas % netto.
  Domyślnie: jednorazowa drewniana 20–30, EURO 33,25–36,75 (35 ±5%),
  plastikowa jednorazowa 21,6–26,4 (24 ±10%); zapas 1% (do zmiany per pozycja).
- **Werdykt**: zgodna ⇔ `brutto − taraDo − zapas ≤ netto ≤ brutto − taraOd + zapas`,
  `zapas = netto × zapas% / 100`. Różnica na etykiecie = `(brutto − tara środkowa) − netto`.
  Werdykt liczy SERWER (front pokazuje podgląd tą samą regułą).
- Waga niedostępna → operator wpisuje brutto ręcznie, zapis i etykieta mają „RĘCZNIE".

## Backend
- `app/utils/wazenie_mrozni.py` — czyste: `normalize_pallet_types`, `werdykt`.
- `app_settings['magazyn_pallet_tares']`; `GET/PUT /api/magazyn/mroznia/palety`
  (GET = wydanie, PUT = biuro).
- Tabela `cold_storage_weighings` (kontener, numer kartonu, klient, skład jsonb, paleta,
  tary, zapas, brutto, netto, różnica, ok, tryb, operator, weighed_at).
- `POST /api/magazyn/mroznia/sprawdz {code}` — co to za karton, czy pełny, netto, skład.
- `POST /api/magazyn/mroznia/wazenie {code, palletTypeId, grossKg, mode}` — wstawia do
  mroźni istniejącą ścieżką i zapisuje ważenie; zwraca rekord do etykiety.
- `GET /api/magazyn/mroznia/wazenie/{container_id}` — ostatnie ważenie (dodruk).

## Kiosk (EkranMrozni)
Skan → `sprawdz`. Pełny → nakładka ważenia: kafle palet, odczyt z `useScale`,
podgląd werdyktu, „Zatwierdź i drukuj" (aktywne przy stabilnym odczycie albo ręcznym
wpisie). Niepełny → dotychczasowa ścieżka. Na liście „Stoi w mroźni" dodruk etykiety.

## Etykieta ZPL 100×150 (203 dpi)
Numer kartonu, klient, zamówienie/MAGAZYN, skład „15 × 50 kg ZAGROS", NETTO, BRUTTO,
paleta i tara, ZGODNA/NIEZGODNA ±X kg (negatyw), data i godzina ważenia, operator,
RĘCZNIE gdy ręcznie, QR kartonu (ten sam kod co kartka).

## Biuro
Ustawienia firmy → karta „Palety magazynu — tary do ważenia" (wiersze edytowalne).

## Testy
pytest: werdykt (widełki użytkownika), normalizacja, sprawdz/wazenie DB (oba rodzaje
kartonów, niepełny, ponowne ważenie). vitest: werdykt TS, ZPL (wymiary, treść),
nakładka ważenia z symulatorem wagi.
