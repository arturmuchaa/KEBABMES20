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


def main() -> int:
    konto()
    dostawa(slowniki())
    print("[seed] gotowe")
    return 0


if __name__ == "__main__":
    sys.exit(main())
