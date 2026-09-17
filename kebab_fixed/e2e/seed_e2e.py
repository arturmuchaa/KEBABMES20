"""Zasiew środowiska e2e — minimum, na którym da się przejść poranek biura.

Uruchamiane WEWNĄTRZ kontenera produkcyjnego (ma kod backendu i zależności):

    docker exec -i <kontener> python - < e2e/seed_e2e.py

Świadomie mało danych: konto biura, dostawca, rodzaje surowca i JEDNA dostawa
ćwiartki na dwa numery porządkowe. E2e ma sprawdzać, że aplikacja się składa
w całość — logowanie, trasy, zapis, odczyt — a nie odtwarzać zakład.

Dane są jawne i nieprawdziwe (login `e2e`), bo baza żyje tylko przez jeden
przebieg CI i ginie razem z kontenerem.
"""
import sys

from app.models.auth import AppUserCreate
from app.models.receptions import ReceptionCreate
from app.services.app_users_service import create_user
from app.services.receptions_service import create_reception
from app.db import execute, query_one
from app.utils.passwords import hash_secret
from app.utils.ids import cuid, now_iso

LOGIN = "e2e"
HASLO = "e2e-haslo-testowe"
DZIEN = "2026-08-20"


def konto() -> None:
    if query_one("SELECT 1 FROM app_users WHERE login=%s", (LOGIN,)):
        print("[seed] konto już jest")
        return
    create_user(AppUserCreate.model_validate({
        "login": LOGIN, "password": HASLO, "role": "office", "display_name": "Test E2E",
    }))
    print(f"[seed] konto {LOGIN} utworzone")


def slowniki() -> str:
    for mid, nazwa, rozbior in (
        ("mat-cwiartka", "Ćwiartka z kurczaka", True),
        ("mat-filet-kurczak", "Filet z kurczaka", False),
        ("mat-mieso-zs", "Mięso z/s", False),
    ):
        execute(
            "INSERT INTO raw_material_types (id, name, requires_deboning) "
            "VALUES (%s,%s,%s) ON CONFLICT (id) DO NOTHING", (mid, nazwa, rozbior))

    sup = query_one("SELECT id FROM suppliers WHERE code=%s", ("E2E",))
    if sup:
        return sup["id"]
    sid = cuid()
    execute(
        "INSERT INTO suppliers (id, code, name, display_name, created_at) "
        "VALUES (%s,%s,%s,%s,%s)",
        (sid, "E2E", "DOSTAWCA TESTOWY SPÓŁKA Z O.O.", "TESTOWY", now_iso()))
    print("[seed] dostawca i rodzaje surowca gotowe")
    return sid


def dostawa(sup_id: str) -> None:
    if query_one("SELECT 1 FROM receptions WHERE document_no=%s", ("E2E/1",)):
        print("[seed] dostawa już jest")
        return
    out = create_reception(ReceptionCreate.model_validate({
        "supplierId": sup_id, "materialTypeId": "mat-cwiartka",
        "receivedDate": DZIEN, "documentNo": "E2E/1", "hdiNo": "12345",
        "docKg": 9000, "pricePerKg": 5.4,
        "groups": [
            {"kgReceived": 4800, "containerKg": 15, "containersCount": 317,
             "palletsH1": 6, "supplierBatches": [
                 {"supplierBatchNo": "E2E-A", "kgReceived": 4800,
                  "slaughterDate": DZIEN, "expiryDate": DZIEN}]},
            {"kgReceived": 4200, "containerKg": 15, "supplierBatches": [
                {"supplierBatchNo": "E2E-B", "kgReceived": 4200,
                 "slaughterDate": DZIEN, "expiryDate": DZIEN}]},
        ],
    }))
    numery = [b["internal_batch_no"] for b in out["batches"]]
    print(f"[seed] dostawa {out['reception']['reception_no']} — numery {numery}")


def masownia() -> None:
    """Stanowisko masowni: operator, mięso na paletach i dwa zlecenia.

    Zlecenie A ma partię wskazaną przez biuro, zlecenie B nie ma żadnej —
    e2e sprawdza właśnie tę różnicę, bo na produkcji występują oba przypadki
    (8 z 12 ostatnich zleceń było bez partii).
    """
    if query_one("SELECT 1 FROM workers WHERE name=%s", ("OPERATOR MASOWNI",)):
        print("[seed] masownia już jest")
        return

    execute(
        "INSERT INTO workers (id, name, role, departments, active, pin_hash, created_at) "
        "VALUES (%s,%s,'operator',%s,true,%s,%s)",
        (cuid(), "OPERATOR MASOWNI", '["masowanie"]', hash_secret("1234"), now_iso()))

    rec_id = cuid()
    execute(
        "INSERT INTO recipes (id, name, total_output_per_100kg, shelf_life_days, active) "
        "VALUES (%s,%s,%s,%s,true) ON CONFLICT (id) DO NOTHING",
        (rec_id, "E2E KIRMIZI", 118, 5))
    ing_id = cuid()
    execute(
        "INSERT INTO ingredients (id, name, unit, active) VALUES (%s,%s,'kg',true) "
        "ON CONFLICT (id) DO NOTHING", (ing_id, "E2E PRZYPRAWA"))
    execute(
        "INSERT INTO recipe_ingredients (id, recipe_id, ingredient_id, qty_per_100kg, unit, seq) "
        "VALUES (%s,%s,%s,%s,'kg',0)", (cuid(), rec_id, ing_id, 1.5))

    # Dwie partie mięsa, po palecie na każdą — jedna trafi do planu biura,
    # druga ma zostać na ekranie wygaszona.
    loty = {}
    for lot_no, kg in (("E2E-511", 400.0), ("E2E-513", 400.0)):
        ms_id = cuid()
        execute(
            "INSERT INTO meat_stock (id, lot_no, material_type_id, material_name, kg_initial, "
            "kg_available, kg_reserved, production_date, expiry_date) "
            "VALUES (%s,%s,'mat-mieso-zs','Mięso z/s',%s,%s,0,%s,%s)",
            (ms_id, lot_no, kg, kg, DZIEN, DZIEN))
        loty[lot_no] = ms_id
        pid = cuid()
        execute(
            "INSERT INTO meat_pallets (id, pallet_no, target_kg, kg_net, containers, "
            "production_date, expiry_date) VALUES (%s,%s,200,200,13,%s,%s)",
            (pid, f"PAL/E2E/{lot_no[-3:]}", DZIEN, DZIEN))
        execute(
            "INSERT INTO meat_pallet_lots (id, pallet_id, lot_no, kg, seq) VALUES (%s,%s,%s,200,0)",
            (cuid(), pid, lot_no))

    for nr, (order_no, lot) in enumerate((
        ("MAS/E2E/1", "E2E-511"),   # biuro wskazało partię
        ("MAS/E2E/2", None),        # biuro nie wskazało nic
    ), start=1):
        oid = cuid()
        execute(
            "INSERT INTO mixing_orders (id, order_no, recipe_id, recipe_name, meat_kg, kg_done, "
            "status, day_seq, created_at) VALUES (%s,%s,%s,%s,200,0,'confirmed',%s,%s)",
            (oid, order_no, rec_id, "E2E KIRMIZI", nr, now_iso()))
        if lot:
            execute(
                "INSERT INTO mixing_order_lots (id, order_id, meat_stock_id, kg_planned) "
                "VALUES (%s,%s,%s,200)", (cuid(), oid, loty[lot]))
    print("[seed] masownia: operator (PIN 1234), 2 partie z paletami, 2 zlecenia")


def main() -> int:
    konto()
    dostawa(slowniki())
    masownia()
    print("[seed] gotowe")
    return 0


if __name__ == "__main__":
    sys.exit(main())
