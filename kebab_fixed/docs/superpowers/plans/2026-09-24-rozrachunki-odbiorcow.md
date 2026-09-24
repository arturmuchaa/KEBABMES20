# Rozrachunki z odbiorcami — plan wykonania

> **Dla wykonawcy:** WYMAGANY SUB-SKILL: `superpowers:subagent-driven-development`
> (zalecany) albo `superpowers:executing-plans`. Kroki mają pola wyboru
> (`- [ ]`) do odhaczania.

**Cel:** zastąpić arkusz `PŁATNOŚCI08.04.xlsx` saldem, któremu można ufać —
i wydrukiem, który biuro podpina klientowi do dokumentów.

**Architektura:** trzy tabele (saldo otwarcia, obciążenia, wpłaty) plus dwa
pola na `clients`. Obciążenia z WZ zaciągają się z MES automatycznie, faktury
wpisuje biuro. Saldo jest liczone, nigdy przechowywane. Cała arytmetyka
w czystej funkcji bez bazy, żeby dała się przetestować na liczbach.

**Stos:** FastAPI + PostgreSQL (psycopg2), React 18 + TypeScript + Vite,
pytest, vitest.

**Specyfikacja:** `docs/superpowers/specs/2026-09-24-rozrachunki-odbiorcow-design.md`

## Global Constraints

- **Saldo otwarcia jest ODCIĘCIEM.** Do salda liczą się wyłącznie dokumenty
  o dacie **PO** `as_of_date`. Wszystko wcześniejsze zawiera się w tej jednej
  kwocie. Bez tego 177 historycznych WZ doliczy się na wierzchu.
- **WM NIGDY nie obciąża klienta** — to ruch magazynowy. Obciąża WZ i faktura.
- **Waluta jest per klient** (`PLN` albo `EUR`), nie per dokument.
- **Znak: ujemne = klient nam winien** (jak w ich arkuszu).
- Terminy: **faktura +14 dni, WZ +1 dzień**, liczone od **daty dostawy**.
  Trzymane w ustawieniach, nie zaszyte w kodzie.
- Anulowany dokument nie obciąża.
- Migracje dopisujemy na KOŃCU listy `_DDL` w `backend/app/migrations.py`
  (linia ~1800, przed `]`). Każda musi być idempotentna (`IF NOT EXISTS`).
- Testy DB: `TEST_DATABASE_URL=postgresql://postgres:p@localhost:55437/kebab_mes_test`
  — bez pełnego URL-a testy cicho się pomijają. **Jeden przebieg pytest naraz.**
- Trasy rejestrują się automatycznie (skan modułów w `backend/app/main.py`);
  wystarczy plik w `backend/app/routes/` z obiektem `router`.
- `git add` ŚCIEŻKAMI, nigdy `-A`.

## Review Focus

Pięć rzeczy, które specyfikacja zakłada, a które najłatwiej zepsuć — każda
ma swój test w zadaniu, które jest za nią odpowiedzialne:

1. **Dokument z datą DOKŁADNIE równą dacie odcięcia** — liczy się czy nie?
   Przyjmujemy: odcięcie jest zamknięte od dołu, liczą się dokumenty
   `doc_date > as_of_date`. (Zadanie 2)
2. **Klient bez salda otwarcia** — brak wiersza to nie zero, tylko „nie
   skonfigurowano"; ekran ma to powiedzieć, a nie pokazać 0,00. (Zadanie 3)
3. **Wpłata w innej walucie niż klient** — odrzucamy przy zapisie, bo
   po cichu zsumowana zafałszuje saldo. (Zadanie 4)
4. **Zmiana waluty klienta przy niezerowym saldzie** — odmowa z komunikatem,
   nie cicha zamiana jednostki. (Zadanie 1)
5. **Wydruk dokumentu bieżącego** — nie może liczyć się sam do siebie jako
   zaległość; saldo „przed" i „po". (Zadanie 8)

---

### Zadanie 1: Schemat i ustawienia kontrahenta

**Pliki:**
- Modify: `backend/app/migrations.py` (koniec listy `_DDL`, przed `]`)
- Modify: `backend/app/services/clients_service.py`
- Test: `backend/tests/test_rozrachunki_schemat_db.py`

**Interfejsy:**
- Produces: kolumny `clients.settlement_enabled` (bool), `clients.settlement_currency`
  (text `'PLN'|'EUR'`); tabele `client_opening_balances`, `client_charges`,
  `client_payments`; `clients_service.ustaw_rozliczenie(client_id, enabled, currency)`.

- [ ] **Krok 1: Test — kolumny i tabele istnieją, domyślne wartości są bezpieczne**

```python
"""Schemat rozrachunków.

Domyślnie rozliczenie jest WYŁĄCZONE: włączenie go dla wszystkich 60
kontrahentów naraz zrobiłoby z ekranu listę, której nikt nie czyta.
"""
from app.db import execute, query_one


def test_nowy_klient_ma_rozliczenie_wylaczone(db):
    execute("INSERT INTO clients (id, code, name) VALUES ('c9','C9','TEST')")
    row = query_one("SELECT settlement_enabled, settlement_currency "
                    "FROM clients WHERE id='c9'")
    assert row["settlement_enabled"] is False
    assert row["settlement_currency"] == "PLN"


def test_tabele_rozrachunkow_istnieja(db):
    for t in ("client_opening_balances", "client_charges", "client_payments"):
        assert query_one(
            "SELECT 1 AS x FROM information_schema.tables "
            "WHERE table_schema='public' AND table_name=%s", (t,)) is not None
```

- [ ] **Krok 2: Uruchom test — ma paść**

Run: `cd backend && TEST_DATABASE_URL=postgresql://postgres:p@localhost:55437/kebab_mes_test pytest tests/test_rozrachunki_schemat_db.py -q`
Oczekiwane: FAIL — kolumna `settlement_enabled` nie istnieje.

- [ ] **Krok 3: Dopisz migracje na końcu listy `_DDL`**

```python
    # ── Rozrachunki z odbiorcami (24.09.2026) ───────────────────────────
    # Domyślnie WYŁĄCZONE: właściciel prowadzi rozliczenia dla części
    # kontrahentów (27 zakładek w arkuszu), nie dla wszystkich w kartotece.
    "ALTER TABLE clients ADD COLUMN IF NOT EXISTS "
    "settlement_enabled BOOLEAN NOT NULL DEFAULT false",
    # Waluta PER KLIENT, nie per dokument — „w zależności od klienta jest
    # albo euro albo PLN". Saldo jest wtedy jedną liczbą.
    "ALTER TABLE clients ADD COLUMN IF NOT EXISTS "
    "settlement_currency TEXT NOT NULL DEFAULT 'PLN'",
    # Saldo otwarcia = ODCIĘCIE. Do salda liczą się wyłącznie dokumenty
    # PO `as_of_date`; wszystko wcześniejsze zawiera się w `amount`.
    """CREATE TABLE IF NOT EXISTS client_opening_balances (
        client_id  TEXT PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
        amount     NUMERIC NOT NULL DEFAULT 0,
        currency   TEXT NOT NULL DEFAULT 'PLN',
        as_of_date DATE NOT NULL,
        note       TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ DEFAULT now()
    )""",
    # `kind`: 'wz' (zaciągane z MES) albo 'invoice' (wpisywane przez biuro).
    # `source_id` wskazuje `wz_documents.id` dla 'wz', a dla faktury zostaje
    # puste do czasu integracji z Subiektem.
    """CREATE TABLE IF NOT EXISTS client_charges (
        id         TEXT PRIMARY KEY,
        client_id  TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        kind       TEXT NOT NULL,
        source_id  TEXT NOT NULL DEFAULT '',
        number     TEXT NOT NULL DEFAULT '',
        doc_date   DATE NOT NULL,
        qty_kg     NUMERIC NOT NULL DEFAULT 0,
        amount     NUMERIC NOT NULL DEFAULT 0,
        currency   TEXT NOT NULL DEFAULT 'PLN',
        note       TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ DEFAULT now()
    )""",
    "CREATE INDEX IF NOT EXISTS idx_client_charges_klient "
    "ON client_charges(client_id, doc_date)",
    # Numer faktury jest unikalny w obrębie kontrahenta — biuro wpisuje go
    # ręcznie i pomyłka „wpisałem dwa razy" ma się odbić o bazę, nie o oko.
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_client_charges_faktura "
    "ON client_charges(client_id, number) WHERE kind='invoice' AND number <> ''",
    """CREATE TABLE IF NOT EXISTS client_payments (
        id         TEXT PRIMARY KEY,
        client_id  TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        paid_date  DATE NOT NULL,
        amount     NUMERIC NOT NULL DEFAULT 0,
        currency   TEXT NOT NULL DEFAULT 'PLN',
        note       TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ DEFAULT now()
    )""",
    "CREATE INDEX IF NOT EXISTS idx_client_payments_klient "
    "ON client_payments(client_id, paid_date)",
```

- [ ] **Krok 4: Uruchom test — ma przejść**

Run: `cd backend && TEST_DATABASE_URL=postgresql://postgres:p@localhost:55437/kebab_mes_test pytest tests/test_rozrachunki_schemat_db.py -q`
Oczekiwane: PASS (2 testy).

- [ ] **Krok 5: Test — zmiana waluty przy niezerowym saldzie ODMAWIA**

Dopisz do `tests/test_rozrachunki_schemat_db.py`:

```python
import pytest
from fastapi import HTTPException

from app.services import clients_service


def test_zmiana_waluty_przy_NIEZEROWYM_saldzie_odmawia(db):
    """Review Focus 4. Zamiana 'PLN' na 'EUR' nie przelicza kwot — zrobiłaby
    z długu 15 000 zł dług 15 000 €. Odmawiamy i każemy to rozstrzygnąć
    świadomie."""
    execute("INSERT INTO clients (id, code, name, settlement_enabled) "
            "VALUES ('c1','C1','YALCIN',true)")
    execute("INSERT INTO client_opening_balances (client_id, amount, currency, as_of_date) "
            "VALUES ('c1',-15649,'PLN','2026-09-01')")

    with pytest.raises(HTTPException) as e:
        clients_service.ustaw_rozliczenie("c1", enabled=True, currency="EUR")
    assert e.value.status_code == 409


def test_zmiana_waluty_przy_ZEROWYM_saldzie_przechodzi(db):
    execute("INSERT INTO clients (id, code, name) VALUES ('c1','C1','YALCIN')")

    clients_service.ustaw_rozliczenie("c1", enabled=True, currency="EUR")

    assert query_one("SELECT settlement_currency FROM clients WHERE id='c1'"
                     )["settlement_currency"] == "EUR"
```

- [ ] **Krok 6: Uruchom — ma paść na braku `ustaw_rozliczenie`**

- [ ] **Krok 7: Dopisz `ustaw_rozliczenie` do `clients_service.py`**

```python
_WALUTY_ROZLICZEN = ("PLN", "EUR")


def ustaw_rozliczenie(client_id: str, enabled: bool, currency: str) -> Dict[str, Any]:
    """Włącznik rozrachunków i waluta rozliczeniowa kontrahenta.

    Waluta jest PER KLIENT (decyzja właściciela 24.09.2026), więc saldo jest
    jedną liczbą zamiast dwóch równoległych.

    ZMIANY WALUTY PRZY NIEZEROWYM SALDZIE ODMAWIAMY. Kwoty nie są
    przeliczane — zamiana jednostki zrobiłaby z długu 15 649 zł dług
    15 649 €, a liczba wyglądałaby tak samo sensownie jak przedtem.
    """
    waluta = (currency or "PLN").upper()
    if waluta not in _WALUTY_ROZLICZEN:
        raise HTTPException(400, f"Nieznana waluta rozliczeń: {currency}")

    obecna = query_one(
        "SELECT settlement_currency FROM clients WHERE id=%s", (client_id,))
    if not obecna:
        raise HTTPException(404, "Kontrahent nie znaleziony")

    if obecna["settlement_currency"] != waluta:
        saldo = query_one(
            "SELECT COALESCE((SELECT amount FROM client_opening_balances "
            "                 WHERE client_id=%s), 0) "
            "     + COALESCE((SELECT SUM(amount) FROM client_charges "
            "                 WHERE client_id=%s), 0) "
            "     - COALESCE((SELECT SUM(amount) FROM client_payments "
            "                 WHERE client_id=%s), 0) AS s",
            (client_id, client_id, client_id))
        if abs(float((saldo or {}).get("s") or 0)) > 0.005:
            raise HTTPException(
                409,
                "Kontrahent ma niezerowe saldo — zmiana waluty nie przelicza "
                "kwot. Rozlicz saldo do zera albo popraw dokumenty, potem "
                "zmień walutę.")

    execute("UPDATE clients SET settlement_enabled=%s, settlement_currency=%s "
            "WHERE id=%s", (bool(enabled), waluta, client_id))
    logger.info("client.settlement.set",
                extra={"client_id": client_id, "waluta": waluta})
    return {"clientId": client_id, "enabled": bool(enabled), "currency": waluta}
```

- [ ] **Krok 8: Uruchom testy — 4 mają przejść**

- [ ] **Krok 9: Commit**

```bash
git add kebab_fixed/backend/app/migrations.py \
        kebab_fixed/backend/app/services/clients_service.py \
        kebab_fixed/backend/tests/test_rozrachunki_schemat_db.py
git commit -m "feat(rozrachunki): schemat i ustawienia rozliczen kontrahenta"
```

---

### Zadanie 2: Saldo jako czysta funkcja

**Pliki:**
- Create: `backend/app/services/rozrachunki_saldo.py`
- Test: `backend/tests/test_rozrachunki_saldo.py`

**Interfejsy:**
- Produces:
  `policz_saldo(otwarcie: Optional[Dict], obciazenia: List[Dict], wplaty: List[Dict]) -> Dict`
  zwraca `{"otwarcie": float, "obciazenia": float, "wplaty": float, "saldo": float,
  "skonfigurowane": bool}`;
  `po_odcieciu(pozycje: List[Dict], as_of, pole: str) -> List[Dict]`;
  `termin_platnosci(doc_date: date, kind: str, terminy: Dict[str, int]) -> date`;
  `dni_po_terminie(termin: date, na_dzien: date) -> int`.

- [ ] **Krok 1: Napisz testy** (`backend/tests/test_rozrachunki_saldo.py`)

```python
"""Arytmetyka rozrachunków — bez bazy, na samych liczbach.

Znak: UJEMNE = klient jest nam winien (jak w arkuszu biura, gdzie
`SALDO W € = -15649` oznacza dług YBM GASTRO).
"""
from datetime import date

import pytest

from app.services.rozrachunki_saldo import (dni_po_terminie, po_odcieciu,
                                            policz_saldo, termin_platnosci)


def test_saldo_to_otwarcie_plus_obciazenia_minus_wplaty():
    wynik = policz_saldo(
        {"amount": -1000.0},
        [{"amount": -500.0}, {"amount": -300.0}],
        [{"amount": -700.0}])
    assert wynik["saldo"] == pytest.approx(-1100.0)


def test_brak_salda_otwarcia_to_NIE_jest_zero():
    """Review Focus 2. „Nie skonfigurowano" i „zero" to dwie różne rzeczy —
    ekran ma powiedzieć, że saldo otwarcia trzeba wpisać, a nie pokazać
    0,00 i udawać, że klient nic nie jest winien."""
    assert policz_saldo(None, [], [])["skonfigurowane"] is False
    assert policz_saldo({"amount": 0.0}, [], [])["skonfigurowane"] is True


def test_odciecie_pomija_dokumenty_SPRZED_daty():
    """REGUŁA NADRZĘDNA. Bez tego 177 historycznych WZ doliczyłoby się
    na wierzchu salda otwarcia."""
    poz = [{"doc_date": date(2026, 8, 31), "amount": -100.0},
           {"doc_date": date(2026, 9, 30), "amount": -200.0}]
    assert [p["amount"] for p in po_odcieciu(poz, date(2026, 9, 1), "doc_date")] == [-200.0]


def test_dokument_Z_DATA_ODCIECIA_sie_NIE_liczy():
    """Review Focus 1. Odcięcie zamknięte od dołu: saldo „na dzień 1.09"
    zawiera wszystko do 1.09 włącznie."""
    poz = [{"doc_date": date(2026, 9, 1), "amount": -100.0}]
    assert po_odcieciu(poz, date(2026, 9, 1), "doc_date") == []


def test_termin_faktury_to_14_dni_od_dostawy():
    assert termin_platnosci(date(2026, 9, 10), "invoice", {"invoice": 14, "wz": 1}) \
        == date(2026, 9, 24)


def test_termin_WZ_to_jeden_dzien():
    """Towar wyjeżdża dzień wcześniej, więc „przy odbiorze" to +1, nie 0."""
    assert termin_platnosci(date(2026, 9, 10), "wz", {"invoice": 14, "wz": 1}) \
        == date(2026, 9, 11)


def test_dni_po_terminie_liczone_na_dzien_wydruku():
    assert dni_po_terminie(date(2026, 9, 11), date(2026, 9, 20)) == 9


def test_przed_terminem_zero_a_nie_liczba_ujemna():
    """Na papierze dla klienta „-5 dni po terminie" nie znaczy nic."""
    assert dni_po_terminie(date(2026, 9, 30), date(2026, 9, 20)) == 0
```

- [ ] **Krok 2: Uruchom — ma paść na imporcie**

Run: `cd backend && TEST_DATABASE_URL=postgresql://postgres:p@localhost:55437/kebab_mes_test pytest tests/test_rozrachunki_saldo.py -q`
Oczekiwane: FAIL — `ModuleNotFoundError: app.services.rozrachunki_saldo`.

- [ ] **Krok 3: Napisz `backend/app/services/rozrachunki_saldo.py`**

```python
"""Arytmetyka rozrachunków z odbiorcami — bez bazy, na samych liczbach.

Wydzielone z serwisu celowo: saldo jest jedyną liczbą w tym module, której
biuro nie może sprawdzić na oko, więc musi dać się przetestować na
wymyślonych danych, bez stawiania dokumentów.

ZNAK: ujemne = klient jest nam winien. Tak jest w arkuszu biura
(`SALDO W € = -15649` to dług YBM GASTRO) i zmiana tej konwencji przy
przepisywaniu sald otwarcia byłaby źródłem cichych pomyłek.
"""
from datetime import date, timedelta
from typing import Any, Dict, List, Optional

#: Domyślne terminy płatności (dni). Właściciel 24.09.2026: „termin FV
#: 14 dni od daty wydania, a WZ wymagany przy odbiorze, czyli +1 dzień,
#: bo wyjeżdża do klientów zawsze dzień wcześniej".
TERMINY_DOMYSLNE = {"invoice": 14, "wz": 1}


def policz_saldo(otwarcie: Optional[Dict[str, Any]],
                 obciazenia: List[Dict[str, Any]],
                 wplaty: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Saldo = otwarcie + obciążenia − wpłaty, wszystko w walucie klienta.

    `skonfigurowane` odróżnia „saldo wynosi zero" od „nikt nie wpisał salda
    otwarcia". Bez tego ekran pokazywałby 0,00 dla kontrahenta, którego
    nikt jeszcze nie rozliczył — i biuro uznałoby, że nic nie jest winien.
    """
    o = float((otwarcie or {}).get("amount") or 0.0)
    suma_obc = sum(float(x.get("amount") or 0.0) for x in obciazenia or [])
    suma_wpl = sum(float(x.get("amount") or 0.0) for x in wplaty or [])
    return {
        "otwarcie": round(o, 2),
        "obciazenia": round(suma_obc, 2),
        "wplaty": round(suma_wpl, 2),
        "saldo": round(o + suma_obc - suma_wpl, 2),
        "skonfigurowane": otwarcie is not None,
    }


def po_odcieciu(pozycje: List[Dict[str, Any]], as_of: Optional[date],
                pole: str) -> List[Dict[str, Any]]:
    """REGUŁA NADRZĘDNA modułu: liczą się wyłącznie dokumenty PO dacie
    salda otwarcia.

    Odcięcie jest ZAMKNIĘTE OD DOŁU — saldo „na dzień 1.09" zawiera
    wszystko do 1.09 włącznie, więc dokument z tą datą już się nie liczy.

    Bez tego obciążenia zaciągnęłyby się ze 177 historycznych WZ leżących
    w bazie i doliczyły NA WIERZCHU salda otwarcia; błąd byłby cichy, bo
    kwoty wyglądałyby sensownie.
    """
    if as_of is None:
        return list(pozycje or [])
    return [p for p in (pozycje or []) if p.get(pole) and p[pole] > as_of]


def termin_platnosci(doc_date: date, kind: str,
                     terminy: Optional[Dict[str, int]] = None) -> date:
    """Termin liczony od daty DOSTAWY, nie od daty wystawienia dokumentu —
    tak jak w arkuszu biura, gdzie kolumna faktur ma nagłówek
    „DATA DOSTAWY"."""
    t = terminy or TERMINY_DOMYSLNE
    return doc_date + timedelta(days=int(t.get(kind, 0)))


def dni_po_terminie(termin: date, na_dzien: date) -> int:
    """Zero przed terminem, nie liczba ujemna: „-5 dni po terminie" na
    papierze dla klienta nic nie znaczy."""
    return max(0, (na_dzien - termin).days)
```

- [ ] **Krok 4: Uruchom — 8 testów ma przejść**

- [ ] **Krok 5: Commit**

```bash
git add kebab_fixed/backend/app/services/rozrachunki_saldo.py \
        kebab_fixed/backend/tests/test_rozrachunki_saldo.py
git commit -m "feat(rozrachunki): arytmetyka salda jako czysta funkcja"
```

---

### Zadanie 3: Serwis odczytu — obciążenia z WZ, faktury, wpłaty, saldo

**Pliki:**
- Create: `backend/app/services/rozrachunki_service.py`
- Test: `backend/tests/test_rozrachunki_service_db.py`

**Interfejsy:**
- Consumes: `rozrachunki_saldo.policz_saldo`, `po_odcieciu`, `termin_platnosci`,
  `dni_po_terminie`, `TERMINY_DOMYSLNE`
- Produces: `karta_klienta(client_id, na_dzien=None) -> Dict` z kluczami
  `client`, `otwarcie`, `obciazenia` (lista), `wplaty` (lista), `saldo`,
  `waluta`, `na_dzien`; `zestawienie() -> List[Dict]`.

- [ ] **Krok 1: Napisz testy**

```python
"""Rozrachunki — składanie karty kontrahenta z danych MES.

Obciążenia z WZ zaciągają się automatycznie; faktury i wpłaty wpisuje
biuro. WM nigdy nie obciąża — to ruch magazynowy, nie należność.
"""
from datetime import date

from app.db import execute
from app.services.rozrachunki_service import karta_klienta, zestawienie


def _klient(cid="c1", waluta="PLN", enabled=True):
    execute("INSERT INTO clients (id, code, name, settlement_enabled, "
            " settlement_currency) VALUES (%s,%s,'YALCIN',%s,%s)",
            (cid, cid.upper(), enabled, waluta))
    return cid


def _otwarcie(cid="c1", kwota=-1000.0, na="2026-09-01", waluta="PLN"):
    execute("INSERT INTO client_opening_balances (client_id, amount, currency, as_of_date) "
            "VALUES (%s,%s,%s,%s)", (cid, kwota, waluta, na))


def _wz(wid, cid, numer, data, wartosc, seria="WZ", status="wstepny"):
    """`wz_documents` NIE MA `client_id` — powiązanie idzie przez ZAMÓWIENIE
    albo przez nazwę nabywcy. Tu przez zamówienie, bo to pewniejsza droga
    i tak powstaje większość dokumentów."""
    execute("INSERT INTO client_orders (id, order_no, client_id, client_name) "
            "VALUES (%s,%s,%s,'YALCIN') ON CONFLICT (id) DO NOTHING",
            (f"ord-{wid}", f"ZAM/{wid}", cid))
    execute(
        "INSERT INTO wz_documents (id, number, seq, year_month, buyer_name, lines, "
        " total_value, valued, status, doc_series, currency, source_type, source_id, "
        " issued_date) "
        "VALUES (%s,%s,1,'2609','YALCIN','[]'::jsonb,%s,true,%s,%s,'PLN','order',%s,%s)",
        (wid, numer, wartosc, status, seria, f"ord-{wid}", data))


def test_WZ_po_odcieciu_obciaza_klienta(db):
    _klient(); _otwarcie()
    _wz("w1", "c1", "WZ/9/09/26", "2026-09-15", 3000.0)

    karta = karta_klienta("c1")

    assert [(o["number"], o["amount"]) for o in karta["obciazenia"]] == \
        [("WZ/9/09/26", -3000.0)]


def test_WZ_SPRZED_odciecia_NIE_obciaza(db):
    """REGUŁA NADRZĘDNA — inaczej historia doliczyłaby się na wierzchu."""
    _klient(); _otwarcie(na="2026-09-10")
    _wz("w1", "c1", "WZ/1/09/26", "2026-09-05", 3000.0)

    assert karta_klienta("c1")["obciazenia"] == []


def test_WM_NIGDY_nie_obciaza(db):
    """WM to ruch magazynowy. Gdyby obciążał, ten sam towar policzyłby się
    dwa razy: raz jako WM, raz jako faktura."""
    _klient(); _otwarcie()
    _wz("w1", "c1", "WM/3/09/26", "2026-09-15", 3000.0, seria="WM")

    assert karta_klienta("c1")["obciazenia"] == []


def test_ANULOWANY_WZ_nie_obciaza(db):
    _klient(); _otwarcie()
    _wz("w1", "c1", "WZ/9/09/26", "2026-09-15", 3000.0, status="anulowany")

    assert karta_klienta("c1")["obciazenia"] == []


def test_faktura_i_wplata_wchodza_do_salda(db):
    _klient(); _otwarcie(kwota=-1000.0)
    execute("INSERT INTO client_charges (id, client_id, kind, number, doc_date, amount, "
            " currency) VALUES ('ch1','c1','invoice','FS 12/09/2026','2026-09-15',-2000,'PLN')")
    execute("INSERT INTO client_payments (id, client_id, paid_date, amount, currency) "
            "VALUES ('p1','c1','2026-09-20',-500,'PLN')")

    karta = karta_klienta("c1")

    assert karta["saldo"]["saldo"] == -2500.0


def test_karta_niesie_TERMIN_i_dni_po_terminie(db):
    _klient(); _otwarcie()
    _wz("w1", "c1", "WZ/9/09/26", "2026-09-15", 3000.0)

    poz = karta_klienta("c1", na_dzien=date(2026, 9, 20))["obciazenia"][0]

    assert poz["termin"] == date(2026, 9, 16)      # WZ = +1 dzień
    assert poz["dni_po_terminie"] == 4


def test_dokument_trafia_do_WLASCIWEJ_spolki_mimo_wspolnej_nazwy(db):
    """PUŁAPKA: w kartotece są DWIE karty o nazwie handlowej YALCIN
    (YBM Gastro i Emin Handels, rozbite 27.08.2026). Dopasowanie po samej
    nazwie dopisałoby dług obcej firmie."""
    _klient("c1"); _otwarcie("c1")
    _klient("c2"); _otwarcie("c2")
    _wz("w1", "c2", "WZ/9/09/26", "2026-09-15", 3000.0)

    assert karta_klienta("c1")["obciazenia"] == []
    assert [o["number"] for o in karta_klienta("c2")["obciazenia"]] == ["WZ/9/09/26"]


def test_klient_bez_salda_otwarcia_jest_oznaczony(db):
    """Review Focus 2."""
    _klient()

    assert karta_klienta("c1")["saldo"]["skonfigurowane"] is False


def test_zestawienie_pomija_klientow_z_WYLACZONYM_rozliczeniem(db):
    _klient("c1", enabled=True); _otwarcie("c1")
    _klient("c2", enabled=False)

    assert [z["clientId"] for z in zestawienie()] == ["c1"]
```

- [ ] **Krok 2: Uruchom — ma paść na imporcie**

- [ ] **Krok 3: Napisz `backend/app/services/rozrachunki_service.py`**

```python
"""Rozrachunki z odbiorcami — karta kontrahenta i zestawienie zbiorcze.

Obciążenia mają DWA źródła: WZ zaciągane wprost z MES i faktury wpisywane
przez biuro (numer MES zna z formularza CMR). WM nie obciąża nigdy — to
ruch magazynowy, a nie należność; gdyby obciążał, ten sam towar liczyłby
się dwa razy.
"""
from datetime import date
from typing import Any, Dict, List, Optional

from fastapi import HTTPException

from app.db import query_all, query_one
from app.logging_config import get_logger
from app.services.rozrachunki_saldo import (TERMINY_DOMYSLNE, dni_po_terminie,
                                            po_odcieciu, policz_saldo,
                                            termin_platnosci)

logger = get_logger(__name__)


def _klient(client_id: str) -> Dict[str, Any]:
    row = query_one(
        "SELECT id, name, display_name, nip, settlement_enabled, settlement_currency "
        "FROM clients WHERE id=%s", (client_id,))
    if not row:
        raise HTTPException(404, "Kontrahent nie znaleziony")
    return row


def _obciazenia_z_wz(client_id: str) -> List[Dict[str, Any]]:
    """WZ dla klienta = należność. Seria WM odpada (ruch magazynowy),
    anulowane odpadają (nic nie wydają), niewycenione odpadają (nie ma
    czego dopisać do salda).

    ⚠️ `wz_documents` NIE MA kolumny `client_id` — jest `buyer_name`.
    Przypisanie robimy w kolejności:

      1. przez ZAMÓWIENIE (`source_type='order'` → `client_orders.client_id`)
         — jedyne pewne powiązanie,
      2. dopiero potem po NAZWIE nabywcy.

    Kolejność jest istotna: w kartotece bywają DWIE karty o tej samej nazwie
    handlowej (YALCIN rozbity 27.08.2026 na YBM Gastro i Emin Handels),
    więc dopasowanie po samej nazwie potrafi wskazać nie tę spółkę. Przy
    saldzie oznaczałoby to dług dopisany obcej firmie.

    Daty są tekstem w formacie ISO (`2026-09-24`), więc `::date` jest
    bezpieczne — ale `NULLIF(...,'')` jest obowiązkowe, bo puste pole
    wywraca rzutowanie.
    """
    return [
        {"kind": "wz", "source_id": r["id"], "number": r["number"],
         "doc_date": r["issued"], "amount": -abs(float(r["total_value"] or 0)),
         "currency": r["currency"] or "PLN", "note": ""}
        for r in query_all(
            """
            SELECT w.id, w.number, w.total_value, w.currency,
                   NULLIF(COALESCE(NULLIF(w.release_date,''),
                                   w.issued_date), '')::date AS issued
            FROM wz_documents w
            WHERE COALESCE(w.doc_series,'WZ')='WZ'
              AND COALESCE(w.status,'')<>'anulowany'
              AND w.valued IS TRUE AND COALESCE(w.total_value,0) <> 0
              AND COALESCE(
                    (SELECT o.client_id FROM client_orders o
                      WHERE w.source_type='order' AND o.id = w.source_id),
                    (SELECT c.id FROM clients c
                      WHERE c.name = w.buyer_name OR c.display_name = w.buyer_name
                      ORDER BY (c.name = w.buyer_name) DESC LIMIT 1),
                    '') = %s
            """, (client_id,))
    ]


def _obciazenia_wpisane(client_id: str) -> List[Dict[str, Any]]:
    return [dict(r) for r in query_all(
        "SELECT id, kind, source_id, number, doc_date, amount, currency, note "
        "FROM client_charges WHERE client_id=%s ORDER BY doc_date, number",
        (client_id,))]


def karta_klienta(client_id: str, na_dzien: Optional[date] = None) -> Dict[str, Any]:
    """Pełna karta rozrachunków: saldo otwarcia, obciążenia, wpłaty, saldo.

    `na_dzien` steruje WYŁĄCZNIE liczeniem dni po terminie — saldo zawsze
    jest bieżące. Domyślnie dziś.
    """
    dzien = na_dzien or date.today()
    klient = _klient(client_id)
    waluta = klient["settlement_currency"]

    otwarcie = query_one(
        "SELECT amount, currency, as_of_date, note FROM client_opening_balances "
        "WHERE client_id=%s", (client_id,))
    odciecie = otwarcie["as_of_date"] if otwarcie else None

    obciazenia = po_odcieciu(
        _obciazenia_z_wz(client_id) + _obciazenia_wpisane(client_id),
        odciecie, "doc_date")
    for o in obciazenia:
        o["termin"] = termin_platnosci(o["doc_date"], o["kind"], TERMINY_DOMYSLNE)
        o["dni_po_terminie"] = dni_po_terminie(o["termin"], dzien)
    obciazenia.sort(key=lambda o: (o["doc_date"], o.get("number") or ""))

    wplaty = po_odcieciu(
        [dict(r) for r in query_all(
            "SELECT id, paid_date, amount, currency, note FROM client_payments "
            "WHERE client_id=%s ORDER BY paid_date", (client_id,))],
        odciecie, "paid_date")

    return {
        "client": {"id": klient["id"], "name": klient["display_name"] or klient["name"],
                   "nip": klient["nip"] or ""},
        "waluta": waluta,
        "otwarcie": dict(otwarcie) if otwarcie else None,
        "obciazenia": obciazenia,
        "wplaty": wplaty,
        "saldo": policz_saldo(otwarcie, obciazenia, wplaty),
        "na_dzien": dzien,
    }


def zestawienie() -> List[Dict[str, Any]]:
    """Kto ile zalega — zastępuje arkusz PODSUMOWANIE, który u nich jest
    w całości `#REF!`."""
    out = []
    for k in query_all(
        "SELECT id FROM clients WHERE settlement_enabled IS TRUE "
        "ORDER BY COALESCE(NULLIF(display_name,''), name)"
    ):
        karta = karta_klienta(k["id"])
        out.append({"clientId": k["id"], "name": karta["client"]["name"],
                    "waluta": karta["waluta"], "saldo": karta["saldo"]["saldo"],
                    "skonfigurowane": karta["saldo"]["skonfigurowane"]})
    return out
```

- [ ] **Krok 4: Uruchom — 8 testów ma przejść**

- [ ] **Krok 5: Commit**

```bash
git add kebab_fixed/backend/app/services/rozrachunki_service.py \
        kebab_fixed/backend/tests/test_rozrachunki_service_db.py
git commit -m "feat(rozrachunki): karta kontrahenta i zestawienie zbiorcze"
```

---

### Zadanie 4: Zapis — saldo otwarcia, faktury, wpłaty

**Pliki:**
- Modify: `backend/app/services/rozrachunki_service.py`
- Test: `backend/tests/test_rozrachunki_zapis_db.py`

**Interfejsy:**
- Produces: `ustaw_otwarcie(client_id, amount, as_of_date, note="")`,
  `dodaj_fakture(client_id, number, doc_date, amount, note="")`,
  `dodaj_wplate(client_id, paid_date, amount, note="")`,
  `usun_pozycje(kind, entry_id)`.

- [ ] **Krok 1: Napisz testy**

```python
"""Zapis rozrachunków: saldo otwarcia, faktury, wpłaty."""
from datetime import date

import pytest
from fastapi import HTTPException

from app.db import execute, query_one
from app.services.rozrachunki_service import (dodaj_fakture, dodaj_wplate,
                                              karta_klienta, ustaw_otwarcie,
                                              usun_pozycje)


def _klient(cid="c1", waluta="PLN"):
    execute("INSERT INTO clients (id, code, name, settlement_enabled, "
            " settlement_currency) VALUES (%s,%s,'YALCIN',true,%s)",
            (cid, cid.upper(), waluta))
    return cid


def test_saldo_otwarcia_zapisuje_sie_w_walucie_klienta(db):
    _klient(waluta="EUR")

    ustaw_otwarcie("c1", -15649.0, date(2026, 9, 1), note="z arkusza")

    row = query_one("SELECT amount, currency, as_of_date FROM client_opening_balances "
                    "WHERE client_id='c1'")
    assert float(row["amount"]) == -15649.0
    assert row["currency"] == "EUR"


def test_ponowne_ustawienie_NADPISUJE_a_nie_dubluje(db):
    _klient()
    ustaw_otwarcie("c1", -1000.0, date(2026, 9, 1))
    ustaw_otwarcie("c1", -1200.0, date(2026, 9, 1))

    assert float(query_one("SELECT amount FROM client_opening_balances "
                           "WHERE client_id='c1'")["amount"]) == -1200.0


def test_faktura_zapisuje_sie_jako_obciazenie_ujemne(db):
    """Biuro wpisuje kwotę dodatnią („2000 zł do zapłaty"), a w saldzie
    obciążenie jest ujemne — znak nakłada serwis, nie człowiek."""
    _klient()
    ustaw_otwarcie("c1", 0.0, date(2026, 9, 1))

    dodaj_fakture("c1", "FS 12/09/2026", date(2026, 9, 15), 2000.0)

    assert karta_klienta("c1")["saldo"]["saldo"] == -2000.0


def test_DRUGA_faktura_o_tym_samym_numerze_odmawia(db):
    """Biuro wpisuje numery ręcznie — „wpisałem dwa razy" ma odbić się
    o bazę, nie o czyjeś oko."""
    _klient()
    dodaj_fakture("c1", "FS 12/09/2026", date(2026, 9, 15), 2000.0)

    with pytest.raises(HTTPException) as e:
        dodaj_fakture("c1", "FS 12/09/2026", date(2026, 9, 16), 300.0)
    assert e.value.status_code == 409


def test_wplata_zmniejsza_dlug(db):
    _klient()
    ustaw_otwarcie("c1", -1000.0, date(2026, 9, 1))

    dodaj_wplate("c1", date(2026, 9, 20), 400.0)

    assert karta_klienta("c1")["saldo"]["saldo"] == -600.0


def test_NADPLATA_daje_saldo_dodatnie(db):
    """Klient zapłacił więcej, niż był winien — to nie błąd, tylko zaliczka."""
    _klient()
    ustaw_otwarcie("c1", -100.0, date(2026, 9, 1))

    dodaj_wplate("c1", date(2026, 9, 20), 250.0)

    assert karta_klienta("c1")["saldo"]["saldo"] == 150.0


def test_usuniecie_wplaty_przywraca_saldo(db):
    _klient()
    ustaw_otwarcie("c1", -1000.0, date(2026, 9, 1))
    wplata = dodaj_wplate("c1", date(2026, 9, 20), 400.0)

    usun_pozycje("payment", wplata["id"])

    assert karta_klienta("c1")["saldo"]["saldo"] == -1000.0
```

- [ ] **Krok 2: Uruchom — ma paść na braku funkcji**

- [ ] **Krok 3: Dopisz funkcje zapisu do `rozrachunki_service.py`**

```python
from app.db import execute
from app.utils.ids import cuid


def _waluta_klienta(client_id: str) -> str:
    return _klient(client_id)["settlement_currency"]


def ustaw_otwarcie(client_id: str, amount: float, as_of_date,
                   note: str = "") -> Dict[str, Any]:
    """Saldo otwarcia — jednorazowe odcięcie przepisywane z arkusza.

    Waluta bierze się z KARTOTEKI, nie z formularza: dwa miejsca na tę samą
    decyzję to dwa miejsca, w których da się ją ustawić inaczej.
    """
    waluta = _waluta_klienta(client_id)
    execute(
        "INSERT INTO client_opening_balances (client_id, amount, currency, as_of_date, note) "
        "VALUES (%s,%s,%s,%s,%s) "
        "ON CONFLICT (client_id) DO UPDATE SET amount=EXCLUDED.amount, "
        "  currency=EXCLUDED.currency, as_of_date=EXCLUDED.as_of_date, note=EXCLUDED.note",
        (client_id, float(amount), waluta, as_of_date, note or ""))
    logger.info("rozrachunki.otwarcie", extra={"client_id": client_id})
    return {"clientId": client_id, "amount": float(amount), "currency": waluta}


def dodaj_fakture(client_id: str, number: str, doc_date, amount: float,
                  note: str = "") -> Dict[str, Any]:
    """Faktura wpisywana przez biuro. ZNAK NAKŁADA SERWIS: biuro wpisuje
    „2000", bo tyle jest do zapłaty, a w saldzie to obciążenie ujemne."""
    numer = (number or "").strip()
    if not numer:
        raise HTTPException(400, "Podaj numer faktury")
    if query_one("SELECT 1 FROM client_charges WHERE client_id=%s AND kind='invoice' "
                 "AND number=%s", (client_id, numer)):
        raise HTTPException(409, f"Faktura {numer} jest już zapisana")
    cid = cuid()
    execute(
        "INSERT INTO client_charges (id, client_id, kind, number, doc_date, amount, "
        " currency, note) VALUES (%s,%s,'invoice',%s,%s,%s,%s,%s)",
        (cid, client_id, numer, doc_date, -abs(float(amount)),
         _waluta_klienta(client_id), note or ""))
    logger.info("rozrachunki.faktura", extra={"client_id": client_id, "numer": numer})
    return {"id": cid, "number": numer}


def dodaj_wplate(client_id: str, paid_date, amount: float,
                 note: str = "") -> Dict[str, Any]:
    """Wpłata idzie na WSPÓLNE saldo klienta, nie do konkretnego dokumentu —
    decyzja właściciela, zgodna z tym, jak działa ich arkusz."""
    cid = cuid()
    execute(
        "INSERT INTO client_payments (id, client_id, paid_date, amount, currency, note) "
        "VALUES (%s,%s,%s,%s,%s,%s)",
        (cid, client_id, paid_date, -abs(float(amount)),
         _waluta_klienta(client_id), note or ""))
    logger.info("rozrachunki.wplata", extra={"client_id": client_id})
    return {"id": cid}


def usun_pozycje(kind: str, entry_id: str) -> Dict[str, Any]:
    """Usuwanie wpisanej ręcznie pozycji. Obciążeń z WZ nie da się usunąć —
    znikają, gdy zniknie albo zostanie anulowany sam dokument."""
    tabela = {"invoice": "client_charges", "payment": "client_payments"}.get(kind)
    if not tabela:
        raise HTTPException(400, f"Nieznany rodzaj pozycji: {kind}")
    execute(f"DELETE FROM {tabela} WHERE id=%s", (entry_id,))
    return {"ok": True}
```

Uwaga do Review Focus 3: wpłata i faktura BIORĄ walutę z kartoteki klienta,
więc „wpłata w innej walucie" nie ma jak powstać — pole waluty nie istnieje
w formularzu. To mocniejsze niż walidacja.

- [ ] **Krok 4: Uruchom — 7 testów ma przejść**

- [ ] **Krok 5: Commit**

```bash
git add kebab_fixed/backend/app/services/rozrachunki_service.py \
        kebab_fixed/backend/tests/test_rozrachunki_zapis_db.py
git commit -m "feat(rozrachunki): zapis salda otwarcia, faktur i wplat"
```

---

### Zadanie 5: Trasy HTTP

**Pliki:**
- Create: `backend/app/routes/rozrachunki.py`
- Modify: `backend/app/routes/clients.py` (endpoint ustawień rozliczenia)
- Test: `backend/tests/test_rozrachunki_routes_db.py`

**Interfejsy:**
- Produces: `GET /api/rozrachunki` (zestawienie),
  `GET /api/rozrachunki/{client_id}` (karta),
  `POST /api/rozrachunki/{client_id}/otwarcie`,
  `POST /api/rozrachunki/{client_id}/faktura`,
  `POST /api/rozrachunki/{client_id}/wplata`,
  `DELETE /api/rozrachunki/pozycja/{kind}/{entry_id}`,
  `PUT /api/clients/{client_id}/rozliczenie`.

- [ ] **Krok 1: Test tras**

```python
"""Trasy rozrachunków — kontrakt HTTP."""
from datetime import date

from app.db import execute
from app.routes import rozrachunki as route


def _klient(cid="c1"):
    execute("INSERT INTO clients (id, code, name, settlement_enabled) "
            "VALUES (%s,%s,'YALCIN',true)", (cid, cid.upper()))


def test_karta_oddaje_saldo_i_walute(db):
    _klient()
    route.ustaw_otwarcie_klienta("c1", {"amount": -1000, "as_of_date": "2026-09-01"})

    karta = route.karta("c1")

    assert karta["waluta"] == "PLN"
    assert karta["saldo"]["saldo"] == -1000.0


def test_zestawienie_oddaje_liste(db):
    _klient()
    assert [z["clientId"] for z in route.lista()] == ["c1"]


def test_dodanie_faktury_przez_trase(db):
    _klient()
    route.ustaw_otwarcie_klienta("c1", {"amount": 0, "as_of_date": "2026-09-01"})

    route.faktura("c1", {"number": "FS 1/2026", "doc_date": "2026-09-15",
                         "amount": 500})

    assert route.karta("c1")["saldo"]["saldo"] == -500.0
```

- [ ] **Krok 2: Uruchom — ma paść na imporcie**

- [ ] **Krok 3: Napisz `backend/app/routes/rozrachunki.py`**

```python
"""Rozrachunki z odbiorcami — karta kontrahenta, zestawienie, zapisy."""
from datetime import date

from fastapi import APIRouter, Query

from app.services import rozrachunki_service as svc

router = APIRouter(prefix="/api/rozrachunki", tags=["rozrachunki"])


def _data(wartosc, domyslna=None):
    return date.fromisoformat(wartosc) if wartosc else domyslna


@router.get("")
def lista():
    """Kto ile zalega — zastępuje arkusz PODSUMOWANIE."""
    return svc.zestawienie()


@router.get("/{client_id}")
def karta(client_id: str, na_dzien: str = Query("")):
    return svc.karta_klienta(client_id, _data(na_dzien))


@router.post("/{client_id}/otwarcie")
def ustaw_otwarcie_klienta(client_id: str, body: dict):
    return svc.ustaw_otwarcie(
        client_id, float(body.get("amount") or 0),
        _data(body.get("as_of_date"), date.today()), body.get("note") or "")


@router.post("/{client_id}/faktura")
def faktura(client_id: str, body: dict):
    return svc.dodaj_fakture(
        client_id, body.get("number") or "",
        _data(body.get("doc_date"), date.today()),
        float(body.get("amount") or 0), body.get("note") or "")


@router.post("/{client_id}/wplata")
def wplata(client_id: str, body: dict):
    return svc.dodaj_wplate(
        client_id, _data(body.get("paid_date"), date.today()),
        float(body.get("amount") or 0), body.get("note") or "")


@router.delete("/pozycja/{kind}/{entry_id}")
def usun(kind: str, entry_id: str):
    return svc.usun_pozycje(kind, entry_id)
```

- [ ] **Krok 4: Dopisz trasę ustawień do `backend/app/routes/clients.py`**

```python
@router.put("/{client_id}/rozliczenie")
def ustaw_rozliczenie(client_id: str, body: dict):
    """Włącznik rozrachunków i waluta rozliczeniowa kontrahenta."""
    return svc.ustaw_rozliczenie(
        client_id, bool(body.get("enabled")), body.get("currency") or "PLN")
```

- [ ] **Krok 5: Uruchom — 3 testy mają przejść**

- [ ] **Krok 6: Commit**

```bash
git add kebab_fixed/backend/app/routes/rozrachunki.py \
        kebab_fixed/backend/app/routes/clients.py \
        kebab_fixed/backend/tests/test_rozrachunki_routes_db.py
git commit -m "feat(rozrachunki): trasy HTTP"
```

---

### Zadanie 6: Klient API i widok listy (front)

**Pliki:**
- Modify: `src/lib/api.ts` (po `export const clientGroupsApi`)
- Create: `src/features/rozrachunki/rozrachunkiView.ts`
- Test: `src/features/rozrachunki/rozrachunkiView.test.ts`

**Interfejsy:**
- Produces: `rozrachunkiApi` (`lista`, `karta`, `otwarcie`, `faktura`,
  `wplata`, `usunPozycje`), `clientsApi.ustawRozliczenie`;
  `fmtSaldo(kwota, waluta) -> string`, `stanSalda(saldo) -> 'dlug'|'zero'|'nadplata'`,
  `sumaZaleglosci(zestawienie, kurs) -> number`.

- [ ] **Krok 1: Testy widoku**

```typescript
import { describe, it, expect } from 'vitest'

import { fmtSaldo, stanSalda, sumaZaleglosci } from './rozrachunkiView'

describe('prezentacja salda', () => {
  it('dług pokazuje się jako kwota ujemna w walucie klienta', () => {
    expect(fmtSaldo(-15649, 'EUR')).toBe('-15 649,00 €')
  })

  it('złotówki mają swój symbol', () => {
    expect(fmtSaldo(-1000, 'PLN')).toBe('-1 000,00 zł')
  })

  it('rozróżnia dług, zero i nadpłatę', () => {
    // Nadpłata to zaliczka, nie błąd — ekran nie może jej pokazywać
    // na czerwono jak zaległości.
    expect(stanSalda(-100)).toBe('dlug')
    expect(stanSalda(0)).toBe('zero')
    expect(stanSalda(250)).toBe('nadplata')
  })

  it('grosze nie robią z zera długu', () => {
    expect(stanSalda(-0.004)).toBe('zero')
  })

  it('suma zaległości przelicza euro kursem, złotówki bierze wprost', () => {
    const suma = sumaZaleglosci(
      [{ saldo: -1000, waluta: 'PLN' }, { saldo: -100, waluta: 'EUR' }], 4.2668)
    expect(suma).toBeCloseTo(-1426.68, 2)
  })

  it('nadpłaty NIE pomniejszają sumy zaległości', () => {
    // Zaliczka jednego klienta nie zmniejsza długu innego — sumujemy
    // wyłącznie to, co ktoś jest winien.
    const suma = sumaZaleglosci(
      [{ saldo: -1000, waluta: 'PLN' }, { saldo: 500, waluta: 'PLN' }], 4.2668)
    expect(suma).toBeCloseTo(-1000, 2)
  })
})
```

- [ ] **Krok 2: Uruchom — ma paść na imporcie**

Run: `npx vitest run src/features/rozrachunki/rozrachunkiView.test.ts`

- [ ] **Krok 3: Napisz `src/features/rozrachunki/rozrachunkiView.ts`**

```typescript
/**
 * Prezentacja rozrachunków — czyste funkcje, zero Reacta.
 *
 * ZNAK: ujemne = klient jest nam winien (jak w arkuszu biura).
 */
export type StanSalda = 'dlug' | 'zero' | 'nadplata'

const SYMBOL: Record<string, string> = { PLN: 'zł', EUR: '€' }

/** Próg groszowy — zaokrąglenia nie mogą robić z zera długu. */
const GROSZ = 0.005

export function fmtSaldo(kwota: number, waluta: string): string {
  const liczba = new Intl.NumberFormat('pl-PL', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(kwota)
  return `${liczba} ${SYMBOL[waluta] ?? waluta}`
}

export function stanSalda(saldo: number): StanSalda {
  if (saldo < -GROSZ) return 'dlug'
  if (saldo > GROSZ) return 'nadplata'
  return 'zero'
}

/** Suma zaległości w złotówkach. Nadpłaty pomijamy: zaliczka jednego
 *  klienta nie zmniejsza długu innego. */
export function sumaZaleglosci(
  wiersze: { saldo: number; waluta: string }[], kurs: number,
): number {
  return wiersze
    .filter(w => stanSalda(w.saldo) === 'dlug')
    .reduce((s, w) => s + (w.waluta === 'EUR' ? w.saldo * kurs : w.saldo), 0)
}
```

- [ ] **Krok 4: Uruchom — 6 testów ma przejść**

- [ ] **Krok 5: Dopisz `rozrachunkiApi` do `src/lib/api.ts`** (zaraz po `clientGroupsApi`)

```typescript
export interface RozrachunkiPozycja {
  id?: string; kind: string; number: string; doc_date: string
  amount: number; termin?: string; dni_po_terminie?: number
}
export interface RozrachunkiKarta {
  client: { id: string; name: string; nip: string }
  waluta: string
  otwarcie: { amount: number; as_of_date: string; note: string } | null
  obciazenia: RozrachunkiPozycja[]
  wplaty: { id: string; paid_date: string; amount: number; note: string }[]
  saldo: { otwarcie: number; obciazenia: number; wplaty: number
           saldo: number; skonfigurowane: boolean }
  na_dzien: string
}

export const rozrachunkiApi = {
  lista:  () => get<{ clientId: string; name: string; waluta: string
                      saldo: number; skonfigurowane: boolean }[]>('/rozrachunki'),
  karta:  (id: string) => get<RozrachunkiKarta>(`/rozrachunki/${id}`),
  otwarcie: (id: string, dto: { amount: number; as_of_date: string; note?: string }) =>
    post<any>(`/rozrachunki/${id}/otwarcie`, dto),
  faktura: (id: string, dto: { number: string; doc_date: string; amount: number; note?: string }) =>
    post<any>(`/rozrachunki/${id}/faktura`, dto),
  wplata: (id: string, dto: { paid_date: string; amount: number; note?: string }) =>
    post<any>(`/rozrachunki/${id}/wplata`, dto),
  usunPozycje: (kind: string, entryId: string) =>
    del<{ ok: boolean }>(`/rozrachunki/pozycja/${kind}/${entryId}`),
}
```

Oraz do `clientsApi`:

```typescript
  ustawRozliczenie: (id: string, enabled: boolean, currency: string) =>
    put<any>(`/clients/${id}/rozliczenie`, { enabled, currency }),
```

- [ ] **Krok 6: `npx tsc --noEmit` — bez błędów**

- [ ] **Krok 7: Commit**

```bash
git add kebab_fixed/src/lib/api.ts \
        kebab_fixed/src/features/rozrachunki/rozrachunkiView.ts \
        kebab_fixed/src/features/rozrachunki/rozrachunkiView.test.ts
git commit -m "feat(rozrachunki): klient API i prezentacja salda"
```

---

### Zadanie 7: Ekran rozrachunków

**Pliki:**
- Create: `src/pages/office/RozrachunkiPage.tsx`
- Create: `src/features/rozrachunki/KartaRozrachunkow.tsx`
- Test: `src/features/rozrachunki/kartaRozrachunkow.test.tsx`
- Modify: `src/App.tsx` (trasa `/office/rozrachunki`)
- Modify: `src/layouts/OfficeSidebar.tsx` (pozycja menu pod „Kontrahenci")

**Interfejsy:**
- Consumes: `rozrachunkiApi`, `fmtSaldo`, `stanSalda`, `sumaZaleglosci`

- [ ] **Krok 1: Test karty**

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

const stan = vi.hoisted(() => ({ karta: null as any }))
vi.mock('@/lib/api', () => ({
  rozrachunkiApi: {
    karta: () => Promise.resolve(stan.karta),
    otwarcie: () => Promise.resolve({}),
    faktura: () => Promise.resolve({}),
    wplata: () => Promise.resolve({}),
    usunPozycje: () => Promise.resolve({ ok: true }),
  },
}))

import { KartaRozrachunkow } from './KartaRozrachunkow'

const KARTA = {
  client: { id: 'c1', name: 'YBM GASTRO', nip: '123' },
  waluta: 'EUR',
  otwarcie: { amount: -15649, as_of_date: '2026-09-01', note: '' },
  obciazenia: [{ kind: 'wz', number: 'WZ/9/09/26', doc_date: '2026-09-15',
                 amount: -3000, termin: '2026-09-16', dni_po_terminie: 4 }],
  wplaty: [{ id: 'p1', paid_date: '2026-09-20', amount: -500, note: '2850 28.07' }],
  saldo: { otwarcie: -15649, obciazenia: -3000, wplaty: -500,
           saldo: -18149, skonfigurowane: true },
  na_dzien: '2026-09-20',
}

beforeEach(() => { stan.karta = KARTA })
afterEach(cleanup)

describe('karta rozrachunków', () => {
  it('pokazuje saldo w walucie klienta', async () => {
    render(<KartaRozrachunkow clientId="c1" />)
    expect(await screen.findByText(/-18 149,00 €/)).toBeTruthy()
  })

  it('pokazuje datę odcięcia, żeby nikt nie szukał starszych dokumentów', async () => {
    render(<KartaRozrachunkow clientId="c1" />)
    expect(await screen.findByText(/na dzień 01\.09\.2026/i)).toBeTruthy()
  })

  it('wyróżnia pozycje po terminie', async () => {
    const { container } = render(<KartaRozrachunkow clientId="c1" />)
    await screen.findByText('WZ/9/09/26')
    expect(container.querySelector('[data-po-terminie="4"]')).toBeTruthy()
  })

  it('bez salda otwarcia mówi WPROST, że trzeba je wpisać', async () => {
    stan.karta = { ...KARTA, otwarcie: null,
                   saldo: { ...KARTA.saldo, skonfigurowane: false } }
    render(<KartaRozrachunkow clientId="c1" />)
    expect(await screen.findByText(/wpisz saldo otwarcia/i)).toBeTruthy()
  })
})
```

- [ ] **Krok 2: Uruchom — ma paść na imporcie**

- [ ] **Krok 3: Napisz `KartaRozrachunkow.tsx`**

Nagłówek z saldem (`fmtSaldo`, kolor wg `stanSalda`), pod nim „saldo na dzień
DD.MM.RRRR" z `otwarcie.as_of_date`. Dwie tabele — **Obciążenia** (data,
numer, kwota, termin, dni po terminie w atrybucie `data-po-terminie`)
i **Wpłaty** (data, kwota, uwaga). Gdy `saldo.skonfigurowane === false`,
zamiast liczby: „Wpisz saldo otwarcia — bez niego rozrachunki nie mają od
czego liczyć". Formularze: saldo otwarcia, dodaj fakturę, dodaj wpłatę;
kwoty wpisywane DODATNIO, znak nakłada backend.

- [ ] **Krok 4: Uruchom — 4 testy mają przejść**

- [ ] **Krok 5: Napisz `RozrachunkiPage.tsx`** — lista z `rozrachunkiApi.lista()`,
      suma zaległości przez `sumaZaleglosci` z kursem z pola nad tabelą,
      klik wiersza otwiera `KartaRozrachunkow`.

- [ ] **Krok 6: Dopisz trasę i menu**

W `src/App.tsx`, obok pozostałych tras `office`:

```tsx
        <Route path="rozrachunki" element={<RozrachunkiPage />} />
```

W `src/layouts/OfficeSidebar.tsx`, w sekcji `Kontrahenci`, po „Wydania":

```tsx
    { to: '/office/rozrachunki', label: 'Rozrachunki', icon: <CreditCard size={16} /> },
```

- [ ] **Krok 7: `npx tsc --noEmit` i `npx vitest run` — zielone**

- [ ] **Krok 8: Commit**

```bash
git add kebab_fixed/src/pages/office/RozrachunkiPage.tsx \
        kebab_fixed/src/features/rozrachunki/KartaRozrachunkow.tsx \
        kebab_fixed/src/features/rozrachunki/kartaRozrachunkow.test.tsx \
        kebab_fixed/src/App.tsx kebab_fixed/src/layouts/OfficeSidebar.tsx
git commit -m "feat(rozrachunki): ekran karty i zestawienia"
```

---

### Zadanie 8: Saldo na dokumencie i zestawienie do druku

**Pliki:**
- Modify: `backend/app/services/rozrachunki_service.py` (`saldo_na_dokument`)
- Create: `src/pages/office/RozrachunkiDrukPage.tsx`
- Modify: `src/components/wz/WzDocumentView.tsx` (blok salda)
- Test: `backend/tests/test_rozrachunki_na_dokumencie_db.py`
- Modify: `src/App.tsx` (trasa `/office/rozrachunki/:id/druk`)

**Interfejsy:**
- Produces: `saldo_na_dokument(client_id, wz_id) -> Dict` z kluczami
  `pozycje`, `saldo_przed`, `saldo_po`, `dokument_biezacy`, `policzono`.

- [ ] **Krok 1: Testy**

```python
"""Saldo drukowane NA dokumencie.

Właściciel 24.09.2026: „do każdej WZ i do faktury drukowało się saldo
niezapłaconych FV lub WZ; będę podpinał klientowi do dokumentów".
"""
from datetime import date

from app.db import execute
from app.services.rozrachunki_service import saldo_na_dokument


def _klient(cid="c1"):
    execute("INSERT INTO clients (id, code, name, settlement_enabled) "
            "VALUES (%s,%s,'YALCIN',true)", (cid, cid.upper()))
    execute("INSERT INTO client_opening_balances (client_id, amount, currency, as_of_date) "
            "VALUES (%s,0,'PLN','2026-09-01')", (cid,))


def _wz(wid, cid, numer, data, wartosc):
    execute(
        "INSERT INTO wz_documents (id, number, seq, year_month, buyer_name, lines, "
        " total_value, valued, status, doc_series, currency, client_id, issued_date) "
        "VALUES (%s,%s,1,'2609','YALCIN','[]'::jsonb,%s,true,'wstepny','WZ','PLN',%s,%s)",
        (wid, numer, wartosc, cid, data))


def test_dokument_biezacy_NIE_liczy_sie_jako_zaleglosc(db):
    """Review Focus 5. Klient dostaje WZ i widzi je w „niezapłaconych"
    tego samego papieru — to wygląda na pomyłkę biura."""
    _klient()
    _wz("w1", "c1", "WZ/1/09/26", "2026-09-10", 1000.0)
    _wz("w2", "c1", "WZ/2/09/26", "2026-09-15", 3000.0)

    blok = saldo_na_dokument("c1", "w2")

    assert [p["number"] for p in blok["pozycje"]] == ["WZ/1/09/26"]
    assert blok["dokument_biezacy"]["number"] == "WZ/2/09/26"


def test_saldo_przed_i_po_tym_dokumencie(db):
    _klient()
    _wz("w1", "c1", "WZ/1/09/26", "2026-09-10", 1000.0)
    _wz("w2", "c1", "WZ/2/09/26", "2026-09-15", 3000.0)

    blok = saldo_na_dokument("c1", "w2")

    assert blok["saldo_przed"] == -1000.0
    assert blok["saldo_po"] == -4000.0


def test_blok_niesie_CHWILE_policzenia(db):
    """Dokument drukowany ponownie za tydzień pokaże inne saldo — i tak ma
    być. Bez daty na papierze dwa wydruki tego samego WZ pokazują różne
    kwoty i nikt nie wie, który jest aktualny."""
    _klient()
    _wz("w1", "c1", "WZ/1/09/26", "2026-09-10", 1000.0)

    assert saldo_na_dokument("c1", "w1")["policzono"] is not None
```

- [ ] **Krok 2: Uruchom — ma paść**

- [ ] **Krok 3: Dopisz `saldo_na_dokument` do `rozrachunki_service.py`**

```python
from datetime import datetime


def saldo_na_dokument(client_id: str, wz_id: str) -> Dict[str, Any]:
    """Blok „niezapłacone" drukowany NA dokumencie wydania.

    SALDO JEST Z CHWILI WYDRUKU, nie z chwili wystawienia — dlatego nie
    zapisujemy go w treści dokumentu, tylko liczymy przy renderowaniu
    i drukujemy obok datę z godziną. Bez tej daty dwa wydruki tego samego
    WZ pokazują różne kwoty i nikt nie wie, który jest aktualny.

    DOKUMENT BIEŻĄCY NIE LICZY SIĘ SAM DO SIEBIE jako zaległość — klient
    dostawałby WZ i widział je w „niezapłaconych" tego samego papieru.
    Pokazujemy go osobno, a saldo w dwóch liczbach: przed i po nim.
    """
    karta = karta_klienta(client_id)
    biezacy = next((o for o in karta["obciazenia"] if o.get("source_id") == wz_id), None)
    pozostale = [o for o in karta["obciazenia"] if o.get("source_id") != wz_id]

    saldo_przed = policz_saldo(karta["otwarcie"], pozostale, karta["wplaty"])["saldo"]
    kwota_biezaca = float(biezacy["amount"]) if biezacy else 0.0
    return {
        "waluta": karta["waluta"],
        "pozycje": pozostale,
        "dokument_biezacy": biezacy,
        "saldo_przed": saldo_przed,
        "saldo_po": round(saldo_przed + kwota_biezaca, 2),
        "policzono": datetime.now().isoformat(timespec="minutes"),
    }
```

- [ ] **Krok 4: Dopisz trasę w `backend/app/routes/rozrachunki.py`**

```python
@router.get("/{client_id}/na-dokumencie/{wz_id}")
def na_dokumencie(client_id: str, wz_id: str):
    return svc.saldo_na_dokument(client_id, wz_id)
```

- [ ] **Krok 5: Uruchom testy — 3 mają przejść**

- [ ] **Krok 6: Blok salda na wydruku WZ**

W `src/components/wz/WzDocumentView.tsx`, pod pozycjami dokumentu: sekcja
„Niezapłacone dokumenty" (data, numer, kwota, dni po terminie), pod nią
„Saldo przed tym dokumentem" i „Saldo po tym dokumencie", a w stopce
`Policzono: DD.MM.RRRR HH:MM`. Sekcja pokazuje się TYLKO, gdy klient ma
włączone rozliczenie i saldo otwarcia.

- [ ] **Krok 7: Zestawienie do druku — `RozrachunkiDrukPage.tsx`**

Strona aplikacji pod `/office/rozrachunki/:id/druk` (NIE `window.open` —
w Tauri okna i skrypty inline nie działają). Nagłówek z danymi kontrahenta,
tabela niezapłaconych (data, numer, kwota, dni po terminie), saldo razem,
data sporządzenia. Ma mieścić się na jednej A4 przy typowej liczbie pozycji.
Trasa w `src/App.tsx`.

- [ ] **Krok 8: Pełne przebiegi**

```bash
cd backend && TEST_DATABASE_URL=postgresql://postgres:p@localhost:55437/kebab_mes_test pytest -q
cd .. && npx tsc --noEmit && npx vitest run
```

- [ ] **Krok 9: Commit**

```bash
git add kebab_fixed/backend/app/services/rozrachunki_service.py \
        kebab_fixed/backend/app/routes/rozrachunki.py \
        kebab_fixed/backend/tests/test_rozrachunki_na_dokumencie_db.py \
        kebab_fixed/src/components/wz/WzDocumentView.tsx \
        kebab_fixed/src/pages/office/RozrachunkiDrukPage.tsx \
        kebab_fixed/src/App.tsx
git commit -m "feat(rozrachunki): saldo na dokumencie i zestawienie do druku"
```

---

## Po wykonaniu

1. Pełny backend + front zielone.
2. `git push origin main`, poczekać na CI.
3. **Próba generalna** na kopii bazy zakładu:
   `KEBAB_KOD=/opt/kebab/kebab_new/kebab_fixed/backend deploy/proba_generalna.sh`
4. `deploy/deploy.sh`, potem `deploy/smoke.sh`.
5. **Weryfikacja na żywych danych:** `karta_klienta` dla YBM GASTRO —
   czy saldo zgadza się z arkuszem po wpisaniu salda otwarcia.
6. Wydanie desktopu (bump TRZECH plików), bo zmiana jest we froncie.
