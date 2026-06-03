# Pakowanie po kliencie (Część A) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pakować do palety każdą sztukę `produced` pasującą klientem + produkt + receptura + waga (zamiast po `order_id`), z sentinelem magazynowym „na magazyn" jako wildcard, i alokować sztukę do zamówienia palety przy spakowaniu.

**Architecture:** Zmiana czystej funkcji walidacji (`order_id` → reguła klienta z normalizacją i sentinelami magazynowymi) + serwis pobiera klienta palety i przy spakowaniu uzupełnia `order_id`/`client_name` sztuki. Bez zmian schematu DB i frontu.

**Tech Stack:** Backend FastAPI + psycopg (PostgreSQL), pytest.

**Spec:** `docs/superpowers/specs/2026-06-03-pakowanie-po-kliencie-design.md`

---

## File Structure

- `backend/app/utils/unit_codes.py` — modyfikacja: sentinele magazynowe + `_is_stock`/`_client_matches`; zmiana sygnatury i reguły w `validate_pack_to_pallet`.
- `backend/tests/test_pack_to_pallet.py` — modyfikacja: testy reguły klienta (zastępują test `order_id`).
- `backend/app/services/pallets_service.py` — modyfikacja: `_pallet_pack_state` zwraca klienta palety; `pack_unit_into_pallet` woła nową sygnaturę i alokuje sztukę.

---

## Task 1: Reguła klienta w czystej walidacji (TDD)

**Files:**
- Modify: `backend/app/utils/unit_codes.py`
- Test: `backend/tests/test_pack_to_pallet.py`

- [ ] **Step 1: Zaktualizuj testy (red)**

Zastąp ZAWARTOŚĆ `backend/tests/test_pack_to_pallet.py` poniższym (zmienia sygnaturę na `pallet_client`, dodaje pole `client` do `_unit`, usuwa `test_different_order`):

```python
from app.utils.unit_codes import validate_pack_to_pallet, pallet_line_key

P1R1_40 = ("P1", "R1", 40.0)


def _unit(status="produced", client="Zagros", pt="P1", rc="R1", w=40, batch_no="B1"):
    return {"status": status, "client_name": client,
            "product_type_id": pt, "recipe_id": rc, "weight_kg": w, "batch_no": batch_no}


def test_same_client_ok():
    ok, reason, key = validate_pack_to_pallet(
        _unit(client="Zagros"), pallet_client="Zagros",
        planned_by_key={P1R1_40: 20}, packed_by_key={P1R1_40: 5})
    assert ok is True and reason == "" and key == P1R1_40


def test_stock_unit_wildcard_ok():
    for c in ("na magazyn", "", "STAN", "MAGAZYN"):
        ok, reason, _ = validate_pack_to_pallet(
            _unit(client=c), pallet_client="Zagros",
            planned_by_key={P1R1_40: 20}, packed_by_key={})
        assert ok is True, f"stock client {c!r} powinien wejść"


def test_stock_pallet_accepts_any():
    ok, reason, _ = validate_pack_to_pallet(
        _unit(client="Zagros"), pallet_client="na magazyn",
        planned_by_key={P1R1_40: 20}, packed_by_key={})
    assert ok is True


def test_client_match_case_insensitive():
    ok, _, _ = validate_pack_to_pallet(
        _unit(client="zagros "), pallet_client="Zagros",
        planned_by_key={P1R1_40: 20}, packed_by_key={})
    assert ok is True


def test_different_client_rejected():
    ok, reason, _ = validate_pack_to_pallet(
        _unit(client="Kowalski"), pallet_client="Zagros",
        planned_by_key={P1R1_40: 20}, packed_by_key={})
    assert ok is False and "klient" in reason.lower()


def test_wrong_product_or_weight():
    ok, reason, _ = validate_pack_to_pallet(
        _unit(w=30), pallet_client="Zagros",
        planned_by_key={P1R1_40: 20}, packed_by_key={})
    assert ok is False and ("produkt" in reason.lower() or "waga" in reason.lower())


def test_not_produced():
    ok, reason, _ = validate_pack_to_pallet(
        _unit(status="planned"), pallet_client="Zagros",
        planned_by_key={P1R1_40: 20}, packed_by_key={})
    assert ok is False and "produkcj" in reason.lower()


def test_already_packed():
    ok, reason, _ = validate_pack_to_pallet(
        _unit(status="packed"), pallet_client="Zagros",
        planned_by_key={P1R1_40: 20}, packed_by_key={})
    assert ok is False and "spakowan" in reason.lower()


def test_position_full():
    ok, reason, _ = validate_pack_to_pallet(
        _unit(), pallet_client="Zagros",
        planned_by_key={P1R1_40: 20}, packed_by_key={P1R1_40: 20})
    assert ok is False and ("pełna" in reason.lower() or "pelna" in reason.lower())


def test_different_batches_allowed():
    plan = {P1R1_40: 20}
    ok1, _, k1 = validate_pack_to_pallet(
        _unit(batch_no="B1"), pallet_client="Zagros", planned_by_key=plan, packed_by_key={P1R1_40: 0})
    ok2, _, k2 = validate_pack_to_pallet(
        _unit(batch_no="B2"), pallet_client="Zagros", planned_by_key=plan, packed_by_key={P1R1_40: 1})
    assert ok1 is True and ok2 is True and k1 == k2


def test_combine_stock_and_fresh():
    # główny scenariusz: 5 ze stanu (na magazyn) + nowa sztuka klienta Zagros do palety Zagros
    plan = {P1R1_40: 40}
    ok_stock, _, _ = validate_pack_to_pallet(
        _unit(client="na magazyn"), pallet_client="Zagros", planned_by_key=plan, packed_by_key={P1R1_40: 0})
    ok_fresh, _, _ = validate_pack_to_pallet(
        _unit(client="Zagros"), pallet_client="Zagros", planned_by_key=plan, packed_by_key={P1R1_40: 1})
    assert ok_stock is True and ok_fresh is True


def test_pallet_line_key_rounds_weight():
    assert pallet_line_key("P1", "R1", 40.0001) == ("P1", "R1", 40.0)
```

- [ ] **Step 2: Uruchom — ma FAIL**

Run: `cd /opt/kebab/kebab_new/kebab_fixed/backend && python3 -m pytest tests/test_pack_to_pallet.py -v`
Expected: FAIL — `validate_pack_to_pallet` woła ze starym parametrem `pallet_order_id`; testy podają `pallet_client` i klientów, więc asercje klienta nie przejdą (np. `test_different_client_rejected`, `test_stock_unit_wildcard_ok`).

- [ ] **Step 3: Implementacja w `unit_codes.py`**

Dodaj NAD `validate_pack_to_pallet` pomocnicze stałe i predykaty:

```python
# Klienci „magazynowi" — produkcja bez konkretnego odbiorcy. Wildcard przy pakowaniu.
# Kanoniczny: "na magazyn". "stan"/"magazyn" — legacy. "" — brak klienta.
_STOCK_CLIENTS = {"", "na magazyn", "magazyn", "stan"}


def _is_stock(client) -> bool:
    return (client or "").strip().lower() in _STOCK_CLIENTS


def _client_matches(unit_client, pallet_client) -> bool:
    """Klient sztuki pasuje do klienta palety (magazynowy = wildcard, bez wielkości liter)."""
    if _is_stock(unit_client) or _is_stock(pallet_client):
        return True
    return (unit_client or "").strip().lower() == (pallet_client or "").strip().lower()
```

Zmień sygnaturę i ciało `validate_pack_to_pallet` — `pallet_order_id` → `pallet_client`,
a blok `order_id` zastąp regułą klienta:

```python
def validate_pack_to_pallet(unit: Dict, pallet_client: Optional[str], planned_by_key: Dict, packed_by_key: Dict) -> Tuple[bool, str, Optional[tuple]]:
    """Czysta walidacja pakowania sztuki do palety.

    unit: dict {status, client_name, product_type_id, recipe_id, weight_kg}
    pallet_client: nazwa klienta palety (z zamówienia)
    planned_by_key: {pallet_line_key: planowana liczba szt}
    packed_by_key:  {pallet_line_key: już spakowane szt}
    Zwraca (ok: bool, reason: str, key | None).
    Partia (batch_no) ani order_id NIE są kryterium. Klient „na magazyn" = wildcard.
    """
    status = unit.get("status")
    if status != PRODUCED:
        if status == PACKED:
            return False, "Sztuka już spakowana", None
        return False, "Sztuka nie potwierdzona na produkcji", None

    if not _client_matches(unit.get("client_name"), pallet_client):
        return False, "Inny klient niż na palecie", None

    key = pallet_line_key(
        unit.get("product_type_id"), unit.get("recipe_id"), unit.get("weight_kg"))
    if key not in planned_by_key:
        return False, "Inny produkt/waga niż na palecie", None

    if int(packed_by_key.get(key) or 0) >= int(planned_by_key.get(key) or 0):
        return False, "Pozycja palety pełna", None

    return True, "", key
```

- [ ] **Step 4: Uruchom — ma PASS (oraz reszta testów)**

Run: `cd /opt/kebab/kebab_new/kebab_fixed/backend && python3 -m pytest tests/test_pack_to_pallet.py tests/test_unit_codes.py -v`
Expected: PASS (wszystkie; `validate_pack` i jego testy nietknięte).

- [ ] **Step 5: Commit**

```bash
cd /opt/kebab/kebab_new/kebab_fixed && git add backend/app/utils/unit_codes.py backend/tests/test_pack_to_pallet.py && \
git commit -m "feat(pack): pakowanie po kliencie (na magazyn = wildcard) zamiast po order_id"
```

---

## Task 2: Serwis — klient palety + alokacja sztuki przy spakowaniu

**Files:**
- Modify: `backend/app/services/pallets_service.py`

- [ ] **Step 1: `_pallet_pack_state` zwraca klienta palety**

W `backend/app/services/pallets_service.py`, w funkcji `_pallet_pack_state`, zaraz po
ustaleniu `order_id = pallet["order_id"]`, dodaj pobranie klienta zamówienia i rozszerz
wartość zwracaną. Zmień nagłówek/return:

```python
def _pallet_pack_state(conn, pallet_id):
    """Zwróć (pallet_row, order_id, pallet_client, planned_by_key, packed_by_key)."""
    pallet = cx_query_one(
        conn, "SELECT * FROM order_pallets WHERE id=%s FOR UPDATE", (pallet_id,))
    if not pallet:
        raise HTTPException(404, "Paleta nie znaleziona")
    order_id = pallet["order_id"]
    order = cx_query_one(
        conn, "SELECT client_name FROM client_orders WHERE id=%s", (order_id,))
    pallet_client = (order or {}).get("client_name") or ""
```

(reszta funkcji — budowa `planned_by_key`/`packed_by_key` — bez zmian) oraz zmień
ostatnią linię z:
```python
    return pallet, order_id, planned_by_key, packed_by_key
```
na:
```python
    return pallet, order_id, pallet_client, planned_by_key, packed_by_key
```

- [ ] **Step 2: `pack_unit_into_pallet` — nowa sygnatura walidacji + alokacja**

W `pack_unit_into_pallet` zmień rozpakowanie krotki i wywołanie walidacji, oraz UPDATE
sztuki tak, by alokował ją do zamówienia/klienta palety:

Zmień:
```python
        pallet, order_id, planned_by_key, packed_by_key = _pallet_pack_state(conn, pallet_id)
```
na:
```python
        pallet, order_id, pallet_client, planned_by_key, packed_by_key = _pallet_pack_state(conn, pallet_id)
```

Zmień wywołanie walidacji:
```python
        ok, reason, _key = validate_pack_to_pallet(
            unit, pallet_client, planned_by_key, packed_by_key)
```

Zmień UPDATE sztuki (alokacja `order_id` + `client_name`):
```python
        cx_execute(
            conn,
            "UPDATE finished_units SET status=%s, pallet_id=%s, order_id=%s, client_name=%s WHERE id=%s",
            (PACKED, pallet_id, order_id, pallet_client, unit_id),
        )
```

- [ ] **Step 3: Smoke — import i testy czystej funkcji**

Run: `cd /opt/kebab/kebab_new/kebab_fixed/backend && python3 -c "import app.services.pallets_service; print('import OK')" && python3 -m pytest tests/test_pack_to_pallet.py -q`
Expected: `import OK` + testy PASS.

- [ ] **Step 4: Commit**

```bash
cd /opt/kebab/kebab_new/kebab_fixed && git add backend/app/services/pallets_service.py && \
git commit -m "feat(pack): pobierz klienta palety + alokuj sztukę (order_id/klient) przy spakowaniu"
```

---

## Task 3: Pełna sucha testów backendu

- [ ] **Step 1: Cały pytest**

Run: `cd /opt/kebab/kebab_new/kebab_fixed/backend && python3 -m pytest -q`
Expected: wszystko zielone.

- [ ] **Step 2: Ręczny e2e (środowisko z bazą) — alokacja**

1. Zrób kilka sztuk „na magazyn" (klient „na magazyn") danego SKU.
2. Utwórz zamówienie klienta Zagros, ułóż paletę z tym SKU.
3. Mobile: skan QR palety → skan sztuki „na magazyn" → OK; sprawdź w DB, że sztuka ma
   teraz `order_id` zamówienia i `client_name='Zagros'`.
4. Skan sztuki innego realnego klienta → błąd „Inny klient niż na palecie".

Expected: zachowanie zgodne ze specem.

---

## Self-Review (autora planu)

- **Pokrycie specu:** reguła klienta + sentinele (Task 1); zmiana sygnatury (Task 1);
  serwis pobiera klienta + alokacja (Task 2); testy w tym `test_combine_stock_and_fresh`
  (Task 1); pełne testy (Task 3). ✅
- **Spójność typów:** `validate_pack_to_pallet(unit, pallet_client, planned_by_key, packed_by_key)`
  identyczna w Task 1 (def) i Task 2 (wywołanie). `_pallet_pack_state` zwraca 5-krotkę,
  rozpakowywaną w Task 2 jako 5 wartości. ✅
- **Placeholdery:** brak — każdy krok ma pełny kod/komendę. ✅
