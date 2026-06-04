# Projekt (HDI C-1+C-2): Fundament — kontrahent (destynacja+język) + ustawienia firmy

Data: 2026-06-04
Status: zatwierdzony (oczekuje na plan implementacji)
Powiązane: HDI C-3 (dokument+generowanie), C-4 (wyzwalanie+archiwum) — osobno.
[[kebab-wydanie-dokumenty-roadmap]]

## Kontekst

Budujemy HDI (handlowy dokument identyfikacyjny) — Część C. Dokument jest **dwujęzyczny**
(PL + język klienta) i potrzebuje danych, których dziś brakuje: **język i miejsce
przeznaczenia klienta** oraz **dane firmy specyficzne dla HDI** (nr weterynaryjny,
kwalifikacja rynku, miejsce załadunku). Ten spec dodaje TYLKO te fundamenty danych +
formularze; sam dokument to C-3.

Wzór: `/root/HDI wzor.pdf` (PL+DE) — odbiorca, miejsce rozładunku, sprzedawca, nr
weterynaryjny `PL 12060602WE`, rynek krajowy/UE, oświadczenie nadzór+HACCP, miejsce załadunku.

Języki (zatwierdzone): **PL** (zawsze) + **DE** (DE/AT), **SK**, **CZ**, **EN** (zapas).
Numeracja HDI: **NN/MM/RR** (ustalona; realizacja w C-3).

### Stan zastany

- `clients` (realne kolumny): `id, code, name, display_name, nip, regon, address, city,
  contact_name, phone, email, active`. Brak języka i destynacji. Formularz: `ClientsPage.tsx`
  (+ `GusLookup` po NIP). Model: `backend/app/models/clients.py::ClientCreate`. Serwis:
  `clients_service.create_client/update_client`. Mapowanie front: `mapClient` w `api.ts`;
  zapis przez `clientsApi` z `toSnake(dto)`.
- **Ustawienia firmy = JSON** w `app_settings` (klucz COMPANY_KEY); `settings_service.get_company/
  save_company`; model `CompanySettings` (name, nip, regon, address, city, postal_code, phone,
  email). **Brak migracji** — rozszerzamy model + `_empty_company` + formularz.
  Formularz: `CompanySettingsPage.tsx`.

## Architektura

### 1. C-1 — Kontrahent: język + miejsce przeznaczenia

**Migracja** (`backend/app/migrations.py`):
```python
"ALTER TABLE clients ADD COLUMN IF NOT EXISTS language TEXT DEFAULT ''",
"ALTER TABLE clients ADD COLUMN IF NOT EXISTS dest_name TEXT DEFAULT ''",
"ALTER TABLE clients ADD COLUMN IF NOT EXISTS dest_address TEXT DEFAULT ''",
"ALTER TABLE clients ADD COLUMN IF NOT EXISTS dest_city TEXT DEFAULT ''",
```

**Model** `ClientCreate`: dodać `language: str = ""`, `dest_name: str = ""`,
`dest_address: str = ""`, `dest_city: str = ""`.

**Serwis** `clients_service.create_client/update_client`: uwzględnić nowe kolumny w INSERT/UPDATE.

**Helper języka** (`backend/app/utils/hdi_lang.py`, czysty, testowalny):
```python
def lang_from_nip(nip: str) -> str:
    """Język wg 2-literowego prefiksu NIP. Brak/cyfry → 'pl'."""
    s = (nip or "").strip().upper()
    cc = s[:2] if len(s) >= 2 and s[:2].isalpha() else ""
    return {"PL": "pl", "DE": "de", "AT": "de", "SK": "sk", "CZ": "cs"}.get(cc, "pl" if not cc else "en")
```
(Reużyty w C-3 do wyboru języka; w C-1 do podpowiedzi w formularzu.)

**Front** `api.ts` `mapClient` + typ `Client`: dodać `language`, `destName`, `destAddress`,
`destCity` (`raw.language ?? ''` itd.). `clientsApi` używa `toSnake` — camelCase przejdzie.

**Front** `ClientsPage.tsx` (formularz klienta):
- Dropdown **Język**: opcje `pl/de/sk/cs/en` (etykiety: Polski/Niemiecki/Słowacki/Czeski/Angielski).
  Auto-podpowiedź: przy zmianie NIP, jeśli język pusty/niezmieniony ręcznie → ustaw
  `lang_from_nip(nip)` (mały helper front mirror lub stała mapa). Edytowalny.
- Sekcja **„Miejsce przeznaczenia"** (nagłówek + podpis „zostaw puste = adres klienta"):
  pola `destName`, `destAddress`, `destCity`.

### 2. C-2 — Ustawienia firmy dla HDI

**Model** `CompanySettings` (`backend/app/models/settings.py`) + `_empty_company`
(`settings_service`): dodać pola:
- `vet_number: str = ""` (weterynaryjny nr identyfikacyjny, np. „PL 12060602WE")
- `market_domestic: bool = True` (☒ rynek krajowy)
- `market_eu: bool = True` (☒ Unii Europejskiej)
- `load_place: str = ""` (miejsce załadunku; puste → użyć adresu firmy)

(JSON — bez migracji. Oświadczenie „nadzór wet. + HACCP" = stały tekst w szablonie HDI w C-3,
nie trzymamy w bazie.)

**Front** `api.ts` `CompanySettings`: dodać `vetNumber`, `marketDomestic`, `marketEu`,
`loadPlace`. (mapowanie snake↔camel jak reszta — sprawdzić mapper ustawień.)

**Front** `CompanySettingsPage.tsx`: dodać pola: nr weterynaryjny (input), dwa checkboxy
(rynek krajowy / UE), miejsce załadunku (input z podpowiedzią „puste = adres firmy").

## Obsługa błędów / brzegowe

| Sytuacja | Zachowanie |
|---|---|
| NIP bez prefiksu (polskie cyfry) | język → `pl` |
| NIP z nieznanym prefiksem (np. SI) | język → `en` (zapas); użytkownik może nadpisać |
| destynacja pusta | C-3 użyje głównego adresu klienta |
| `load_place` pusty | C-3 użyje adresu firmy |

## Testy

- Backend pytest (`test_hdi_lang.py`): `lang_from_nip` — 'pl' (cyfry/puste), 'de' (DE/AT),
  'sk' (SK), 'cs' (CZ), 'en' (SI/nieznany).
- Front: brak runnera → build + ręczna weryfikacja (zapis klienta z językiem/destynacją,
  zapis ustawień firmy z nr wet./rynkiem/miejscem załadunku — wartości się utrwalają).

## Poza zakresem (C-3 / C-4)

- Sam dokument HDI, szablon dwujęzyczny, generowanie z wydania, numeracja NN/MM/RR.
- Wyzwalanie przy wydaniu, sekcja „HDI" w sidebarze, archiwum kopii.
- CMR (osobny dokument, wzór `/root/cmr wzor.pdf`).

## Otwarte kwestie

- Czy auto-podpowiedź języka ma nadpisywać ręcznie wybrany — NIE: gdy użytkownik zmieni
  dropdown ręcznie, nie nadpisujemy przy kolejnej zmianie NIP (flaga „dotknięte" w formularzu).
