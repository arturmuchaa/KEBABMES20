# Podział wysyłki na fakturę i WZ — plan wdrożenia

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Biuro wpisuje na zamówieniu, ile kilogramów idzie na fakturę; system dzieli sztuki równomiernie po wszystkich pozycjach i wystawia komplet dokumentów przed wyjazdem auta.

**Architecture:** Podział liczy BACKEND (jedno źródło prawdy — dokumenty też robi backend), front tylko pokazuje podgląd z API i pozwala poprawić pojedynczą pozycję. Podział zapisany na pozycjach zamówienia (`qty_invoice`). Stan magazynu rusza WYŁĄCZNIE nowy WZ wewnętrzny serii `WM`; WZ dla klienta, CMR-y i HDI nie robią żadnego ruchu.

**Tech Stack:** FastAPI + psycopg2 (backend), React + TypeScript (front), pytest (testy DB przez `TEST_DATABASE_URL`), vitest (front).

**Spec:** `docs/superpowers/specs/2026-09-09-podzial-wysylki-fv-wz-design.md`

## Global Constraints

- Testy DB uruchamiać z PEŁNYM URL-em: `TEST_DATABASE_URL=postgresql://postgres:p@localhost:55437/kebab_mes_test` — bez niego testy DB CICHO się pomijają i dają fałszywe zielone.
- Każdy statement w `migrations.py` musi być bezpieczny przy ponownym uruchomieniu (`ADD COLUMN IF NOT EXISTS`).
- W SQL psycopg2 pojedynczy `%` jest placeholderem — w literałach pisać `%%`.
- `logger.extra=` NIE może używać nazw zarezerwowanych `LogRecord` (`name`, `filename`, `module`, `created`…) — pilnuje tego `backend/tests/test_logger_extra_keys.py`.
- Komentarze i komunikaty po polsku, jak w reszcie repo.
- Zamówienie BEZ podziału musi zachowywać się dokładnie jak dziś — każdy task kończy się sprawdzeniem regresji.

---

### Task 1: Algorytm podziału trafiający CO DO KILOGRAMA

**Files:**
- Create: `backend/app/services/order_split.py`
- Test: `backend/tests/test_order_split.py`

**Interfaces:**
- Produces: `podziel_pozycje(linie, cel_kg) -> dict` gdzie `linie` to
  `[{"id","qty","kg_per_unit"}]`, a wynik to
  `{"lines": [{...,"qty_invoice": int}], "kg_fv": float, "trafiono": bool}`.
  `trafiono=False` znaczy, że celu nie da się złożyć z całych sztuk i `kg_fv`
  jest najbliższą osiągalną sumą. Taski 2-8 używają wyłącznie tej funkcji.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_order_split.py
"""Podział zamówienia na część fakturowaną i część na WZ.

Właściciel (2026-09-09): „musimy zrobić tak, aby można było dzielić tak, jak
ja chcę — równo. Jeżeli chcę 8000 kg i 5005 kg, to musi się dać tak dzielić,
wtedy trzeba usunąć jakąś sztukę, tak aby trafić w ten podział".

Podział ma trafiać DOKŁADNIE, a nie tylko blisko.
"""
from app.services.order_split import podziel_pozycje


def _l(lid, qty, kg):
    return {"id": lid, "qty": qty, "kg_per_unit": kg}


#: Prawdziwe zamówienie YALCIN/Z/4/09/26 — 21 pozycji, 486 szt, 13 005 kg.
YALCIN = [
    _l("l0", 15, 50), _l("l1", 20, 40), _l("l2", 10, 35), _l("l3", 30, 30),
    _l("l4", 60, 25), _l("l5", 40, 20), _l("l6", 60, 15), _l("l7", 50, 10),
    _l("l8", 4, 60), _l("l9", 10, 35), _l("l10", 10, 30), _l("l11", 40, 40),
    _l("l12", 5, 35), _l("l13", 30, 30), _l("l14", 20, 25), _l("l15", 20, 20),
    _l("l16", 20, 15), _l("l17", 20, 10), _l("l18", 5, 80), _l("l19", 12, 70),
    _l("l20", 5, 60),
]


def test_trafia_CO_DO_KILOGRAMA_w_8000(db=None):
    """Przypadek wprost od właściciela: 8000 na fakturę, 5005 na WZ."""
    w = podziel_pozycje(YALCIN, 8000.0)
    assert w["trafiono"] is True
    assert w["kg_fv"] == 8000.0


def test_reszta_to_dokladnie_5005():
    w = podziel_pozycje(YALCIN, 8000.0)
    calosc = sum(l["qty"] * l["kg_per_unit"] for l in YALCIN)
    assert calosc - w["kg_fv"] == 5005.0


def test_trafia_w_okragle_cele():
    for cel in (6000.0, 7000.0, 9000.0, 10000.0):
        w = podziel_pozycje(YALCIN, cel)
        assert w["trafiono"] is True, cel
        assert w["kg_fv"] == cel


def test_cel_nieosiagalny_daje_najblizsza_sume_i_MOWI_o_tym():
    # Połowa nieparzystej sumy: 13 005 / 2 = 6502,5 kg — z całych sztuk nie ma
    # jak tego złożyć. Najbliżej 6500 kg.
    w = podziel_pozycje(YALCIN, 6502.5)
    assert w["trafiono"] is False
    assert w["kg_fv"] == 6500.0


def test_podzial_zostaje_rownomierny():
    """Dobicie do celu ma poprawiać punktowo, nie wywracać proporcji."""
    w = podziel_pozycje(YALCIN, 8000.0)
    qty = {l["id"]: l["qty"] for l in YALCIN}
    udzialy = [x["qty_invoice"] / qty[x["id"]] for x in w["lines"] if qty[x["id"]] >= 10]
    assert min(udzialy) > 0.45 and max(udzialy) < 0.80


def test_kazda_pozycja_jest_obecna_po_obu_stronach():
    w = podziel_pozycje([_l("a", 10, 50), _l("b", 10, 10)], 300.0)
    for x in w["lines"]:
        assert 0 < x["qty_invoice"] < 10, x


def test_polowa_dzieli_kazda_pozycje_na_pol():
    w = podziel_pozycje([_l("a", 10, 30), _l("b", 20, 25)], 400.0)
    assert [(x["id"], x["qty_invoice"]) for x in w["lines"]] == [("a", 5), ("b", 10)]


def test_sztuki_sa_calkowite_i_w_zakresie():
    w = podziel_pozycje(YALCIN, 8000.0)
    qty = {l["id"]: l["qty"] for l in YALCIN}
    for x in w["lines"]:
        assert isinstance(x["qty_invoice"], int)
        assert 0 <= x["qty_invoice"] <= qty[x["id"]]


def test_cel_zero_nie_daje_nic_na_fakture():
    w = podziel_pozycje([_l("a", 10, 30)], 0)
    assert w["kg_fv"] == 0 and w["lines"][0]["qty_invoice"] == 0


def test_cel_wiekszy_niz_zamowienie_bierze_calosc():
    w = podziel_pozycje([_l("a", 10, 30)], 99999)
    assert w["lines"][0]["qty_invoice"] == 10 and w["kg_fv"] == 300.0


def test_pozycja_bez_wagi_nie_wywraca_podzialu():
    w = podziel_pozycje([_l("a", 10, 30), _l("b", 5, 0)], 150.0)
    assert len(w["lines"]) == 2 and w["kg_fv"] == 150.0


def test_puste_zamowienie_daje_pusta_liste():
    w = podziel_pozycje([], 100.0)
    assert w["lines"] == [] and w["kg_fv"] == 0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && TEST_DATABASE_URL=postgresql://postgres:p@localhost:55437/kebab_mes_test python3 -m pytest tests/test_order_split.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.services.order_split'`

- [ ] **Step 3: Write implementation**

```python
# backend/app/services/order_split.py
"""Podział zamówienia na część fakturowaną i część wydawaną na WZ.

Właściciel (2026-09-09): „system równomiernie odejmuje sztuki, chcę aby
wszystkie pozycje były, ale mniej" ORAZ „jeżeli chcę 8000 kg i 5005 kg, to
musi się dać tak dzielić, wtedy trzeba usunąć jakąś sztukę, tak aby trafić
w ten podział".

Stąd dwa wymagania naraz: rozkład ma być równomierny, a suma ma trafiać
DOKŁADNIE. Realizujemy to w trzech krokach:

  1. równomiernie — każda pozycja oddaje ten sam procent sztuk,
  2. dobicie do celu NAJMNIEJSZYM ruchem (1 sztuka, potem wymiana dwóch,
     potem trzech) — żeby nie zepsuć równomierności z kroku 1,
  3. gdy cel jest nieosiągalny z całych sztuk — najbliższa osiągalna suma
     i `trafiono=False`, żeby biuro o tym wiedziało.

Wagi sztuk w zakładzie są wielokrotnościami 5 kg, więc osiągalna jest każda
wielokrotność 5 kg. Nieosiągalne są tylko cele spoza tej siatki, na przykład
połowa nieparzystej sumy (13 005 / 2 = 6502,5).
"""
from __future__ import annotations

from typing import Any, Dict, List

#: Poniżej tej różnicy uznajemy kilogramy za równe (błąd zmiennoprzecinkowy).
EPS = 1e-9


def _suma_fv(stan: List[Dict[str, Any]]) -> float:
    return sum(x["qty_invoice"] * x["kg_per_unit"] for x in stan)


def _rownomiernie(linie: List[Dict[str, Any]], cel: float, calosc: float) -> List[Dict[str, Any]]:
    """Krok 1: każda pozycja oddaje ten sam procent sztuk."""
    udzial = min(1.0, cel / calosc) if calosc > 0 else 0.0
    stan = []
    for l in linie:
        qty = int(l.get("qty") or 0)
        dokladnie = qty * udzial
        baza = int(dokladnie)
        stan.append({"id": l.get("id"), "qty": qty,
                     "kg_per_unit": float(l.get("kg_per_unit") or 0),
                     "qty_invoice": baza, "_reszta": dokladnie - baza})
    for w in sorted(stan, key=lambda w: -w["_reszta"]):
        if w["qty_invoice"] >= w["qty"]:
            continue
        if abs(_suma_fv(stan) + w["kg_per_unit"] - cel) < abs(_suma_fv(stan) - cel):
            w["qty_invoice"] += 1
    return stan


def _dobij(stan: List[Dict[str, Any]], cel: float) -> bool:
    """Krok 2: najmniejszy ruch trafiający DOKŁADNIE w cel. True = trafiono."""
    d = cel - _suma_fv(stan)
    if abs(d) < EPS:
        return True

    # Jedna sztuka w górę albo w dół.
    for w in stan:
        if d > 0 and w["qty_invoice"] < w["qty"] and abs(w["kg_per_unit"] - d) < EPS:
            w["qty_invoice"] += 1
            return True
        if d < 0 and w["qty_invoice"] > 0 and abs(w["kg_per_unit"] + d) < EPS:
            w["qty_invoice"] -= 1
            return True

    # Wymiana dwóch: dołóż sztukę A, zabierz sztukę B (różnica wag = d).
    for a in stan:
        if a["qty_invoice"] >= a["qty"]:
            continue
        for b in stan:
            if b is a or b["qty_invoice"] <= 0:
                continue
            if abs((a["kg_per_unit"] - b["kg_per_unit"]) - d) < EPS:
                a["qty_invoice"] += 1
                b["qty_invoice"] -= 1
                return True

    # Dwie sztuki w tę samą stronę.
    for a in stan:
        for b in stan:
            if d > 0 and a["qty_invoice"] < a["qty"] and b["qty_invoice"] < b["qty"]:
                if a is b and a["qty"] - a["qty_invoice"] < 2:
                    continue
                if abs(a["kg_per_unit"] + b["kg_per_unit"] - d) < EPS:
                    a["qty_invoice"] += 1
                    b["qty_invoice"] += 1
                    return True
            if d < 0 and a["qty_invoice"] > 0 and b["qty_invoice"] > 0:
                if a is b and a["qty_invoice"] < 2:
                    continue
                if abs(a["kg_per_unit"] + b["kg_per_unit"] + d) < EPS:
                    a["qty_invoice"] -= 1
                    b["qty_invoice"] -= 1
                    return True
    return False


def _osiagalne_sumy(linie: List[Dict[str, Any]], limit: float) -> List[float]:
    """Krok 3: wszystkie sumy kilogramów, jakie da się złożyć z całych sztuk."""
    mozliwe = {0.0}
    for l in linie:
        kg = float(l.get("kg_per_unit") or 0)
        qty = int(l.get("qty") or 0)
        if kg <= 0 or qty <= 0:
            continue
        nowe = set()
        for baza in mozliwe:
            for n in range(qty + 1):
                s = baza + n * kg
                if s <= limit + EPS:
                    nowe.add(round(s, 3))
        mozliwe = nowe
    return sorted(mozliwe)


def podziel_pozycje(linie: List[Dict[str, Any]], cel_kg: float) -> Dict[str, Any]:
    """Rozdziela sztuki na część fakturowaną i resztę.

    Zwraca `{"lines": [...], "kg_fv": float, "kg_calosc": float,
    "trafiono": bool}`. `trafiono=False` znaczy, że celu nie da się złożyć
    z całych sztuk — `kg_fv` jest wtedy najbliższą osiągalną sumą.
    """
    if not linie:
        return {"lines": [], "kg_fv": 0.0, "kg_calosc": 0.0, "trafiono": True}

    calosc = sum(float(l.get("kg_per_unit") or 0) * int(l.get("qty") or 0) for l in linie)
    cel = max(0.0, min(float(cel_kg or 0), calosc))

    stan = _rownomiernie(linie, cel, calosc)
    trafiono = _dobij(stan, cel)

    if not trafiono:
        # Cel spoza siatki wag — celujemy w najbliższą osiągalną sumę.
        osiagalne = _osiagalne_sumy(linie, calosc)
        blisko = min(osiagalne, key=lambda s: (abs(s - cel), s))
        stan = _rownomiernie(linie, blisko, calosc)
        _dobij(stan, blisko)

    for w in stan:
        w.pop("_reszta", None)
    return {"lines": stan, "kg_fv": round(_suma_fv(stan), 3),
            "kg_calosc": round(calosc, 3), "trafiono": trafiono}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && TEST_DATABASE_URL=postgresql://postgres:p@localhost:55437/kebab_mes_test python3 -m pytest tests/test_order_split.py -q`
Expected: PASS (12 testów). Jeśli `test_trafia_CO_DO_KILOGRAMA_w_8000` padnie — rozszerz `_dobij` o wymianę trzech sztuk, NIE luzuj asercji.

- [ ] **Step 5: Commit**

```bash
git add kebab_fixed/backend/app/services/order_split.py kebab_fixed/backend/tests/test_order_split.py
git commit -m "feat(podzial): rownomierny podzial trafiajacy co do kilograma"
```

---

### Task 2: Zapis podziału na zamówieniu

**Files:**
- Modify: `backend/app/migrations.py` (lista `_DDL`, obok innych `ADD COLUMN IF NOT EXISTS`)
- Modify: `backend/app/services/orders_service.py` (`_reconcile_lines_cx`, `_hydrate_order`)
- Create: `backend/app/services/order_split_service.py`
- Test: `backend/tests/test_order_split_db.py`

**Interfaces:**
- Consumes: `podziel_pozycje` z Taska 1.
- Produces: `podglad_podzialu(order_id: str, cel_kg: float) -> dict` z kluczami `{"lines": [...], "kg_fv", "kg_wz", "odchylka"}`; `zapisz_podzial(order_id: str, cel_kg: float, per_line: dict[str, int] | None) -> dict`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_order_split_db.py
"""Podział zapisany na zamówieniu — musi przeżyć edycję.

Edycja zamówienia odtwarza pozycje (`_reconcile_lines_cx`). Gdy podział zginie,
powtórzy się historia znikających palet z sierpnia 2026.
"""
from app.db import execute, query_all
from app.models.orders import ClientOrderCreate
from app.services.order_split_service import podglad_podzialu, zapisz_podzial
from app.services.orders_service import get_order, update_order


def _slownik():
    execute("INSERT INTO clients (id, code, name, display_name) "
            "VALUES ('c1','YAL','YBM Gastro GmbH','YALCIN') ON CONFLICT (id) DO NOTHING")
    execute("INSERT INTO product_types (id, name) VALUES ('pt1','KEBAB UDO 100%%') "
            "ON CONFLICT (id) DO NOTHING")
    execute("INSERT INTO recipes (id, name, product_type_id) VALUES ('r1','KIRMIZI','pt1') "
            "ON CONFLICT (id) DO NOTHING")


def _zamowienie():
    execute("INSERT INTO client_orders (id, order_no, client_id, client_name, order_date, "
            " created_at, status) VALUES ('o1','YALCIN/Z/4/09/26','c1','YBM Gastro GmbH',"
            " '2026-09-08','2026-09-08 08:00:00+00','confirmed')")
    for lid, qty, kg in (("l1", 10, 30), ("l2", 20, 25)):
        execute("INSERT INTO client_order_lines (id, order_id, recipe_id, product_type_id, "
                " qty, kg_per_unit, total_kg) VALUES (%s,'o1','r1','pt1',%s,%s,%s)",
                (lid, qty, kg, qty * kg))


def test_podglad_nie_zapisuje_niczego(db):
    _slownik(); _zamowienie()
    p = podglad_podzialu("o1", 400.0)
    assert p["kg_fv"] > 0
    assert all(l["qty_invoice"] is None for l in get_order("o1")["lines"])


def test_zapis_utrwala_podzial_na_pozycjach(db):
    _slownik(); _zamowienie()
    zapisz_podzial("o1", 400.0, None)
    podzial = {l["id"]: l["qty_invoice"] for l in get_order("o1")["lines"]}
    assert podzial == {"l1": 5, "l2": 10}


def test_podzial_PRZEZYWA_edycje_zamowienia(db):
    _slownik(); _zamowienie()
    zapisz_podzial("o1", 400.0, None)
    update_order("o1", ClientOrderCreate.model_validate({
        "client_id": "c1", "order_date": "2026-09-08",
        "lines": [
            {"id": "l1", "recipe_id": "r1", "product_type_id": "pt1", "qty": 10, "kg_per_unit": 30},
            {"id": "l2", "recipe_id": "r1", "product_type_id": "pt1", "qty": 20, "kg_per_unit": 25},
        ]}))
    podzial = {l["id"]: l["qty_invoice"] for l in get_order("o1")["lines"]}
    assert podzial == {"l1": 5, "l2": 10}, "edycja skasowała podział"


def test_reczna_korekta_pozycji_ma_pierwszenstwo(db):
    _slownik(); _zamowienie()
    zapisz_podzial("o1", 400.0, {"l1": 8})
    podzial = {l["id"]: l["qty_invoice"] for l in get_order("o1")["lines"]}
    assert podzial["l1"] == 8


def test_korekta_ponad_zamowiona_ilosc_jest_odrzucana(db):
    _slownik(); _zamowienie()
    try:
        zapisz_podzial("o1", 400.0, {"l1": 99})
        assert False, "przyjęto więcej sztuk na FV niż zamówiono"
    except Exception as e:
        assert "więcej" in str(e) or "99" in str(e)


def test_zamowienie_bez_podzialu_ma_puste_qty_invoice(db):
    _slownik(); _zamowienie()
    assert all(l["qty_invoice"] is None for l in get_order("o1")["lines"])


def test_podglad_mowi_czy_trafiono_w_cel(db):
    _slownik(); _zamowienie()                      # 300 + 500 = 800 kg
    assert podglad_podzialu("o1", 400.0)["trafiono"] is True
    assert podglad_podzialu("o1", 401.0)["trafiono"] is False
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && TEST_DATABASE_URL=postgresql://postgres:p@localhost:55437/kebab_mes_test python3 -m pytest tests/test_order_split_db.py -q`
Expected: FAIL — `No module named 'app.services.order_split_service'`

- [ ] **Step 3: Dodaj kolumny w migracjach**

W `backend/app/migrations.py`, w liście `_DDL`, obok innych `ALTER TABLE … ADD COLUMN IF NOT EXISTS`:

```python
    # Podział wysyłki na fakturę i WZ (właściciel, 2026-09-09). NULL = brak
    # podziału, czyli zamówienie zachowuje się jak przed tą zmianą.
    "ALTER TABLE client_order_lines ADD COLUMN IF NOT EXISTS qty_invoice INTEGER",
    "ALTER TABLE client_orders ADD COLUMN IF NOT EXISTS invoice_kg_target NUMERIC",
```

- [ ] **Step 4: Napisz serwis podziału**

```python
# backend/app/services/order_split_service.py
"""Podział zamówienia zapisany na pozycjach — podgląd i zapis.

Podgląd NIE zapisuje: biuro ogląda tabelę, poprawia pojedynczą pozycję
i dopiero wtedy zatwierdza.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import HTTPException

from app.db import cx_execute, query_all, query_one, transaction
from app.logging_config import get_logger
from app.services.order_split import podziel_pozycje

logger = get_logger(__name__)


def _linie(order_id: str) -> List[Dict[str, Any]]:
    return query_all(
        "SELECT id, qty, kg_per_unit, recipe_name, product_type_name, position "
        "FROM client_order_lines WHERE order_id=%s ORDER BY position", (order_id,))


def podglad_podzialu(order_id: str, cel_kg: float) -> Dict[str, Any]:
    """Jak rozłoży się podział — bez zapisu."""
    linie = _linie(order_id)
    if not linie:
        raise HTTPException(404, "Zamówienie nie ma pozycji")
    obliczone = podziel_pozycje(
        [{"id": l["id"], "qty": int(l["qty"] or 0),
          "kg_per_unit": float(l["kg_per_unit"] or 0)} for l in linie], cel_kg)
    po_id = {w["id"]: w for w in obliczone["lines"]}
    lines = []
    for l in linie:
        na_fv = int(po_id[l["id"]]["qty_invoice"])
        lines.append({
            "id": l["id"], "position": l["position"],
            "recipe_name": l.get("recipe_name") or "",
            "product_type_name": l.get("product_type_name") or "",
            "kg_per_unit": float(l["kg_per_unit"] or 0),
            "qty": int(l["qty"] or 0),
            "qty_invoice": na_fv,
            "qty_wz": int(l["qty"] or 0) - na_fv,
        })
    kg_fv = sum(x["qty_invoice"] * x["kg_per_unit"] for x in lines)
    kg_all = sum(x["qty"] * x["kg_per_unit"] for x in lines)
    return {"order_id": order_id, "cel_kg": float(cel_kg or 0), "lines": lines,
            "kg_fv": round(kg_fv, 3), "kg_wz": round(kg_all - kg_fv, 3),
            "kg_calosc": round(kg_all, 3),
            "trafiono": obliczone["trafiono"],
            "odchylka": round(kg_fv - float(cel_kg or 0), 3)}


def zapisz_podzial(order_id: str, cel_kg: float,
                   per_line: Optional[Dict[str, int]] = None) -> Dict[str, Any]:
    """Utrwala podział na pozycjach. `per_line` nadpisuje wyliczenie."""
    podglad = podglad_podzialu(order_id, cel_kg)
    korekty = per_line or {}
    for l in podglad["lines"]:
        if l["id"] in korekty:
            reczne = int(korekty[l["id"]])
            if reczne < 0 or reczne > l["qty"]:
                raise HTTPException(
                    400,
                    f"Pozycja {l['recipe_name']} {l['kg_per_unit']} kg: nie można dać "
                    f"na fakturę {reczne} szt, zamówiono {l['qty']}")
            l["qty_invoice"] = reczne
            l["qty_wz"] = l["qty"] - reczne

    with transaction() as conn:
        for l in podglad["lines"]:
            cx_execute(conn, "UPDATE client_order_lines SET qty_invoice=%s WHERE id=%s",
                       (l["qty_invoice"], l["id"]))
        cx_execute(conn, "UPDATE client_orders SET invoice_kg_target=%s WHERE id=%s",
                   (float(cel_kg or 0), order_id))
    logger.info("order.split.saved", extra={"order_id": order_id, "cel_kg": float(cel_kg or 0)})
    kg_fv = sum(l["qty_invoice"] * l["kg_per_unit"] for l in podglad["lines"])
    podglad["kg_fv"] = round(kg_fv, 3)
    podglad["kg_wz"] = round(podglad["kg_calosc"] - kg_fv, 3)
    return podglad


def wyczysc_podzial(order_id: str) -> None:
    """Kasuje podział — zamówienie wraca do zachowania sprzed tej zmiany."""
    with transaction() as conn:
        cx_execute(conn, "UPDATE client_order_lines SET qty_invoice=NULL WHERE order_id=%s",
                   (order_id,))
        cx_execute(conn, "UPDATE client_orders SET invoice_kg_target=NULL WHERE id=%s",
                   (order_id,))
```

- [ ] **Step 5: Zachowaj podział przy edycji zamówienia**

W `backend/app/services/orders_service.py`, w `_reconcile_lines_cx`: przed usunięciem/wstawieniem pozycji zapamiętaj `qty_invoice` po `id` i przywróć je dla pozycji, które zostały dopasowane. Znajdź miejsce, gdzie funkcja pobiera istniejące wiersze, i dopisz do zapytania kolumnę `qty_invoice`, a przy zapisie ustaw ją z powrotem.

- [ ] **Step 6: Run tests**

Run: `cd backend && TEST_DATABASE_URL=postgresql://postgres:p@localhost:55437/kebab_mes_test python3 -m pytest tests/test_order_split_db.py tests/test_order_edit_pallets_db.py -q`
Expected: PASS (6 nowych + istniejące)

- [ ] **Step 7: Commit**

```bash
git add kebab_fixed/backend/app/migrations.py kebab_fixed/backend/app/services/order_split_service.py kebab_fixed/backend/app/services/orders_service.py kebab_fixed/backend/tests/test_order_split_db.py
git commit -m "feat(podzial): zapis podzialu na pozycjach zamowienia, przezywa edycje"
```

---

### Task 3: Seria WM — WZ wewnętrzny na całość

**Files:**
- Modify: `backend/app/migrations.py` (kolumna `doc_series`)
- Modify: `backend/app/services/wz_service.py` (`_seq_key_wz`, `_alokuj_seq_cx`, `format_wz_number`, `_insert_wz`)
- Test: `backend/tests/test_wz_series_wm_db.py`

**Interfaces:**
- Produces: `_insert_wz(..., series: str = "WZ")` — nowy parametr; `format_wz_number(seq, ym, series="WZ")`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_wz_series_wm_db.py
"""Seria WM — WZ wewnętrzny, którego klient nie dostaje.

Właściciel (2026-09-09) wybrał OSOBNĄ serię: seria WZ zostaje wyłącznie dla
dokumentów wychodzących do klientów.
"""
from app.db import query_all
from app.services.wz_service import format_wz_number


def test_numer_wm_ma_wlasny_prefiks():
    assert format_wz_number(7, "2609", series="WM") == "WM/7/09/26"


def test_numer_wz_bez_zmian():
    assert format_wz_number(7, "2609") == "WZ/7/09/26"


def test_serie_licza_sie_niezaleznie(db):
    """WM/1 i WZ/1 mogą istnieć obok siebie — to dwa różne rejestry."""
    from app.db import transaction
    from app.services.wz_service import _insert_wz, _seller_block
    with transaction() as conn:
        wz = _insert_wz(conn, source_type="manual", source_id=None, seller=_seller_block(),
                        buyer={"name": "KLIENT"}, valued=False, lines=[], total=0.0,
                        place="Rudawa", issued="2026-09-09", released="2026-09-09", notes="")
        wm = _insert_wz(conn, source_type="manual", source_id=None, seller=_seller_block(),
                        buyer={"name": "KLIENT"}, valued=False, lines=[], total=0.0,
                        place="Rudawa", issued="2026-09-09", released="2026-09-09", notes="",
                        series="WM")
    numery = {r["id"]: (r["number"], r["doc_series"]) for r in query_all(
        "SELECT id, number, doc_series FROM wz_documents")}
    assert numery[wz][1] == "WZ" and numery[wz][0].startswith("WZ/")
    assert numery[wm][1] == "WM" and numery[wm][0].startswith("WM/")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && TEST_DATABASE_URL=postgresql://postgres:p@localhost:55437/kebab_mes_test python3 -m pytest tests/test_wz_series_wm_db.py -q`
Expected: FAIL — `format_wz_number() got an unexpected keyword argument 'series'`

- [ ] **Step 3: Dodaj kolumnę**

W `_DDL` w `migrations.py`:

```python
    # Seria dokumentu wydania: 'WZ' wychodzi do klienta, 'WM' zostaje w biurze.
    "ALTER TABLE wz_documents ADD COLUMN IF NOT EXISTS doc_series TEXT DEFAULT 'WZ'",
```

- [ ] **Step 4: Rozszerz numerację o serię**

W `backend/app/services/wz_service.py`:

```python
def format_wz_number(seq: int, year_month: str, series: str = "WZ") -> str:
    # year_month = "RRMM" (np. "2606"); numer = WZ/NN/MM/RR albo WM/NN/MM/RR
    yy, mm = year_month[:2], year_month[2:]
    return f"{series}/{seq}/{mm}/{yy}"


def _seq_key_wz(year_month: str, series: str = "WZ") -> str:
    """Klucz licznika w tabeli `sequences` — osobny na serię i miesiąc."""
    return f"{'wz' if series == 'WZ' else 'wm'}_no:{year_month}"
```

W `_alokuj_seq_cx` dodaj parametr `series: str = "WZ"`, przekaż go do `_seq_key_wz`,
a w zapytaniu o start serii dołóż warunek `AND COALESCE(doc_series,'WZ')=%s`.
W `_insert_wz` dodaj `series: str = "WZ"`, użyj go w `_alokuj_seq_cx` i `format_wz_number`
oraz zapisz do kolumny `doc_series`.

- [ ] **Step 5: Run tests**

Run: `cd backend && TEST_DATABASE_URL=postgresql://postgres:p@localhost:55437/kebab_mes_test python3 -m pytest tests/test_wz_series_wm_db.py tests/test_wz_numeracja_db.py -q`
Expected: PASS — nowe przechodzą, numeracja WZ bez regresji

- [ ] **Step 6: Commit**

```bash
git add kebab_fixed/backend/app/migrations.py kebab_fixed/backend/app/services/wz_service.py kebab_fixed/backend/tests/test_wz_series_wm_db.py
git commit -m "feat(dokumenty): osobna seria WM dla WZ wewnetrznego"
```

---

### Task 4: Komplet WZ — wewnętrzny na całość, handlowy dla klienta

**Files:**
- Create: `backend/app/services/split_documents_service.py`
- Test: `backend/tests/test_split_documents_db.py`

**Interfaces:**
- Consumes: `podglad_podzialu` (Task 2), `_insert_wz(..., series=)` (Task 3), `picks_for_order` z `order_stock_service`.
- Produces: `wystaw_wz_wewnetrzny(order_id) -> dict`, `wystaw_wz_klienta(order_id) -> dict`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_split_documents_db.py
"""Komplet dokumentów przy podziale — i reguła, że stan rusza TYLKO WM."""
from app.db import query_all
from app.services.split_documents_service import (wystaw_wz_klienta,
                                                  wystaw_wz_wewnetrzny)
# fixture _slownik/_zamowienie/_wyrob skopiuj z tests/test_finalize_loading_db.py


def test_wz_wewnetrzny_jest_na_calosc(db):
    _przygotuj_z_podzialem(cel_kg=300.0)          # 800 kg całości
    wm = wystaw_wz_wewnetrzny("o1")
    assert wm["number"].startswith("WM/")
    assert wm["kg"] == 800.0


def test_wz_klienta_jest_na_czesc_niefakturowana(db):
    _przygotuj_z_podzialem(cel_kg=300.0)
    wz = wystaw_wz_klienta("o1")
    assert wz["number"].startswith("WZ/")
    assert wz["kg"] == 500.0


def test_TYLKO_wz_wewnetrzny_rusza_magazyn(db):
    """Najważniejsza reguła projektu: dwa dokumenty, jeden rozchód."""
    _przygotuj_z_podzialem(cel_kg=300.0)
    wystaw_wz_wewnetrzny("o1")
    wystaw_wz_klienta("o1")
    ruchy = query_all(
        "SELECT source_id FROM stock_movements WHERE product_type='finished_goods'")
    assert len(ruchy) > 0, "WM nie zdjął stanu"
    zrodla = {r["source_id"] for r in ruchy}
    wz_klienta = query_all("SELECT id FROM wz_documents WHERE doc_series='WZ'")
    assert not ({r["id"] for r in wz_klienta} & zrodla), "WZ klienta ruszył magazyn"


def test_stan_schodzi_dokladnie_raz(db):
    _przygotuj_z_podzialem(cel_kg=300.0)
    wystaw_wz_wewnetrzny("o1")
    wystaw_wz_klienta("o1")
    fg = query_all("SELECT qty_available, qty_shipped FROM finished_goods WHERE id='f1'")[0]
    assert (int(fg["qty_available"]), int(fg["qty_shipped"])) == (0, 30)


def test_powtorne_wystawienie_nie_dubluje(db):
    _przygotuj_z_podzialem(cel_kg=300.0)
    wystaw_wz_wewnetrzny("o1")
    wystaw_wz_wewnetrzny("o1")
    assert len(query_all("SELECT id FROM wz_documents WHERE doc_series='WM'")) == 1


def test_bez_podzialu_wz_klienta_jest_odrzucony(db):
    _przygotuj_bez_podzialu()
    try:
        wystaw_wz_klienta("o1")
        assert False, "wystawiono WZ klienta bez podziału"
    except Exception as e:
        assert "podzia" in str(e).lower()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && TEST_DATABASE_URL=postgresql://postgres:p@localhost:55437/kebab_mes_test python3 -m pytest tests/test_split_documents_db.py -q`
Expected: FAIL — `No module named 'app.services.split_documents_service'`

- [ ] **Step 3: Napisz serwis dokumentów**

`wystaw_wz_wewnetrzny(order_id)`: pobierz `picks_for_order(order_id)`, zbuduj pozycje przez `build_goods_wz_lines`, wstaw przez `_insert_wz(..., series="WM", notes="DOKUMENT WEWNĘTRZNY — NIE WYDAWAĆ KLIENTOWI")`, zdejmij stan (`UPDATE finished_goods` + `create_stock_movement`) — dokładnie jak robi to `finalize_loading` w gałęzi bez istniejącego WZ. Idempotencja: jeśli `wz_documents` ma już wiersz `doc_series='WM' AND source_id=order_id`, zwróć go bez zmian.

`wystaw_wz_klienta(order_id)`: sprawdź, że pozycje mają `qty_invoice IS NOT NULL` (inaczej `HTTPException(400, "Zamówienie nie ma podziału na fakturę i WZ")`), zbuduj pozycje z `qty - qty_invoice`, wstaw przez `_insert_wz(..., series="WZ")` **bez żadnego ruchu magazynowego**.

- [ ] **Step 4: Run tests**

Run: `cd backend && TEST_DATABASE_URL=postgresql://postgres:p@localhost:55437/kebab_mes_test python3 -m pytest tests/test_split_documents_db.py -q`
Expected: PASS (6 testów)

- [ ] **Step 5: Commit**

```bash
git add kebab_fixed/backend/app/services/split_documents_service.py kebab_fixed/backend/tests/test_split_documents_db.py
git commit -m "feat(dokumenty): WZ wewnetrzny na calosc i WZ klienta na czesc niefakturowana"
```

---

### Task 5: CMR w dwóch wariantach

**Files:**
- Modify: `backend/app/migrations.py` (kolumna `scope`)
- Modify: `backend/app/services/cmr_service.py` (`build_cmr`, `generate_cmr`)
- Test: `backend/tests/test_cmr_scope_db.py`

**Interfaces:**
- Produces: `generate_cmr(order_id, form, scope="calosc")` — `scope` w `{"calosc","fv"}`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_cmr_scope_db.py
"""CMR w dwóch wariantach: na drogę (całość) i pod fakturę."""
from app.db import query_all
from app.services.cmr_service import generate_cmr

FORM = {"carrier_id": "", "plate": "KR 12345", "load_date": "2026-09-10"}


def test_cmr_calosc_ma_wszystkie_kilogramy(db):
    _przygotuj_z_podzialem(cel_kg=300.0)          # 800 kg całości
    cmr = generate_cmr("o1", FORM, scope="calosc")
    assert cmr["payload"]["gross_kg"] == 800.0


def test_cmr_do_faktury_ma_tylko_czesc_fakturowana(db):
    _przygotuj_z_podzialem(cel_kg=300.0)
    cmr = generate_cmr("o1", FORM, scope="fv")
    assert cmr["payload"]["gross_kg"] == 300.0


def test_oba_cmr_istnieja_obok_siebie(db):
    _przygotuj_z_podzialem(cel_kg=300.0)
    generate_cmr("o1", FORM, scope="calosc")
    generate_cmr("o1", FORM, scope="fv")
    zakresy = sorted(r["scope"] for r in query_all(
        "SELECT scope FROM cmr_documents WHERE order_id='o1'"))
    assert zakresy == ["calosc", "fv"]


def test_bez_podzialu_cmr_dziala_jak_dotad(db):
    _przygotuj_bez_podzialu()
    cmr = generate_cmr("o1", FORM)
    assert cmr["payload"]["gross_kg"] == 800.0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && TEST_DATABASE_URL=postgresql://postgres:p@localhost:55437/kebab_mes_test python3 -m pytest tests/test_cmr_scope_db.py -q`
Expected: FAIL — `generate_cmr() got an unexpected keyword argument 'scope'`

- [ ] **Step 3: Dodaj kolumnę i wariant**

W `_DDL`:

```python
    "ALTER TABLE cmr_documents ADD COLUMN IF NOT EXISTS scope TEXT DEFAULT 'calosc'",
```

W `cmr_service.build_cmr` i `generate_cmr` dodaj parametr `scope: str = "calosc"`. Gdy `scope == "fv"`, licz pozycje z `qty_invoice` zamiast `qty`. Idempotencja jest per `(order_id, scope)` — dziś jest per `order_id`.

- [ ] **Step 4: Run tests**

Run: `cd backend && TEST_DATABASE_URL=postgresql://postgres:p@localhost:55437/kebab_mes_test python3 -m pytest tests/test_cmr_scope_db.py tests/test_cmr*.py -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add kebab_fixed/backend/app/migrations.py kebab_fixed/backend/app/services/cmr_service.py kebab_fixed/backend/tests/test_cmr_scope_db.py
git commit -m "feat(cmr): wariant na droge i wariant pod fakture"
```

---

### Task 6: HDI — na całość zawsze, do faktury opcjonalnie

**Files:**
- Modify: `backend/app/migrations.py` (kolumna `scope`)
- Modify: `backend/app/services/hdi_service.py` (`generate_hdi`, `build_hdi`)
- Test: `backend/tests/test_hdi_scope_db.py`

**Interfaces:**
- Produces: `generate_hdi(order_id, scope="calosc")` — `scope` w `{"calosc","fv"}`; do części na WZ HDI nie powstaje.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_hdi_scope_db.py
"""HDI: na całość zawsze, do faktury na życzenie, do części na WZ NIGDY.

Właściciel (2026-09-09): „tylko HDI i na całość i HDI drugie do faktury,
do WZ nie".
"""
import pytest

from app.db import query_all
from app.services.hdi_service import generate_hdi


def test_hdi_na_calosc_obejmuje_cale_zamowienie(db):
    _przygotuj_z_podzialem(cel_kg=300.0)
    hdi = generate_hdi("o1")
    assert float(hdi["totals"]["kg"]) == 800.0


def test_hdi_do_faktury_obejmuje_tylko_czesc_fakturowana(db):
    _przygotuj_z_podzialem(cel_kg=300.0)
    hdi = generate_hdi("o1", scope="fv")
    assert float(hdi["totals"]["kg"]) == 300.0


def test_oba_hdi_maja_rozne_numery(db):
    _przygotuj_z_podzialem(cel_kg=300.0)
    a = generate_hdi("o1")
    b = generate_hdi("o1", scope="fv")
    assert a["number"] != b["number"]


def test_hdi_do_czesci_na_wz_jest_ODRZUCANY(db):
    _przygotuj_z_podzialem(cel_kg=300.0)
    with pytest.raises(Exception) as e:
        generate_hdi("o1", scope="wz")
    assert "wz" in str(e.value).lower()


def test_bez_podzialu_hdi_dziala_jak_dotad(db):
    _przygotuj_bez_podzialu()
    assert float(generate_hdi("o1")["totals"]["kg"]) == 800.0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && TEST_DATABASE_URL=postgresql://postgres:p@localhost:55437/kebab_mes_test python3 -m pytest tests/test_hdi_scope_db.py -q`
Expected: FAIL — `generate_hdi() got an unexpected keyword argument 'scope'`

- [ ] **Step 3: Dodaj kolumnę i wariant**

W `_DDL`:

```python
    "ALTER TABLE hdi_documents ADD COLUMN IF NOT EXISTS scope TEXT DEFAULT 'calosc'",
```

W `hdi_service.generate_hdi` dodaj `scope: str = "calosc"`; odrzuć `scope == "wz"` przez
`HTTPException(400, "Do części wydawanej na WZ nie wystawiamy HDI")`. Wyszukiwanie
istniejącego dokumentu i numerację rób per `(order_id, scope)`.

- [ ] **Step 4: Run tests**

Run: `cd backend && TEST_DATABASE_URL=postgresql://postgres:p@localhost:55437/kebab_mes_test python3 -m pytest tests/test_hdi_scope_db.py tests/test_hdi*.py -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add kebab_fixed/backend/app/migrations.py kebab_fixed/backend/app/services/hdi_service.py kebab_fixed/backend/tests/test_hdi_scope_db.py
git commit -m "feat(hdi): wariant na calosc i opcjonalny do faktury"
```

---

### Task 7: Trasy API

**Files:**
- Create: `backend/app/routes/order_split.py`
- Modify: `backend/app/main.py` (rejestracja routera — dopisać `order_split` w OBU listach, jak `integrity`)
- Test: `backend/tests/test_order_split_routes.py`

**Interfaces:**
- Produces: `POST /api/client-orders/{id}/split/preview` `{cel_kg}`; `PUT /api/client-orders/{id}/split` `{cel_kg, per_line}`; `DELETE /api/client-orders/{id}/split`; `POST /api/client-orders/{id}/split/documents` `{hdi_fv: bool}`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_order_split_routes.py
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_podglad_zwraca_tabele_podzialu(db):
    _przygotuj_z_podzialem_bez_zapisu()
    r = client.post("/api/client-orders/o1/split/preview", json={"cel_kg": 300})
    assert r.status_code == 200
    assert r.json()["kg_fv"] > 0


def test_zapis_podzialu(db):
    _przygotuj_z_podzialem_bez_zapisu()
    r = client.put("/api/client-orders/o1/split", json={"cel_kg": 300, "per_line": {}})
    assert r.status_code == 200


def test_komplet_dokumentow_zwraca_numery(db):
    _przygotuj_z_podzialem(cel_kg=300.0)
    r = client.post("/api/client-orders/o1/split/documents", json={"hdi_fv": True})
    dane = r.json()
    assert dane["wm"]["number"].startswith("WM/")
    assert dane["wz"]["number"].startswith("WZ/")
    assert len(dane["cmr"]) == 2
    assert dane["hdi_calosc"]["number"]
    assert dane["hdi_fv"]["number"]


def test_komplet_bez_hdi_do_faktury(db):
    _przygotuj_z_podzialem(cel_kg=300.0)
    dane = client.post("/api/client-orders/o1/split/documents", json={"hdi_fv": False}).json()
    assert dane["hdi_fv"] is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && TEST_DATABASE_URL=postgresql://postgres:p@localhost:55437/kebab_mes_test python3 -m pytest tests/test_order_split_routes.py -q`
Expected: FAIL — 404 na wszystkich trasach

- [ ] **Step 3: Napisz router i zarejestruj go**

Router wywołuje serwisy z Tasków 2, 4, 5, 6. `split/documents` woła po kolei:
`wystaw_wz_wewnetrzny`, `wystaw_wz_klienta`, `generate_cmr(scope="calosc")`,
`generate_cmr(scope="fv")`, `generate_hdi()` oraz — gdy `hdi_fv` — `generate_hdi(scope="fv")`.

- [ ] **Step 4: Run tests**

Run: `cd backend && TEST_DATABASE_URL=postgresql://postgres:p@localhost:55437/kebab_mes_test python3 -m pytest tests/ -q`
Expected: PASS — cały backend

- [ ] **Step 5: Commit**

```bash
git add kebab_fixed/backend/app/routes/order_split.py kebab_fixed/backend/app/main.py kebab_fixed/backend/tests/test_order_split_routes.py
git commit -m "feat(api): trasy podzialu wysylki i kompletu dokumentow"
```

---

### Task 8: Ekran podziału na zamówieniu

**Files:**
- Create: `src/features/orders/split/SplitDialog.tsx`
- Create: `src/features/orders/split/splitDialog.test.tsx`
- Modify: `src/lib/api.ts` (dopisz `orderSplitApi` obok `clientOrdersApi`)
- Modify: `src/pages/office/ClientOrdersPage.tsx` (przycisk „Podział" obok HDI/WZ/CMR, ok. linii 273-290)

**Interfaces:**
- Consumes: trasy z Taska 7.

- [ ] **Step 1: Write the failing test**

```tsx
// src/features/orders/split/splitDialog.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

const podglad = vi.hoisted(() => ({ fn: vi.fn() }))
vi.mock('@/lib/api', () => ({
  orderSplitApi: {
    preview: podglad.fn,
    save: vi.fn(() => Promise.resolve({})),
    documents: vi.fn(() => Promise.resolve({})),
  },
}))

import { SplitDialog } from './SplitDialog'

const ODPOWIEDZ = {
  kg_calosc: 13005, kg_fv: 7995, kg_wz: 5010, odchylka: -5,
  lines: [
    { id: 'l1', recipe_name: 'KIRMIZI', kg_per_unit: 50, qty: 15, qty_invoice: 9, qty_wz: 6 },
    { id: 'l2', recipe_name: 'BEYAZ AFIYET', kg_per_unit: 40, qty: 40, qty_invoice: 25, qty_wz: 15 },
  ],
}

afterEach(cleanup)

describe('SplitDialog', () => {
  it('pokazuje podzial po wpisaniu kilogramow', async () => {
    podglad.fn.mockResolvedValue(ODPOWIEDZ)
    render(<SplitDialog orderId="o1" onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText(/na fakturę/i), { target: { value: '8000' } })
    await waitFor(() => expect(screen.getByText('7995')).toBeTruthy())
    expect(screen.getByText('5010')).toBeTruthy()
  })

  it('pokazuje odchylke od celu', async () => {
    podglad.fn.mockResolvedValue(ODPOWIEDZ)
    render(<SplitDialog orderId="o1" onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText(/na fakturę/i), { target: { value: '8000' } })
    await waitFor(() => expect(screen.getByText(/-5 kg/)).toBeTruthy())
  })

  it('przycisk 50/50 wpisuje polowe calosci', async () => {
    podglad.fn.mockResolvedValue(ODPOWIEDZ)
    render(<SplitDialog orderId="o1" onClose={() => {}} kgCalosc={13005} />)
    fireEvent.click(screen.getByRole('button', { name: /50\/50/ }))
    await waitFor(() => expect(podglad.fn).toHaveBeenCalledWith('o1', 6502.5))
  })

  it('kazda pozycja pokazuje ile na FV i ile na WZ', async () => {
    podglad.fn.mockResolvedValue(ODPOWIEDZ)
    render(<SplitDialog orderId="o1" onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText(/na fakturę/i), { target: { value: '8000' } })
    await waitFor(() => expect(screen.getByText('KIRMIZI')).toBeTruthy())
    expect(screen.getByDisplayValue('9')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/orders/split/splitDialog.test.tsx`
Expected: FAIL — nie ma `./SplitDialog`

- [ ] **Step 3: Napisz komponent**

Okno z polem „na fakturę [kg]", przyciskiem „50/50", tabelą pozycji (receptura, kg/szt, zamówione, na FV — pole edytowalne, na WZ) oraz stopką z sumami i odchyłką. Dwa przyciski: „Zapisz podział" i „Wystaw komplet dokumentów" (z checkboxem „także HDI do faktury").

- [ ] **Step 4: Podłącz przycisk na liście zamówień**

W `ClientOrdersPage.tsx`, w rzędzie przycisków obok HDI/WZ/CMR, dodaj „Podział" otwierający `SplitDialog`.

- [ ] **Step 5: Run tests**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS, tsc czysty

- [ ] **Step 6: Commit**

```bash
git add kebab_fixed/src/features/orders/split kebab_fixed/src/lib/api.ts kebab_fixed/src/pages/office/ClientOrdersPage.tsx
git commit -m "feat(zamowienia): ekran podzialu na fakture i WZ"
```

---

### Task 9: Wydruk WZ wewnętrznego i wdrożenie

**Files:**
- Modify: `src/pages/office/WzPrintPage.tsx` (dopisek dla serii WM)
- Modify: `kebab_fixed/src-tauri/Cargo.toml`, `kebab_fixed/src-tauri/tauri.conf.json` (bump wersji)

- [ ] **Step 1: Write the failing test**

```tsx
// dopisz do istniejącego testu wydruku WZ
it('WZ wewnetrzny ma dopisek, ze nie wychodzi do klienta', () => {
  render(<WzPrint doc={{ ...DOC, doc_series: 'WM', number: 'WM/1/09/26' }} />)
  expect(screen.getByText(/DOKUMENT WEWNĘTRZNY/i)).toBeTruthy()
})

it('zwykly WZ dopisku NIE ma', () => {
  render(<WzPrint doc={{ ...DOC, doc_series: 'WZ', number: 'WZ/1/09/26' }} />)
  expect(screen.queryByText(/DOKUMENT WEWNĘTRZNY/i)).toBeNull()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/pages/office/wzPrintPage.test.tsx`
Expected: FAIL — brak dopisku

- [ ] **Step 3: Dodaj dopisek na wydruku**

Gdy `doc_series === 'WM'`, wypisz nad tabelą pozycji wyraźny pasek:
`DOKUMENT WEWNĘTRZNY — NIE WYDAWAĆ KLIENTOWI`.

- [ ] **Step 4: Pełna weryfikacja przed wdrożeniem**

```bash
cd backend && TEST_DATABASE_URL=postgresql://postgres:p@localhost:55437/kebab_mes_test python3 -m pytest tests/ -q
cd .. && npx vitest run && npx tsc --noEmit
```
Expected: wszystko zielone

- [ ] **Step 5: Pre-deploy diff (REGUŁA)**

```bash
rm -rf /tmp/prodapp && mkdir /tmp/prodapp
rsync -a --exclude '__pycache__' root@91.98.105.107:/opt/kebab/app/backend/app/ /tmp/prodapp/
diff -rq /tmp/prodapp kebab_fixed/backend/app | grep -v "__pycache__\|\.bak-"
```
Expected: różnice WYŁĄCZNIE z tego wdrożenia. Cokolwiek innego = zmiana żyjąca tylko na produkcji — scommitować do main NAJPIERW.

- [ ] **Step 6: Wdrożenie i wydanie**

```bash
git push origin main            # poczekać na zielone CI
ssh root@91.98.105.107 "cd /opt/kebab/kebab_new && git pull --ff-only origin main && cd kebab_fixed && deploy/deploy.sh"
```
Potem bump wersji w OBU plikach, tag `v2.5.<n>`, poczekać na instalator i sprawdzić, że `latest.json` podaje nową wersję.

- [ ] **Step 7: Weryfikacja na danych**

```bash
ssh root@91.98.105.107 "psql '<URL>' -c \"select number, doc_series from wz_documents order by created_at desc limit 4\""
```
Expected: przy pierwszym użyciu widać `WM/1/09/26` obok `WZ/n/09/26`.

- [ ] **Step 8: Commit**

```bash
git add kebab_fixed/src/pages/office/WzPrintPage.tsx kebab_fixed/src-tauri/Cargo.toml kebab_fixed/src-tauri/tauri.conf.json
git commit -m "chore(desktop): wydanie z podzialem wysylki na fakture i WZ"
```

---

## Self-review

**Pokrycie spec:** podział równomierny → Task 1; zapis i przeżycie edycji → Task 2; osobna seria WM → Task 3; reguła „stan rusza tylko WM" → Task 4 (test wprost); CMR w dwóch wariantach → Task 5; HDI całość zawsze + FV opcjonalnie, do WZ żaden → Task 6; wystawianie przed wyjazdem → Task 7 (`split/documents` niezależne od załadunku); ekran z podglądem i ręczną korektą → Task 8; dopisek „dokument wewnętrzny" → Task 9. Regresja „bez podziału jak dziś" jest w Taskach 2, 5, 6.

**Placeholdery:** kroki z kodem mają pełny kod; Taski 4, 6, 8 opisują implementację słownie tam, gdzie sprowadza się do powtórzenia istniejącego wzorca z sąsiedniego pliku (`finalize_loading`, `generate_hdi`) — wykonawca ma wskazane miejsce do skopiowania.

**Spójność typów:** `podziel_pozycje` (Task 1) przyjmuje i zwraca `qty_invoice` jako `int`; `podglad_podzialu` (Task 2) zwraca `lines[].qty_invoice`/`qty_wz`; front (Task 8) czyta te same nazwy. `_insert_wz(..., series=)` i `format_wz_number(..., series=)` (Task 3) używane w Tasku 4. `generate_cmr(..., scope=)` i `generate_hdi(..., scope=)` z Tasków 5-6 wołane w Tasku 7.
