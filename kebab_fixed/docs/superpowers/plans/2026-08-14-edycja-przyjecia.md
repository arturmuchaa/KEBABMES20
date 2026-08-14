# Edycja przyjęcia w pełnym formularzu — plan wdrożenia

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Edycja dostawy otwiera ten sam pełnoekranowy formularz co przyjęcie i zapisuje CAŁY dokument jednym `PUT`, z diffem pozycji po stronie backendu.

**Architecture:** Front odsyła dokument w kształcie identycznym z tworzeniem (nagłówek + grupy = numery porządkowe). `receptions_service.update_reception` paruje grupy z partiami po `batchId`, wylicza aktualizacje / dołożenia / anulowania i wykonuje je w JEDNEJ transakcji. Pozycje już ruszone są zamrożone — backend sprawdza to sam, nie ufa wyszarzeniu w UI. Zmiana kilogramów i rodzaju surowca pociąga za sobą lot `meat_stock` wraz z ruchami domykającymi księgę.

**Tech Stack:** FastAPI + psycopg2 (backend), React 18 + TypeScript + Vite (front), pytest (testy DB), vitest (testy czystej logiki).

**Spec:** `docs/superpowers/specs/2026-08-14-edycja-przyjecia-design.md`

## Global Constraints

- **Język:** UI, komunikaty błędów, komentarze i nazwy testów po polsku — jak reszta repo.
- **Jedna transakcja:** cały zapis dokumentu albo nic. Dokument zapisany w połowie rozjeżdża księgę i saldo pojemników.
- **Kolejność ruchów magazynowych:** `create_stock_movement` PRZED zmianą stanu (`kg_available`) — ruch waliduje żywy stan i przy wyzerowanym polu odrzuciłby sam siebie.
- **Backend nie ufa frontowi:** zamrożone pozycje sprawdza sam, porównując przysłane wartości ze stanem w bazie.
- **Warunek „ruszona":** wyłącznie `_batch_used_reason_cx(conn, batch_id, for_cancel=True)` — jedno źródło prawdy, wspólne z anulowaniem.
- **Testy DB:** uruchamiać z pełnym URL, inaczej cicho się pomijają i dają fałszywe zielone:
  `TEST_DATABASE_URL=postgresql://postgres:p@localhost:55437/kebab_mes_test python3 -m pytest ...`
- **Poza zakresem (nie implementować):** zmiana dostawcy, `reception_no`, trybu usługowego, wymiana skanu HDI.
- **Katalog roboczy backendu:** `/opt/kebab/kebab_new/kebab_fixed/backend`; frontu: `/opt/kebab/kebab_new/kebab_fixed`.

---

### Task 1: Model `ReceptionUpdate` + `PUT /api/receptions/{id}` (sam nagłówek dokumentu)

Pierwszy krok stawia trasę i zapis nagłówka. Pozycje dochodzą w Task 2 — dzięki temu każdy kawałek diffu ma własny cykl testowy.

**Files:**
- Modify: `backend/app/models/receptions.py`
- Modify: `backend/app/services/receptions_service.py`
- Modify: `backend/app/routes/receptions.py`
- Test: `backend/tests/test_reception_edit_db.py` (nowy)

**Interfaces:**
- Consumes: `ReceptionCreate`, `ReceptionGroupIn` (istnieją), `get_reception(reception_id)`.
- Produces:
  - `ReceptionGroupIn.batch_id: Optional[str]` (alias `batchId`) — puste = nowa pozycja.
  - `class ReceptionUpdate(BaseModel)` — pola: `received_date`, `document_no`, `hdi_no`, `notes`, `price_per_kg`, `material_type_id`, `groups: List[ReceptionGroupIn]`.
  - `receptions_service.update_reception(reception_id: str, dto: ReceptionUpdate) -> Dict[str, Any]` — zwraca to samo co `get_reception` plus klucz `warnings: List[str]`.

- [ ] **Step 1: Napisz test nagłówka (czerwony)**

```python
# backend/tests/test_reception_edit_db.py
"""Edycja przyjęcia: PUT na CAŁY dokument dostawy.

Modal na osiem pól zastąpił pełny formularz — zapis idzie jednym żądaniem,
a backend sam wylicza, co zmienić, dołożyć i anulować.
Testy DB — wymagają TEST_DATABASE_URL (patrz conftest), inaczej skip."""
import pytest
from fastapi import HTTPException

from app.db import execute, query_all, query_one
from app.models.receptions import ReceptionCreate, ReceptionUpdate
from app.services.receptions_service import create_reception, update_reception
from app.utils.ids import now_iso


def _seed_dostawca(sid="sup-edit", nazwa="KOKO"):
    execute(
        "INSERT INTO suppliers (id, code, name, display_name, created_at) "
        "VALUES (%s,%s,%s,%s,%s) ON CONFLICT (id) DO NOTHING",
        (sid, nazwa, nazwa, nazwa, now_iso()),
    )
    execute(
        "INSERT INTO raw_material_types (id, name, requires_deboning) VALUES "
        "('mat-cwiartka','Ćwiartka z kurczaka',true) ON CONFLICT (id) DO NOTHING"
    )
    execute(
        "INSERT INTO raw_material_types (id, name, requires_deboning) VALUES "
        "('mat-filet-kurczak','Filet z kurczaka',false) ON CONFLICT (id) DO NOTHING"
    )
    execute(
        "INSERT INTO raw_material_types (id, name, requires_deboning) VALUES "
        "('mat-mieso-zs','Mięso z/s',false) ON CONFLICT (id) DO NOTHING"
    )
    return sid


def _przyjmij(sid, material="mat-cwiartka", grupy=((("500"), 1000.0),)):
    """Dostawa z listy (numer porządkowy, kg)."""
    return create_reception(ReceptionCreate.model_validate({
        "supplierId": sid,
        "materialTypeId": material,
        "receivedDate": "2026-08-14",
        "documentNo": "FA/1/08/2026",
        "pricePerKg": 5.0,
        "groups": [
            {"internalBatchNo": nr, "kgReceived": kg,
             "supplierBatches": [{"supplierBatchNo": f"HDI-{nr}", "kgReceived": kg}]}
            for nr, kg in grupy
        ],
    }))


def _grupa(batch, kg=None):
    """Grupa do PUT-a odwzorowująca istniejącą partię (bez zmian)."""
    return {
        "batchId": batch["id"],
        "internalBatchNo": batch["internal_batch_no"],
        "kgReceived": float(kg if kg is not None else batch["kg_received"]),
        "supplierBatches": [],
    }


def test_edycja_zapisuje_naglowek_dokumentu(db):
    sid = _seed_dostawca()
    out = _przyjmij(sid)
    rec_id = out["reception"]["id"]
    partia = out["batches"][0]

    update_reception(rec_id, ReceptionUpdate.model_validate({
        "receivedDate": "2026-08-14",
        "documentNo": "FA/999/08/2026",
        "notes": "poprawiony numer faktury",
        "pricePerKg": 5.0,
        "materialTypeId": "mat-cwiartka",
        "groups": [_grupa(partia)],
    }))

    rec = query_one("SELECT document_no, notes FROM receptions WHERE id=%s", (rec_id,))
    assert rec["document_no"] == "FA/999/08/2026"
    assert rec["notes"] == "poprawiony numer faktury"
```

- [ ] **Step 2: Uruchom test — ma paść na imporcie**

Run: `cd backend && TEST_DATABASE_URL=postgresql://postgres:p@localhost:55437/kebab_mes_test python3 -m pytest tests/test_reception_edit_db.py -q`
Expected: FAIL — `ImportError: cannot import name 'ReceptionUpdate'`

- [ ] **Step 3: Dodaj `batch_id` do `ReceptionGroupIn` i model `ReceptionUpdate`**

```python
# backend/app/models/receptions.py — w ReceptionGroupIn, obok internal_batch_no:
    #: Partia, którą ta grupa JEST (edycja dokumentu). Puste = pozycja nowa.
    #: Parujemy po id, nie po numerze porządkowym: numer bywa zmieniany, a przy
    #: dołożonym wierszu jeszcze nie istnieje.
    batch_id: Optional[str] = Field(None, alias="batchId")


class ReceptionUpdate(BaseModel):
    """PUT /api/receptions/{id} — zapis CAŁEGO dokumentu po edycji.

    Kształt jak przy tworzeniu, bez pól, których edycja nie rusza
    (dostawca, numer przyjęcia, tryb usługowy, skan HDI).
    """

    model_config = ConfigDict(populate_by_name=True, validate_default=True)

    received_date: str = Field("", alias="receivedDate")
    material_type_id: str = Field("", alias="materialTypeId")
    document_no: str = Field("", alias="documentNo")
    hdi_no: str = Field("", alias="hdiNo")
    notes: str = ""
    price_per_kg: float = Field(0, alias="pricePerKg", ge=0)
    groups: List[ReceptionGroupIn] = Field(default_factory=list)
```

- [ ] **Step 4: Napisz `update_reception` — na razie sam nagłówek**

```python
# backend/app/services/receptions_service.py
def update_reception(reception_id: str, dto: ReceptionUpdate) -> Dict[str, Any]:
    """Zapis całego dokumentu dostawy po edycji.

    Wszystko w jednej transakcji: dokument zapisany w połowie rozjeżdża księgę
    i saldo pojemników bez śladu, dlaczego.
    """
    rec = query_one("SELECT * FROM receptions WHERE id=%s", (reception_id,))
    if not rec:
        raise HTTPException(404, "Nie ma takiego przyjęcia")

    day = (dto.received_date or "")[:10] or str(rec["received_date"])[:10]

    with transaction() as conn:
        cx_execute(
            conn,
            "UPDATE receptions SET received_date=%s, document_no=%s, hdi_no=%s, notes=%s "
            "WHERE id=%s",
            (day, dto.document_no or "", dto.hdi_no or "", dto.notes or "", reception_id),
        )

    out = get_reception(reception_id)
    out["warnings"] = []
    return out
```

- [ ] **Step 5: Podłącz trasę**

```python
# backend/app/routes/receptions.py — PRZED @router.get("/{reception_id}")
@router.put("/{reception_id}")
def update_reception(reception_id: str, dto: ReceptionUpdate):
    """Zapis całego dokumentu dostawy po edycji (nagłówek + numery porządkowe)."""
    return svc.update_reception(reception_id, dto)
```

Import modelu: `from app.models.receptions import ReceptionCreate, ReceptionUpdate`.

- [ ] **Step 6: Uruchom test — ma przejść**

Run: `cd backend && TEST_DATABASE_URL=postgresql://postgres:p@localhost:55437/kebab_mes_test python3 -m pytest tests/test_reception_edit_db.py -q`
Expected: PASS (1 test)

- [ ] **Step 7: Commit**

```bash
git add backend/app/models/receptions.py backend/app/services/receptions_service.py backend/app/routes/receptions.py backend/tests/test_reception_edit_db.py
git commit -m "feat(przyjecia): PUT /api/receptions/{id} — zapis nagłówka dokumentu"
```

---

### Task 2: Diff pozycji — aktualizacja istniejących numerów porządkowych

**Files:**
- Modify: `backend/app/services/receptions_service.py`
- Modify: `backend/app/services/raw_batches_service.py`
- Test: `backend/tests/test_reception_edit_db.py`

**Interfaces:**
- Produces: `raw_batches_service.apply_group_cx(conn, batch_id: str, *, kg: float, price_per_kg: float, supplier_batch_no: str, slaughter_date: str, expiry_date: str, received_date: str, document_no: str, notes: str, container_kg, containers_count, pallets_h1: int, pallets_other: int, pallets_other_kind) -> Dict` — aktualizuje partię ĆWIARTKI wraz z saldem nośników. Lot mięsa dochodzi w Task 4.
- Consumes: istniejące `_book_batch_containers(conn, batch_row, ...)`.

- [ ] **Step 1: Test aktualizacji wartości pozycji (czerwony)**

```python
def test_edycja_poprawia_kilogramy_i_cene_nietknietej_cwiartki(db):
    sid = _seed_dostawca()
    out = _przyjmij(sid, grupy=(("501", 1000.0),))
    rec_id, partia = out["reception"]["id"], out["batches"][0]

    update_reception(rec_id, ReceptionUpdate.model_validate({
        "receivedDate": "2026-08-14",
        "materialTypeId": "mat-cwiartka",
        "pricePerKg": 6.5,
        "groups": [dict(_grupa(partia, kg=1200.0), slaughterDate="2026-08-10")],
    }))

    row = query_one(
        "SELECT kg_received, kg_available, price_per_kg, slaughter_date "
        "FROM raw_batches WHERE id=%s", (partia["id"],))
    assert float(row["kg_received"]) == 1200.0
    # Ćwiartka trzyma stan na dostawie — po korekcie idzie razem z wagą.
    assert float(row["kg_available"]) == 1200.0
    assert float(row["price_per_kg"]) == 6.5
    assert str(row["slaughter_date"]) == "2026-08-10"
```

- [ ] **Step 2: Uruchom — ma paść**

Run: `cd backend && TEST_DATABASE_URL=postgresql://postgres:p@localhost:55437/kebab_mes_test python3 -m pytest tests/test_reception_edit_db.py::test_edycja_poprawia_kilogramy_i_cene_nietknietej_cwiartki -q`
Expected: FAIL — kg zostaje 1000.0 (pozycje jeszcze nie są zapisywane)

- [ ] **Step 3: Dodaj `apply_group_cx` w `raw_batches_service`**

```python
def apply_group_cx(conn, batch_id: str, *, kg: float, price_per_kg: float,
                   supplier_batch_no: str, slaughter_date: str, expiry_date: str,
                   received_date: str, document_no: str, notes: str,
                   container_kg, containers_count, pallets_h1: int,
                   pallets_other: int, pallets_other_kind) -> Dict:
    """Zapis JEDNEJ pozycji dokumentu po edycji (ćwiartka).

    Stan idzie razem z wagą: dla ćwiartki kilogramy żyją na dostawie, więc
    korekta wagi zmienia i `kg_received`, i `kg_available`. Partia ruszona tu
    nie dociera — filtruje ją strażnik w `update_reception`.
    """
    row = cx_execute_returning(
        conn,
        """
        UPDATE raw_batches
        SET kg_received=%s, kg_available=%s, price_per_kg=%s, supplier_batch_no=%s,
            slaughter_date=%s, expiry_date=%s, received_date=%s, invoice_no=%s, notes=%s
        WHERE id=%s RETURNING *
        """,
        (kg, kg, price_per_kg, supplier_batch_no, slaughter_date or None,
         expiry_date or None, received_date or None, document_no, notes, batch_id),
    )
    if not row:
        raise HTTPException(404, "Partia nie znaleziona")
    _book_batch_containers(
        conn, row, container_kg=container_kg, containers_count=containers_count,
        pallets_h1=pallets_h1, pallets_other=pallets_other,
        pallets_other_kind=pallets_other_kind)
    return row
```

Sprawdź sygnaturę `_book_batch_containers` w tym pliku i dopasuj nazwy argumentów 1:1 — księguje różnicowo, więc wywołanie przy edycji jest obowiązkowe (inaczej dostawca zostaje z fantomowym saldem).

- [ ] **Step 4: Wołaj to z `update_reception` + zapisz pozycje dostawcy**

```python
# w update_reception, wewnątrz transakcji, po UPDATE receptions:
        istniejace = {
            b["id"]: b for b in cx_query_all(
                conn, "SELECT * FROM raw_batches WHERE reception_id=%s "
                      "AND COALESCE(status,'') <> 'cancelled'", (reception_id,))
        }
        for g in dto.groups:
            if not g.batch_id:
                continue                      # dołożenie pozycji — Task 6
            if g.batch_id not in istniejace:
                raise HTTPException(400, f"Pozycja {g.batch_id} nie należy do tej dostawy")
            numery = [b.supplier_batch_no.strip() for b in g.supplier_batches
                      if (b.supplier_batch_no or "").strip()]
            raw_batches_service.apply_group_cx(
                conn, g.batch_id,
                kg=g.kg_received, price_per_kg=dto.price_per_kg,
                supplier_batch_no=", ".join(numery),
                slaughter_date=g.slaughter_date or _earliest(
                    [b.slaughter_date for b in g.supplier_batches]),
                expiry_date=g.expiry_date or _earliest(
                    [b.expiry_date for b in g.supplier_batches]),
                received_date=day, document_no=dto.document_no or "",
                notes=dto.notes or "",
                container_kg=g.container_kg, containers_count=g.containers_count,
                pallets_h1=g.pallets_h1, pallets_other=g.pallets_other,
                pallets_other_kind=g.pallets_other_kind)
            _replace_supplier_lines_cx(conn, reception_id, g)
```

`_replace_supplier_lines_cx` kasuje wiersze `reception_supplier_batches` tej partii i wstawia przysłane (kolejność = `seq`). Wzoruj się na tym, jak wstawia je `create_reception`.

- [ ] **Step 5: Uruchom oba testy**

Run: `cd backend && TEST_DATABASE_URL=postgresql://postgres:p@localhost:55437/kebab_mes_test python3 -m pytest tests/test_reception_edit_db.py -q`
Expected: PASS (2 testy)

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/receptions_service.py backend/app/services/raw_batches_service.py backend/tests/test_reception_edit_db.py
git commit -m "feat(przyjecia): edycja zapisuje pozycje dokumentu (ćwiartka)"
```

---

### Task 3: Strażnik zamrożonych pozycji + atomowość

**Files:**
- Modify: `backend/app/services/receptions_service.py`
- Test: `backend/tests/test_reception_edit_db.py`

**Interfaces:**
- Consumes: `raw_batches_service._batch_used_reason_cx(conn, batch_id, for_cancel=True)`.
- Produces: `receptions_service._assert_group_unchanged_cx(conn, batch_row, group) -> None` — 409 z numerem porządkowym, gdy zamrożona pozycja przyszła ze zmianą.

- [ ] **Step 1: Testy blokady i atomowości (czerwone)**

```python
def _zamroz(batch_id, kg=500.0):
    """Symuluje pobranie do rozbioru — partia staje się „ruszona"."""
    execute(
        "INSERT INTO deboning_entries (id, raw_batch_id, raw_batch_no, kg_quarter, "
        " kg_meat, status, created_at) VALUES (%s,%s,'x',%s,0,'complete',%s)",
        (f"de-{batch_id[:8]}", batch_id, kg, now_iso()),
    )


def test_zmiana_zamrozonej_pozycji_daje_409(db):
    sid = _seed_dostawca()
    out = _przyjmij(sid, grupy=(("502", 1000.0),))
    rec_id, partia = out["reception"]["id"], out["batches"][0]
    _zamroz(partia["id"])

    with pytest.raises(HTTPException) as err:
        update_reception(rec_id, ReceptionUpdate.model_validate({
            "receivedDate": "2026-08-14", "materialTypeId": "mat-cwiartka",
            "pricePerKg": 5.0, "groups": [_grupa(partia, kg=900.0)],
        }))
    assert err.value.status_code == 409
    assert "502" in str(err.value.detail)   # numer porządkowy w komunikacie


def test_blokada_jednej_pozycji_nie_zapisuje_pozostalych(db):
    """Atomowość: dokument zapisany w połowie rozjeżdża księgę."""
    sid = _seed_dostawca()
    out = _przyjmij(sid, grupy=(("503", 600.0), ("504", 400.0)))
    rec_id, wolna, ruszona = out["reception"]["id"], out["batches"][0], out["batches"][1]
    _zamroz(ruszona["id"])

    with pytest.raises(HTTPException):
        update_reception(rec_id, ReceptionUpdate.model_validate({
            "receivedDate": "2026-08-14", "materialTypeId": "mat-cwiartka",
            "pricePerKg": 5.0,
            "groups": [_grupa(wolna, kg=700.0), _grupa(ruszona, kg=300.0)],
        }))

    row = query_one("SELECT kg_received FROM raw_batches WHERE id=%s", (wolna["id"],))
    assert float(row["kg_received"]) == 600.0   # nietknięta pozycja BEZ zmian


def test_zamrozona_pozycja_bez_zmian_przechodzi(db):
    sid = _seed_dostawca()
    out = _przyjmij(sid, grupy=(("505", 600.0), ("506", 400.0)))
    rec_id, wolna, ruszona = out["reception"]["id"], out["batches"][0], out["batches"][1]
    _zamroz(ruszona["id"])

    update_reception(rec_id, ReceptionUpdate.model_validate({
        "receivedDate": "2026-08-14", "materialTypeId": "mat-cwiartka",
        "pricePerKg": 5.0,
        "groups": [_grupa(wolna, kg=650.0), _grupa(ruszona)],
    }))

    assert float(query_one(
        "SELECT kg_received FROM raw_batches WHERE id=%s", (wolna["id"],))["kg_received"]) == 650.0
```

- [ ] **Step 2: Uruchom — mają paść**

Run: `cd backend && TEST_DATABASE_URL=postgresql://postgres:p@localhost:55437/kebab_mes_test python3 -m pytest tests/test_reception_edit_db.py -q`
Expected: FAIL (3 nowe testy — zmiana zamrożonej pozycji przechodzi bez sprzeciwu)

- [ ] **Step 3: Dodaj strażnika**

```python
#: Pola pozycji, których zmiana na zamrożonej partii jest zabroniona.
def _assert_group_unchanged_cx(conn, batch_row: Dict, g) -> None:
    """Zamrożoną pozycję wolno przysłać TYLKO bez zmian.

    Backend porównuje wartości sam — nie ufa temu, że front wyszarzył wiersz.
    """
    reason = raw_batches_service._batch_used_reason_cx(
        conn, batch_row["id"], for_cancel=True)
    if not reason:
        return
    numer = batch_row.get("internal_batch_no") or batch_row["id"]
    if abs(float(g.kg_received) - float(batch_row["kg_received"] or 0)) > 0.001:
        raise HTTPException(409, f"Numer {numer} jest już w użyciu — nie można zmienić wagi")
    if (g.internal_batch_no or numer) != numer:
        raise HTTPException(409, f"Numer {numer} jest już w użyciu — nie można zmienić numeru")
```

Wywołaj `_assert_group_unchanged_cx(conn, istniejace[g.batch_id], g)` na początku pętli po grupach; gdy pozycja jest zamrożona i nic się nie zmieniło — pomiń `apply_group_cx` (`continue`).

- [ ] **Step 4: Uruchom testy**

Run: `cd backend && TEST_DATABASE_URL=postgresql://postgres:p@localhost:55437/kebab_mes_test python3 -m pytest tests/test_reception_edit_db.py -q`
Expected: PASS (5 testów)

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/receptions_service.py backend/tests/test_reception_edit_db.py
git commit -m "feat(przyjecia): zamrożone numery blokują zmianę, zapis pozostaje atomowy"
```

---

### Task 4: Kilogramy fileta i mięsa z/s ciągną za sobą lot

**Files:**
- Modify: `backend/app/services/raw_batches_service.py`
- Test: `backend/tests/test_reception_edit_db.py`

**Interfaces:**
- Produces: `raw_batches_service.resize_reception_lot_cx(conn, batch_id: str, kg_new: float) -> None` — dociąga lot przyjęcia (`deboning_session_id IS NULL`) do nowej wagi ruchem `reception_edit`.

- [ ] **Step 1: Test (czerwony)**

```python
def test_korekta_kg_fileta_idzie_razem_z_lotem(db):
    sid = _seed_dostawca()
    out = _przyjmij(sid, material="mat-filet-kurczak", grupy=(("507", 167.0),))
    rec_id, partia = out["reception"]["id"], out["batches"][0]

    update_reception(rec_id, ReceptionUpdate.model_validate({
        "receivedDate": "2026-08-14", "materialTypeId": "mat-filet-kurczak",
        "pricePerKg": 10.0, "groups": [_grupa(partia, kg=180.0)],
    }))

    lot = query_one("SELECT kg_initial, kg_available FROM meat_stock WHERE raw_batch_id=%s",
                    (partia["id"],))
    assert float(lot["kg_initial"]) == 180.0
    assert float(lot["kg_available"]) == 180.0
    # Księga lotu = stan: przyjęcie 167 + korekta 13.
    saldo = query_one(
        "SELECT COALESCE(SUM(qty),0) AS q FROM stock_movements "
        "WHERE product_type='meat' AND batch_id=(SELECT id FROM meat_stock WHERE raw_batch_id=%s)",
        (partia["id"],))
    assert float(saldo["q"]) == 180.0
    # Dostawa bez rozbioru trzyma zero — stan żyje w locie.
    assert float(query_one("SELECT kg_available FROM raw_batches WHERE id=%s",
                           (partia["id"],))["kg_available"]) == 0.0
```

- [ ] **Step 2: Uruchom — ma paść**

Run: `cd backend && TEST_DATABASE_URL=postgresql://postgres:p@localhost:55437/kebab_mes_test python3 -m pytest tests/test_reception_edit_db.py::test_korekta_kg_fileta_idzie_razem_z_lotem -q`
Expected: FAIL — lot zostaje 167 kg

- [ ] **Step 3: Implementacja**

```python
def resize_reception_lot_cx(conn, batch_id: str, kg_new: float) -> None:
    """Dociągnij lot przyjęcia (filet / mięso z/s) do skorygowanej wagi.

    Bez tego edycja takiej dostawy rozjeżdżała dostawę z magazynem mięsa —
    dlatego dotąd była w ogóle zablokowana. Różnicę księguje ruch, żeby
    kartoteka lotu tłumaczyła, skąd wzięła się nowa liczba.
    """
    lot = cx_query_one(
        conn,
        "SELECT id, kg_initial, kg_available FROM meat_stock "
        f"WHERE raw_batch_id=%s AND {_UNTOUCHED_RECEPTION_LOT} FOR UPDATE",
        (batch_id,),
    )
    if not lot:
        return
    delta = round(float(kg_new) - float(lot["kg_available"] or 0), 3)
    if abs(delta) < 0.001:
        return
    create_stock_movement(
        conn, product_type="meat", batch_id=lot["id"], qty=abs(delta),
        movement_type="IN" if delta > 0 else "OUT",
        source_type="reception_edit", source_id=batch_id,
    )
    cx_execute(
        conn, "UPDATE meat_stock SET kg_initial=%s, kg_available=%s WHERE id=%s",
        (kg_new, kg_new, lot["id"]),
    )
```

W `apply_group_cx` dla materiału BEZ rozbioru: `kg_available` na dostawie zostaje 0, a po UPDATE wołamy `resize_reception_lot_cx(conn, batch_id, kg)`. Rozstrzygnij rodzaj zapytaniem o `raw_material_types.requires_deboning` (jak `create_batch`, linia ~252).

- [ ] **Step 4: Uruchom całość**

Run: `cd backend && TEST_DATABASE_URL=postgresql://postgres:p@localhost:55437/kebab_mes_test python3 -m pytest tests/test_reception_edit_db.py -q`
Expected: PASS (6 testów)

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/raw_batches_service.py backend/tests/test_reception_edit_db.py
git commit -m "feat(przyjecia): korekta kg fileta i z-s dociąga lot magazynu mięsa"
```

---

### Task 5: Zmiana rodzaju surowca (trzy warianty)

**Files:**
- Modify: `backend/app/services/raw_batches_service.py`
- Modify: `backend/app/services/receptions_service.py`
- Test: `backend/tests/test_reception_edit_db.py`

**Interfaces:**
- Produces: `raw_batches_service.retarget_material_cx(conn, batch_id: str, material_type_id: str) -> None` — przenosi kilogramy między dostawą a magazynem mięsa zgodnie z nowym rodzajem. Wywoływana TYLKO dla nietkniętej partii.

- [ ] **Step 1: Testy trzech wariantów (czerwone)**

```python
def test_zmiana_zs_na_filet_zostawia_kilogramy_na_miejscu(db):
    """Przypadek Wąsika 2026-08-14: filet przyjęty jako mięso z/s."""
    sid = _seed_dostawca()
    out = _przyjmij(sid, material="mat-mieso-zs", grupy=(("508", 167.0),))
    rec_id, partia = out["reception"]["id"], out["batches"][0]

    update_reception(rec_id, ReceptionUpdate.model_validate({
        "receivedDate": "2026-08-14", "materialTypeId": "mat-filet-kurczak",
        "pricePerKg": 10.0, "groups": [_grupa(partia)],
    }))

    b = query_one("SELECT material_type_id, material_name FROM raw_batches WHERE id=%s",
                  (partia["id"],))
    lot = query_one("SELECT material_type_id, kg_available FROM meat_stock WHERE raw_batch_id=%s",
                    (partia["id"],))
    assert b["material_type_id"] == "mat-filet-kurczak"
    assert b["material_name"] == "Filet z kurczaka"
    assert lot["material_type_id"] == "mat-filet-kurczak"
    assert float(lot["kg_available"]) == 167.0


def test_zmiana_fileta_na_cwiartke_zdejmuje_lot_i_oddaje_kg_dostawie(db):
    sid = _seed_dostawca()
    out = _przyjmij(sid, material="mat-filet-kurczak", grupy=(("509", 200.0),))
    rec_id, partia = out["reception"]["id"], out["batches"][0]

    update_reception(rec_id, ReceptionUpdate.model_validate({
        "receivedDate": "2026-08-14", "materialTypeId": "mat-cwiartka",
        "pricePerKg": 5.0, "groups": [_grupa(partia)],
    }))

    assert float(query_one("SELECT kg_available FROM raw_batches WHERE id=%s",
                           (partia["id"],))["kg_available"]) == 200.0
    lot = query_one("SELECT kg_available, status FROM meat_stock WHERE raw_batch_id=%s",
                    (partia["id"],))
    assert float(lot["kg_available"]) == 0.0 and lot["status"] == "CANCELLED"


def test_zmiana_cwiartki_na_filet_tworzy_lot(db):
    sid = _seed_dostawca()
    out = _przyjmij(sid, grupy=(("510", 300.0),))
    rec_id, partia = out["reception"]["id"], out["batches"][0]

    update_reception(rec_id, ReceptionUpdate.model_validate({
        "receivedDate": "2026-08-14", "materialTypeId": "mat-filet-kurczak",
        "pricePerKg": 10.0, "groups": [_grupa(partia)],
    }))

    lot = query_one("SELECT kg_available FROM meat_stock WHERE raw_batch_id=%s", (partia["id"],))
    assert lot is not None and float(lot["kg_available"]) == 300.0
    assert float(query_one("SELECT kg_available FROM raw_batches WHERE id=%s",
                           (partia["id"],))["kg_available"]) == 0.0
```

- [ ] **Step 2: Uruchom — mają paść**

Run: `cd backend && TEST_DATABASE_URL=postgresql://postgres:p@localhost:55437/kebab_mes_test python3 -m pytest tests/test_reception_edit_db.py -q`
Expected: FAIL (3 nowe testy)

- [ ] **Step 3: Implementacja `retarget_material_cx`**

```python
def retarget_material_cx(conn, batch_id: str, material_type_id: str) -> None:
    """Zmiana rodzaju surowca na NIETKNIĘTEJ dostawie.

    Trzy przypadki, każdy z ruchem domykającym księgę — nigdy cichy UPDATE:
      filet ↔ mięso z/s  — kilogramy zostają w locie, zmienia się rodzaj,
      filet/z-s → ćwiartka — lot znika, kilogramy wracają na dostawę,
      ćwiartka → filet/z-s — powstaje lot, dostawa schodzi do zera.
    """
    b = cx_query_one(conn, "SELECT * FROM raw_batches WHERE id=%s FOR UPDATE", (batch_id,))
    if not b or (b.get("material_type_id") or "") == material_type_id:
        return
    mat = cx_query_one(
        conn, "SELECT id, name, requires_deboning FROM raw_material_types WHERE id=%s",
        (material_type_id,))
    if not mat:
        raise HTTPException(400, "Nieznany rodzaj surowca")
    stary = cx_query_one(
        conn, "SELECT requires_deboning FROM raw_material_types WHERE id=%s",
        (b.get("material_type_id") or "",))
    bylo_z_rozbiorem = bool(stary["requires_deboning"]) if stary else True
    ma_rozbior = bool(mat["requires_deboning"])
    kg = float(b.get("kg_received") or 0)

    cx_execute(
        conn, "UPDATE raw_batches SET material_type_id=%s, material_name=%s WHERE id=%s",
        (mat["id"], mat["name"], batch_id))

    if bylo_z_rozbiorem == ma_rozbior:
        if not ma_rozbior:      # filet ↔ mięso z/s — lot zostaje, zmienia rodzaj
            cx_execute(
                conn,
                "UPDATE meat_stock SET material_type_id=%s, material_name=%s "
                f"WHERE raw_batch_id=%s AND {_UNTOUCHED_RECEPTION_LOT}",
                (mat["id"], mat["name"], batch_id))
        return

    if ma_rozbior:              # filet/z-s → ćwiartka: lot znika, kg wracają
        _cancel_reception_lots_cx(conn, batch_id)
        create_stock_movement(
            conn, product_type="raw", batch_id=batch_id, qty=kg,
            movement_type="IN", source_type="reception_edit", source_id=batch_id)
        cx_execute(conn, "UPDATE raw_batches SET kg_available=%s WHERE id=%s", (kg, batch_id))
        return

    # ćwiartka → filet/z-s: kg schodzą z dostawy do nowego lotu
    create_stock_movement(
        conn, product_type="raw", batch_id=batch_id, qty=kg,
        movement_type="OUT", source_type="reception_edit", source_id=batch_id)
    cx_execute(conn, "UPDATE raw_batches SET kg_available=0 WHERE id=%s", (batch_id,))
    _create_reception_lot_cx(conn, b, mat, kg)
```

`_create_reception_lot_cx` wydziel z `create_batch` (linie ~313–355) — ta sama wstawka do `meat_stock` plus ruch IN `meat`. Wydzielenie jest częścią tego zadania: dwie kopie tego kodu rozjadą się przy pierwszej zmianie.

- [ ] **Step 4: Wołaj z `update_reception`**

W pętli po grupach, przed `apply_group_cx`: gdy `dto.material_type_id` różni się od rodzaju partii, a pozycja NIE jest zamrożona → `raw_batches_service.retarget_material_cx(conn, g.batch_id, dto.material_type_id)`. Zmiana rodzaju na zamrożonej pozycji → 409 z numerem (dopisz warunek w `_assert_group_unchanged_cx`).

- [ ] **Step 5: Uruchom całość**

Run: `cd backend && TEST_DATABASE_URL=postgresql://postgres:p@localhost:55437/kebab_mes_test python3 -m pytest tests/test_reception_edit_db.py -q`
Expected: PASS (9 testów)

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/raw_batches_service.py backend/app/services/receptions_service.py backend/tests/test_reception_edit_db.py
git commit -m "feat(przyjecia): zmiana rodzaju surowca przenosi lot ze śladem w księdze"
```

---

### Task 6: Dołożenie i zdjęcie numeru porządkowego

**Files:**
- Modify: `backend/app/services/receptions_service.py`
- Test: `backend/tests/test_reception_edit_db.py`

**Interfaces:**
- Consumes: `create_batch_cx(conn, dto, reception_id=...)`, `raw_batches_service._cancel_batch_cx(conn, batch_id)`.

- [ ] **Step 1: Testy (czerwone)**

```python
def test_dolozenie_numeru_tworzy_partie_pod_tym_samym_dokumentem(db):
    sid = _seed_dostawca()
    out = _przyjmij(sid, grupy=(("511", 600.0),))
    rec_id, partia = out["reception"]["id"], out["batches"][0]

    update_reception(rec_id, ReceptionUpdate.model_validate({
        "receivedDate": "2026-08-14", "materialTypeId": "mat-cwiartka",
        "pricePerKg": 5.0,
        "groups": [_grupa(partia), {"internalBatchNo": "512", "kgReceived": 400.0,
                                    "supplierBatches": []}],
    }))

    partie = query_all(
        "SELECT internal_batch_no, kg_received FROM raw_batches WHERE reception_id=%s "
        "AND COALESCE(status,'') <> 'cancelled' ORDER BY internal_batch_seq", (rec_id,))
    assert [p["internal_batch_no"] for p in partie] == ["511", "512"]


def test_zdjecie_numeru_anuluje_partie_i_zwalnia_numer(db):
    sid = _seed_dostawca()
    out = _przyjmij(sid, grupy=(("513", 600.0), ("514", 400.0)))
    rec_id, zostaje, znika = out["reception"]["id"], out["batches"][0], out["batches"][1]

    update_reception(rec_id, ReceptionUpdate.model_validate({
        "receivedDate": "2026-08-14", "materialTypeId": "mat-cwiartka",
        "pricePerKg": 5.0, "groups": [_grupa(zostaje)],
    }))

    row = query_one("SELECT status, internal_batch_no, internal_batch_seq "
                    "FROM raw_batches WHERE id=%s", (znika["id"],))
    assert row["status"] == "cancelled"
    assert row["internal_batch_no"].startswith("ANUL-")   # numer wrócił do puli
    assert int(row["internal_batch_seq"]) == 514


def test_zdjecie_zamrozonego_numeru_daje_409(db):
    sid = _seed_dostawca()
    out = _przyjmij(sid, grupy=(("515", 600.0), ("516", 400.0)))
    rec_id, zostaje, ruszona = out["reception"]["id"], out["batches"][0], out["batches"][1]
    _zamroz(ruszona["id"])

    with pytest.raises(HTTPException) as err:
        update_reception(rec_id, ReceptionUpdate.model_validate({
            "receivedDate": "2026-08-14", "materialTypeId": "mat-cwiartka",
            "pricePerKg": 5.0, "groups": [_grupa(zostaje)],
        }))
    assert err.value.status_code == 409
    assert "516" in str(err.value.detail)
```

- [ ] **Step 2: Uruchom — mają paść**

Run: `cd backend && TEST_DATABASE_URL=postgresql://postgres:p@localhost:55437/kebab_mes_test python3 -m pytest tests/test_reception_edit_db.py -q`
Expected: FAIL (3 nowe testy)

- [ ] **Step 3: Dołożenie — w pętli po grupach**

```python
            if not g.batch_id:
                numery = [b.supplier_batch_no.strip() for b in g.supplier_batches
                          if (b.supplier_batch_no or "").strip()]
                nowa = create_batch_cx(conn, RawBatchCreate.model_validate({
                    "internalBatchNo": g.internal_batch_no or "",
                    "materialTypeId": dto.material_type_id or "",
                    "supplierId": rec["supplier_id"],
                    "supplierBatchNo": ", ".join(numery),
                    "slaughterDate": g.slaughter_date or "",
                    "receivedDate": day,
                    "expiryDate": g.expiry_date or "",
                    "kgReceived": g.kg_received,
                    "pricePerKg": dto.price_per_kg,
                    "invoiceNo": dto.document_no or "",
                    "notes": dto.notes or "",
                    "containerKg": g.container_kg,
                    "containersCount": g.containers_count,
                    "palletsH1": g.pallets_h1,
                    "palletsOther": g.pallets_other,
                    "palletsOtherKind": g.pallets_other_kind,
                    "isService": bool(rec.get("is_service")),
                }), reception_id=reception_id)
                _replace_supplier_lines_cx(conn, reception_id, g, batch_id=nowa["id"])
                continue
```

- [ ] **Step 4: Zdjęcie — po pętli**

```python
        przyslane = {g.batch_id for g in dto.groups if g.batch_id}
        for bid, brow in istniejace.items():
            if bid in przyslane:
                continue
            powod = raw_batches_service._batch_used_reason_cx(conn, bid, for_cancel=True)
            if powod:
                numer = brow.get("internal_batch_no") or bid
                raise HTTPException(409, f"Numer {numer} jest już w użyciu — nie można go zdjąć")
            raw_batches_service._cancel_batch_cx(conn, bid)
```

- [ ] **Step 5: Uruchom całość**

Run: `cd backend && TEST_DATABASE_URL=postgresql://postgres:p@localhost:55437/kebab_mes_test python3 -m pytest tests/test_reception_edit_db.py -q`
Expected: PASS (12 testów)

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/receptions_service.py backend/tests/test_reception_edit_db.py
git commit -m "feat(przyjecia): edycja dokłada i zdejmuje numery porządkowe"
```

---

### Task 7: Front — mapowanie dokumentu na formularz i z powrotem

Czysta logika, bez DOM — testowalna w vitest, tak jak `receptionSplit.ts`.

**Files:**
- Create: `src/features/raw-batches/receptionEditView.ts`
- Create: `src/features/raw-batches/receptionEditView.test.ts`
- Modify: `src/lib/api.ts` (klient `receptionsApi.update`)

**Interfaces:**
- Produces:
  - `interface EditableDelivery { header: ReceptionHeader; groups: ReceptionGroup[]; frozen: Record<string, string> }` — klucz `frozen` to `batchId`, wartość to powód po polsku.
  - `documentToForm(rec: ReceptionDetail): EditableDelivery`
  - `formToUpdatePayload(header: ReceptionHeader, groups: ReceptionGroup[]): UpdateReceptionDto`
  - `receptionsApi.update(id: string, dto: UpdateReceptionDto): Promise<ReceptionDetail>`

- [ ] **Step 1: Testy mapowania (czerwone)**

```ts
// src/features/raw-batches/receptionEditView.test.ts
import { describe, it, expect } from 'vitest'
import { documentToForm, formToUpdatePayload } from './receptionEditView'

const REC = {
  id: 'rec1', receptionNo: '16/08', receivedDate: '2026-08-14',
  supplierId: 'sup1', documentNo: 'FA/274/08/2026', notes: '',
  batches: [
    { id: 'b1', internalBatchNo: '479', kgReceived: 167, pricePerKg: 10,
      materialTypeId: 'mat-filet-kurczak', kgUsed: 0, frozenReason: null,
      supplierBatches: [{ supplierBatchNo: '17/08', kg: 167,
                          slaughterDate: '2026-08-12', expiryDate: '2026-08-19' }] },
    { id: 'b2', internalBatchNo: '480', kgReceived: 100, pricePerKg: 10,
      materialTypeId: 'mat-filet-kurczak', kgUsed: 0,
      frozenReason: 'w rozbiorze', supplierBatches: [] },
  ],
} as any

describe('documentToForm — dostawa z API na stan formularza', () => {
  it('każdy numer porządkowy staje się grupą, z numerem do odesłania', () => {
    const { groups } = documentToForm(REC)
    expect(groups.map(g => g.batchNo)).toEqual(['479', '480'])
    expect(groups[0].kg).toBe(167)
  })

  it('pozycje HDI trafiają do swojej grupy', () => {
    const { groups } = documentToForm(REC)
    expect(groups[0].lines.map(l => l.supplierBatchNo)).toEqual(['17/08'])
    expect(groups[0].lines[0].group).toBe(0)
  })

  it('powód zamrożenia jedzie po batchId — formularz wyszarza wiersz', () => {
    expect(documentToForm(REC).frozen).toEqual({ b2: 'w rozbiorze' })
  })

  it('nagłówek przenosi dokument, datę i rodzaj surowca', () => {
    const { header } = documentToForm(REC)
    expect(header.documentNo).toBe('FA/274/08/2026')
    expect(header.receivedDate).toBe('2026-08-14')
    expect(header.materialTypeId).toBe('mat-filet-kurczak')
  })
})

describe('formToUpdatePayload — stan formularza na żądanie PUT', () => {
  it('istniejąca grupa niesie batchId, nowa nie', () => {
    const { header, groups } = documentToForm(REC)
    const nowa = { ...groups[0], batchId: undefined, batchNo: '481', kg: 50, lines: [] }
    const dto = formToUpdatePayload(header, [...groups, nowa as any])
    expect(dto.groups.map(g => g.batchId)).toEqual(['b1', 'b2', undefined])
    expect(dto.groups[2].kgReceived).toBe(50)
  })

  it('zdjęta grupa po prostu nie wchodzi do żądania', () => {
    const { header, groups } = documentToForm(REC)
    const dto = formToUpdatePayload(header, [groups[0]])
    expect(dto.groups.map(g => g.batchId)).toEqual(['b1'])
  })
})
```

- [ ] **Step 2: Uruchom — ma paść na braku modułu**

Run: `npx vitest run src/features/raw-batches/receptionEditView.test.ts`
Expected: FAIL — `Failed to load url ./receptionEditView`

- [ ] **Step 3: Napisz moduł**

Mapowanie 1:1 z testów: `documentToForm` buduje `ReceptionGroup[]` (pola `index`, `kg`, `lines`, `supplierNos`, `slaughterDate`, `expiryDate`, `batchNo`, `sendBatchNo`, `containersCount`) oraz `batchId` per grupa; `formToUpdatePayload` odwraca to na `{ receivedDate, materialTypeId, documentNo, hdiNo, notes, pricePerKg, groups: [{ batchId, internalBatchNo, kgReceived, supplierBatches, slaughterDate, expiryDate, containerKg, containersCount, palletsH1, palletsOther, palletsOtherKind }] }`. `ReceptionGroup` trzeba rozszerzyć o opcjonalne `batchId?: string` w `receptionSplit.ts`.

- [ ] **Step 4: Klient API**

```ts
// src/lib/api.ts — w receptionsApi, obok cancel:
  update: (id: string, dto: UpdateReceptionDto) =>
    put<any>(`/receptions/${encodeURIComponent(id)}`, dto).then(mapReception),
```

- [ ] **Step 5: Uruchom testy**

Run: `npx vitest run src/features/raw-batches && npx tsc --noEmit -p tsconfig.json`
Expected: PASS, tsc bez błędów

- [ ] **Step 6: Commit**

```bash
git add src/features/raw-batches/receptionEditView.ts src/features/raw-batches/receptionEditView.test.ts src/features/raw-batches/receptionSplit.ts src/lib/api.ts
git commit -m "feat(przyjecia): mapowanie dostawy na formularz edycji i z powrotem"
```

---

### Task 8: Front — `ReceptionForm` w trybie edycji, trasa, ołówek

**Files:**
- Modify: `src/features/raw-batches/components/ReceptionForm.tsx`
- Modify: `src/features/raw-batches/pages/ReceptionFormPage.tsx`
- Modify: `src/features/raw-batches/hooks/useRawBatches.ts` (hook `useEditReception`)
- Modify: `src/features/raw-batches/components/RawBatchesTable.tsx`
- Modify: `src/features/raw-batches/pages/RawBatchesPage.tsx`
- Modify: `src/App.tsx`
- Delete: `src/features/raw-batches/components/EditRawBatchModal.tsx`

**Interfaces:**
- Consumes: `documentToForm`, `formToUpdatePayload`, `receptionsApi.update`, `receptionsApi.byId`.
- Produces: `ReceptionFormProps.mode: 'create' | 'edit'`, `ReceptionFormProps.frozen?: Record<string, string>`, trasa `/office/raw-batches/:receptionId/edycja`.

- [ ] **Step 1: Tryb i wyszarzenie w formularzu**

W `ReceptionForm`: nowe propsy `mode` (domyślnie `'create'`) i `frozen`. Nagłówek: „Edycja dostawy {receptionNo}" dla `edit`. Wiersz grupy, której `batchId` jest w `frozen`: `opacity-60`, pola `readOnly`/`disabled`, bez kosza, z etykietą powodu obok numeru. Pole wyboru dostawcy `disabled` w trybie `edit` z podpowiedzią „zła firma? anuluj dostawę i wpisz ponownie". Przycisk zapisu: „Zapisz zmiany".

- [ ] **Step 2: Hook `useEditReception`**

Odwzoruj `useCreateReception`: wczytuje dostawę (`receptionsApi.byId`), przez `documentToForm` ustawia `header` i `pending`, zapisuje przez `formToUpdatePayload` + `receptionsApi.update`. Bez podpowiedzi numerów (dokument już je ma).

- [ ] **Step 3: Trasa i strona**

```tsx
// src/App.tsx — obok trasy „raw-batches/nowe"
<Route path="raw-batches/:receptionId/edycja" element={<ReceptionFormPage />} />
```

`ReceptionFormPage` czyta `useParams().receptionId`: jest → tryb edycji (hook edycji), brak → dotychczasowe tworzenie.

- [ ] **Step 4: Ołówek prowadzi do formularza**

W `RawBatchesTable` ołówek renderuje się dla każdej nieanulowanej dostawy z `receptionId` i woła `onEdit(b)`; w `RawBatchesPage` `handleEditOpen` robi `navigate('/office/raw-batches/' + b.receptionId + '/edycja')`. Usuń stan `editBatch`/`editLoading`/`editError`, `handleEditSubmit`, import i użycie `EditRawBatchModal`, a potem sam plik modalu.

- [ ] **Step 5: Weryfikacja**

Run: `npx tsc --noEmit -p tsconfig.json && npx vitest run && npm run build`
Expected: tsc czysty, wszystkie testy zielone, build przechodzi

- [ ] **Step 6: Commit**

```bash
git add src/features/raw-batches src/App.tsx
git rm src/features/raw-batches/components/EditRawBatchModal.tsx
git commit -m "feat(przyjecia): edycja otwiera pełny formularz dostawy zamiast modalu"
```

---

### Task 9: Weryfikacja końcowa

**Files:** brak zmian — wyłącznie kontrola.

- [ ] **Step 1: Pełna bateria**

Run:
```bash
cd /opt/kebab/kebab_new/kebab_fixed && npx vitest run && npm run build
cd backend && TEST_DATABASE_URL=postgresql://postgres:p@localhost:55437/kebab_mes_test python3 -m pytest -q
```
Expected: wszystko zielone

- [ ] **Step 2: Przejście ścieżką użytkownika**

Na kopii lokalnej: otwórz dostawę fileta, zmień rodzaj na mięso z/s, zapisz, sprawdź w bazie, że dostawa i lot mają nowy rodzaj i tę samą wagę. Potem dołóż numer porządkowy i zdejmij go z powrotem.

- [ ] **Step 3: Sprawdź spec**

Przejdź spec sekcja po sekcji i potwierdź, że każdy punkt ma pokrycie w kodzie. Rozbieżności dopisz do sekcji „Poza zakresem" albo napraw.

- [ ] **Step 4: Deploy — decyzja użytkownika**

NIE wdrażaj samodzielnie. Przypomnij: przed deployem obowiązkowy diff prod↔repo, potem `deploy/deploy.sh` (kopiuje `app/` i **restartuje** backend; reload cicho serwuje stary kod), a po deployu weryfikacja DANYCH, nie samego `migrations.done`.
