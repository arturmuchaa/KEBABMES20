"""Próba generalna przed wdrożeniem — ścieżka biura na KOPII produkcyjnej bazy.

POWÓD ISTNIENIA: 19.08.2026 komplet testów był zielony (1124 backendu, 750
frontu), a mimo to po wdrożeniu edycji przyjęcia korekta wagi zostawiała
rozjazd 150 kg między stanem partii a księgą ruchów — sygnatura „ducha 415".
Znalazła to dopiero ta próba: prawdziwe dane, wdrożony kod, cała droga biura
od przyjęcia do zdjęcia numeru porządkowego.

Testy jednostkowe sprawdzają REGUŁY na danych, które same sobie wymyślają.
To sprawdza, czy reguły trzymają się kupy na tym, co faktycznie stoi w bazie
zakładu — z jego dostawcami, rodzajami surowca i historią.

NIC NIE DOTYKA PRODUKCJI: pracuje na świeżej kopii (`kebab_proba`), którą sam
zakłada i kasuje. Numeracja produkcyjna zostaje nietknięta.

Uruchomienie NA SERWERZE (przed wdrożeniem albo po nim):

    bash deploy/proba_generalna.sh

albo ręcznie, gdy kopia już istnieje:

    DATABASE_URL=...kebab_proba PYTHONPATH=/opt/kebab/app/backend \
        /opt/kebab/venv/bin/python deploy/proba_generalna.py
"""
from pathlib import Path

from app.db import query_all, query_one
from app.models.receptions import ReceptionCreate, ReceptionUpdate
from app.services.receptions_service import create_reception, get_reception, update_reception

DZIEN = "2026-12-31"          # data poza bieżącą pracą zakładu
bledy: list[str] = []


def sprawdz(warunek: bool, opis: str) -> None:
    if warunek:
        print(f"   ✓ {opis}")
    else:
        print(f"   ✗ {opis}")
        bledy.append(opis)


def _stan(nr: str):
    return query_one(
        "SELECT id, kg_received, kg_available FROM raw_batches WHERE internal_batch_no=%s",
        (nr,),
    )


def _ksiega_raw(batch_id: str) -> float:
    row = query_one(
        "SELECT COALESCE(SUM(qty),0) AS q FROM stock_movements "
        "WHERE product_type='raw' AND batch_id=%s",
        (batch_id,),
    )
    return float(row["q"])


def _grupa(b, kg=None, hdi=None):
    """Grupa do PUT-a odwzorowująca istniejącą pozycję dokumentu."""
    return {
        "batchId": b["id"],
        "internalBatchNo": b["internal_batch_no"],
        "kgReceived": float(kg if kg is not None else b["kg_received"]),
        "supplierBatches": hdi if hdi is not None else [
            {"supplierBatchNo": s["supplier_batch_no"],
             "kgReceived": float(s["kg"] or 0),
             "slaughterDate": str(s["slaughter_date"] or ""),
             "expiryDate": str(s["expiry_date"] or "")}
            for s in b["supplier_batches"]
        ],
    }


def cwiartka(sup_id: str) -> None:
    """Poranek biura: dostawa ćwiartki na dwa numery porządkowe, potem korekty."""
    print("\n1. ĆWIARTKA — przyjęcie, korekta wagi, dołożenie i zdjęcie numeru")
    out = create_reception(ReceptionCreate.model_validate({
        "supplierId": sup_id, "materialTypeId": "mat-cwiartka",
        "receivedDate": DZIEN, "documentNo": "PROBA GENERALNA", "hdiNo": "99999",
        "docKg": 9000, "pricePerKg": 5.4,
        "groups": [
            # Kalibr i palety jadą PER numer porządkowy — tak wysyła je
            # formularz (nośniki liczy się na rampie przy każdym stosie).
            {"kgReceived": 4800, "containerKg": 15, "containersCount": 317,
             "palletsH1": 6, "supplierBatches": [
                {"supplierBatchNo": "P-1", "kgReceived": 2400,
                 "slaughterDate": DZIEN, "expiryDate": DZIEN},
                {"supplierBatchNo": "P-2", "kgReceived": 2400,
                 "slaughterDate": DZIEN, "expiryDate": DZIEN}]},
            {"kgReceived": 4200, "containerKg": 15, "supplierBatches": [
                {"supplierBatchNo": "P-3", "kgReceived": 4200,
                 "slaughterDate": DZIEN, "expiryDate": DZIEN}]},
        ],
    }))
    rec_id = out["reception"]["id"]
    nry = [b["internal_batch_no"] for b in out["batches"]]
    sprawdz(len(nry) == 2, f"dostawa ma dwa numery porządkowe {nry}")
    sprawdz(float(_stan(nry[0])["kg_available"]) == 4800,
            "ćwiartka trzyma stan na dostawie")

    doc = get_reception(rec_id)
    sprawdz(sum(len(b["supplier_batches"]) for b in doc["batches"]) == 3,
            "dokument oddaje pozycje HDI do formularza")
    sprawdz(all(b.get("container_kg") for b in doc["batches"]),
            "dokument niesie nośniki zwrotne (kalibr)")
    sprawdz(int(doc["batches"][0].get("containers_count") or 0) == 317,
            "ręcznie policzone pojemniki wracają w dokumencie, nie wyliczone z kalibru")

    b1, b2 = doc["batches"]
    update_reception(rec_id, ReceptionUpdate.model_validate({
        "receivedDate": DZIEN, "materialTypeId": "mat-cwiartka",
        "documentNo": "PROBA GENERALNA", "pricePerKg": 5.4,
        "groups": [_grupa(b1, kg=4650, hdi=[
            {"supplierBatchNo": "P-1", "kgReceived": 2250,
             "slaughterDate": DZIEN, "expiryDate": DZIEN},
            {"supplierBatchNo": "P-2", "kgReceived": 2400,
             "slaughterDate": DZIEN, "expiryDate": DZIEN}]),
                   _grupa(b2)],
    }))
    s1 = _stan(nry[0])
    sprawdz(float(s1["kg_received"]) == 4650, "korekta wagi zapisana (4800 → 4650)")
    sprawdz(abs(_ksiega_raw(s1["id"]) - 4650) < 0.01,
            "KSIĘGA zgadza się ze stanem po korekcie")

    doc = get_reception(rec_id)
    update_reception(rec_id, ReceptionUpdate.model_validate({
        "receivedDate": DZIEN, "materialTypeId": "mat-cwiartka",
        "documentNo": "PROBA GENERALNA", "pricePerKg": 5.4,
        "groups": [_grupa(doc["batches"][0]), _grupa(doc["batches"][1]),
                   {"kgReceived": 1500, "supplierBatches": [
                       {"supplierBatchNo": "P-4", "kgReceived": 1500,
                        "slaughterDate": DZIEN, "expiryDate": DZIEN}]}],
    }))
    doc = get_reception(rec_id)
    zywe = [b for b in doc["batches"] if b["status"] != "cancelled"]
    sprawdz(len(zywe) == 3, "dołożony numer porządkowy wszedł pod ten sam dokument")

    update_reception(rec_id, ReceptionUpdate.model_validate({
        "receivedDate": DZIEN, "materialTypeId": "mat-cwiartka",
        "documentNo": "PROBA GENERALNA", "pricePerKg": 5.4,
        "groups": [_grupa(zywe[0]), _grupa(zywe[1])],
    }))
    doc = get_reception(rec_id)
    zdjete = [b["internal_batch_no"] for b in doc["batches"] if b["status"] == "cancelled"]
    sprawdz(len(zdjete) == 1 and zdjete[0].startswith("ANUL-"),
            "zdjęty numer wrócił do puli, wiersz został w historii")


def bez_rozbioru(sup_id: str) -> None:
    """Dostawa bez rozbioru i zmiana rodzaju surowca — tu mieszka lot mięsa."""
    print("\n2. MIĘSO Z/S — przyjęcie i zmiana rodzaju surowca")
    out = create_reception(ReceptionCreate.model_validate({
        "supplierId": sup_id, "materialTypeId": "mat-mieso-zs",
        "receivedDate": DZIEN, "documentNo": "PROBA GENERALNA 2", "pricePerKg": 10,
        "groups": [{"kgReceived": 4700, "supplierBatches": [
            {"supplierBatchNo": "P-5", "kgReceived": 4700,
             "slaughterDate": DZIEN, "expiryDate": DZIEN}]}],
    }))
    rec_id, b = out["reception"]["id"], out["batches"][0]
    lot = query_one(
        "SELECT kg_available, material_name FROM meat_stock WHERE raw_batch_id=%s", (b["id"],))
    sprawdz(lot is not None and float(lot["kg_available"]) == 4700,
            "dostawa bez rozbioru trafia w całości na magazyn mięsa")

    poz = get_reception(rec_id)["batches"][0]
    update_reception(rec_id, ReceptionUpdate.model_validate({
        "receivedDate": DZIEN, "materialTypeId": "mat-filet-kurczak",
        "documentNo": "PROBA GENERALNA 2", "pricePerKg": 10,
        "groups": [_grupa(poz)],
    }))
    lot = query_one(
        "SELECT kg_available, material_name FROM meat_stock WHERE raw_batch_id=%s", (b["id"],))
    sprawdz(lot["material_name"] == "Filet z kurczaka" and float(lot["kg_available"]) == 4700,
            "zmiana z/s → filet: rodzaj idzie za dostawą, kilogramy zostają")

    update_reception(rec_id, ReceptionUpdate.model_validate({
        "receivedDate": DZIEN, "materialTypeId": "mat-cwiartka",
        "documentNo": "PROBA GENERALNA 2", "pricePerKg": 5,
        "groups": [_grupa(get_reception(rec_id)["batches"][0])],
    }))
    partia = query_one("SELECT kg_available FROM raw_batches WHERE id=%s", (b["id"],))
    lot = query_one("SELECT kg_available, status FROM meat_stock WHERE raw_batch_id=%s", (b["id"],))
    sprawdz(float(partia["kg_available"]) == 4700 and lot["status"] == "CANCELLED",
            "zmiana na ćwiartkę: lot zdjęty, kilogramy wróciły na dostawę")
    sprawdz(abs(_ksiega_raw(b["id"]) - 4700) < 0.01,
            "KSIĘGA surowca zgadza się ze stanem po zmianie rodzaju")


def _znane_rozjazdy() -> dict[str, float]:
    """Historyczne rozjazdy, o których wiemy — patrz `znane_rozjazdy.txt`.

    Bez tego próba padałaby przy każdym wdrożeniu na tych samych dwóch
    partiach sprzed poprawki i przestałaby cokolwiek znaczyć.
    """
    plik = Path(__file__).with_name("znane_rozjazdy.txt")
    znane: dict[str, float] = {}
    if not plik.exists():
        return znane
    for linia in plik.read_text(encoding="utf-8").splitlines():
        linia = linia.strip()
        if not linia or linia.startswith("#"):
            continue
        czesci = linia.split()
        if len(czesci) >= 2:
            znane[czesci[0]] = float(czesci[1])
    return znane


def ksiega_calej_bazy() -> None:
    """Kontrola całej bazy: czy stan KAŻDEJ żywej partii zgadza się z księgą.

    To jest ten test, który złapał rozjazd 150 kg. Liczy się nie to, że nowa
    dostawa się zapisała, tylko że nic w bazie nie rozjechało się po drodze.
    """
    print("\n3. KSIĘGA CAŁEJ BAZY — stan partii vs suma ruchów")
    rozjazdy = query_all(
        """
        SELECT b.internal_batch_no AS nr, b.kg_available AS stan,
               COALESCE(SUM(m.qty), 0) AS ruchy
        FROM raw_batches b
        LEFT JOIN stock_movements m ON m.batch_id = b.id AND m.product_type = 'raw'
        WHERE COALESCE(b.status,'') <> 'cancelled'
        GROUP BY b.id, b.internal_batch_no, b.kg_available
        HAVING ABS(COALESCE(SUM(m.qty), 0) - b.kg_available) > 0.01
        ORDER BY b.internal_batch_seq DESC LIMIT 10
        """)
    znane = _znane_rozjazdy()
    nowe = []
    for r in rozjazdy:
        roznica = round(float(r["ruchy"]) - float(r["stan"]), 2)
        etykieta = f"{r['nr']}: stan {float(r['stan']):.1f} kg, ruchy {float(r['ruchy']):.1f} kg"
        oczekiwana = znane.get(str(r["nr"]))
        czy_znany = oczekiwana is not None and abs(oczekiwana - roznica) < 0.01
        if czy_znany:
            print(f"     {etykieta}  (znany, historyczny)")
        else:
            # Zmieniona kwota przy znanym numerze też jest NOWYM rozjazdem —
            # znaczy, że coś ruszyło partię, która miała stać w miejscu.
            print(f"     {etykieta}  ← NOWY")
            nowe.append(etykieta)
    sprawdz(not nowe, f"brak NOWYCH rozjazdów stanu z księgą ({len(nowe)} znalezionych, "
                      f"{len(rozjazdy) - len(nowe)} znanych historycznych)")


def main() -> int:
    sup = query_one("SELECT id, name FROM suppliers WHERE name ILIKE %s LIMIT 1", ("%KOKO%",))
    if not sup:
        sup = query_one("SELECT id, name FROM suppliers ORDER BY created_at LIMIT 1")
    if not sup:
        print("✗ Kopia bazy nie ma żadnego dostawcy — czy na pewno to kopia produkcji?")
        return 1
    print(f"▶ próba generalna na kopii bazy, dostawca: {sup['name'][:34]}")

    cwiartka(sup["id"])
    bez_rozbioru(sup["id"])
    ksiega_calej_bazy()

    print()
    if bledy:
        print(f"✗ PRÓBA GENERALNA: {len(bledy)} niepowodzeń — NIE WDRAŻAJ")
        for b in bledy:
            print(f"   – {b}")
        return 1
    print("✓ PRÓBA GENERALNA PRZESZŁA — ścieżka biura działa na danych zakładu")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
