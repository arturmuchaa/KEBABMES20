"""Podpisy elektroniczne: wzór, akt podpisania, unieważnianie.

Trzy zasady, na których stoi wiarygodność:

  * `png` i `signer_name` są KOPIĄ, nie referencją — przerysowanie wzoru
    albo odejście pracownika nie może zmienić dokumentu sprzed roku;
  * `content_hash` wiąże podpis z treścią — zmiana danych po podpisaniu
    unieważnia podpis, zamiast po cichu podmienić to, pod czym ktoś się
    podpisał;
  * akt podpisania wymaga PIN-u, nie samej sesji — zalogowana przeglądarka
    znaczy tylko tyle, że ktoś ją zostawił otwartą.

Podpisującym jest ZAWSZE pracownik z kartoteki (`workers`), nigdy konto
biura: wzór powstaje na HMI rozbioru, które zna wyłącznie tę tożsamość,
a w kolumnie „Wykonał" karty HACCP ma stać człowiek, nie login systemowy.
"""
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import HTTPException

from app.auth.lockout import is_locked
from app.db import execute, query_all, query_one
from app.services.auth_service import _record_failure, _reset_failures
from app.services.signature_hash import content_hash
from app.utils.ids import cuid, now_iso
from app.utils.passwords import verify_secret

#: Rola na karcie → kolumna uprawnienia. Dwie, bo kolumny l i m karty 1.1.1
#: znaczą co innego: „wykonał" to magazynier, „sprawdził" — kierownik.
ROLE_KOLUMNA = {"wykonal": "can_sign_performed", "sprawdzil": "can_sign_checked"}

#: Wzór 600x200 px waży kilkanaście kB. Większy plik to nie podpis,
#: tylko czyjaś fotografia wysłana pomyłkowo albo złośliwie.
MAX_PNG_BYTES = 200_000

#: Na razie podpisujemy wyłącznie kontrolę przyjęcia. Mechanizm jest ogólny
#: (doc_type, doc_id) — raport rozbioru 2.1.1 i zalecenie 2.5.1 dopisują się
#: tutaj, gdy przyjdzie na nie czas.
OBSLUGIWANE_DOKUMENTY = ("reception_check",)


def _pracownik(worker_id: str) -> Dict[str, Any]:
    w = query_one("SELECT * FROM workers WHERE id=%s", (worker_id,))
    if not w or not w["active"]:
        raise HTTPException(404, "Pracownik nie istnieje lub jest nieaktywny")
    return w


def _sprawdz_pin(w: Dict[str, Any], pin: str) -> None:
    """Ta sama ścieżka co logowanie PIN-em: blokada po serii pomyłek."""
    if is_locked(w.get("locked_until"), datetime.now(tz=timezone.utc)):
        raise HTTPException(423, "Konto tymczasowo zablokowane")
    if not w.get("pin_hash") or not verify_secret(pin, w["pin_hash"]):
        _record_failure("workers", w["id"], w.get("failed_attempts") or 0)
        raise HTTPException(401, "Nieprawidłowy PIN")
    _reset_failures("workers", w["id"])


def _rola_na_kolumne(role: str) -> str:
    kolumna = ROLE_KOLUMNA.get(role)
    if not kolumna:
        raise HTTPException(422, "Nieznana rola podpisu")
    return kolumna


# ── Wzór podpisu ────────────────────────────────────────────────────
def save_sample(worker_id: str, png: str, pin: str) -> Dict[str, Any]:
    """Zapis wzoru. PIN, nie sam kod serwisowy: 0099 otwiera menu, ale nie
    upoważnia kierownika do narysowania cudzego podpisu."""
    if len(png.encode("utf-8")) > MAX_PNG_BYTES:
        raise HTTPException(413, "Wzór podpisu jest za duży")
    w = _pracownik(worker_id)
    _sprawdz_pin(w, pin)
    execute(
        """INSERT INTO signature_samples (worker_id, png, created_at)
           VALUES (%s,%s,%s)
           ON CONFLICT (worker_id) DO UPDATE
             SET png=EXCLUDED.png, created_at=EXCLUDED.created_at""",
        (worker_id, png, now_iso()),
    )
    return {"workerId": worker_id, "png": png}


def get_sample(worker_id: str) -> Optional[Dict[str, Any]]:
    row = query_one(
        "SELECT worker_id, png FROM signature_samples WHERE worker_id=%s", (worker_id,))
    return None if not row else {"workerId": row["worker_id"], "png": row["png"]}


def eligible(role: str) -> List[Dict[str, Any]]:
    """Pracownicy uprawnieni do TEJ roli i mający wzór.

    Bez wzoru nie ma czego nałożyć na kartę, więc taka osoba nie pojawia się
    na liście — dialog tłumaczy wtedy, gdzie wzór narysować.
    """
    kolumna = _rola_na_kolumne(role)
    # Nazwa kolumny pochodzi ze słownika ROLE_KOLUMNA, nie od użytkownika —
    # `_rola_na_kolumne` odrzuca wszystko spoza niego, więc interpolacja
    # nie otwiera wstrzyknięcia.
    rows = query_all(
        f"""SELECT w.id, w.name, s.png
              FROM workers w
              JOIN signature_samples s ON s.worker_id = w.id
             WHERE w.active = true AND w.{kolumna} = true
             ORDER BY w.name""")
    return [{"id": r["id"], "name": r["name"], "png": r["png"]} for r in rows]


# ── Treść podpisywana ───────────────────────────────────────────────
def current_hash(reception_id: str) -> str:
    """Hash AKTUALNEJ treści dostawy razem z wpisem kontroli.

    Kilogramy liczymy z żywych numerów porządkowych, nie z zapamiętanej
    sumy: korekta wagi po podpisaniu też ma unieważnić podpis.
    """
    row = query_one(
        """SELECT r.reception_no, r.supplier_name, r.received_date,
                  COALESCE((SELECT sum(kg_received) FROM raw_batches
                             WHERE reception_id = r.id
                               AND COALESCE(status,'') <> 'cancelled'), 0) AS kg_total,
                  c.visual, c.temp_chamber, c.temp_meat, c.kg_match, c.notes,
                  c.verdict, c.nc_description, c.nc_action, c.nc_at
             FROM receptions r
             LEFT JOIN reception_checks c ON c.reception_id = r.id
            WHERE r.id = %s""",
        (reception_id,),
    )
    if not row:
        raise HTTPException(404, "Przyjęcie nie istnieje")
    # Ten sam wiersz jako dostawa i jako kontrola: `signature_hash` wybiera
    # pola po nazwie, a nazwy z obu zestawów nie kolidują.
    return content_hash(row, row)


# ── Akt podpisania ──────────────────────────────────────────────────
def sign(doc_type: str, doc_id: str, role: str,
         worker_id: str, pin: str) -> Dict[str, Any]:
    _rola_na_kolumne(role)
    if doc_type not in OBSLUGIWANE_DOKUMENTY:
        raise HTTPException(422, "Nieobsługiwany typ dokumentu")
    kolumna = ROLE_KOLUMNA[role]

    w = _pracownik(worker_id)
    # Uprawnienie sprawdzamy PRZED PIN-em: filtr listy w interfejsie nie jest
    # kontrolą dostępu, a odmowa nie może zależeć od tego, czy ktoś zna PIN.
    if not w.get(kolumna):
        raise HTTPException(403, "Pracownik nie ma uprawnienia do tego podpisu")
    wzor = get_sample(worker_id)
    if not wzor:
        raise HTTPException(400, "Pracownik nie ma wzoru podpisu")
    _sprawdz_pin(w, pin)

    h = current_hash(doc_id)
    # Podpis pod NIEAKTUALNĄ treścią nie ma sensu — najpierw sprzątamy,
    # inaczej indeks częściowy odrzuciłby drugi aktywny podpis tej roli.
    supersede_if_changed(doc_type, doc_id, h)
    execute(
        """INSERT INTO document_signatures
             (id, doc_type, doc_id, role, worker_id, signer_name, png,
              content_hash, signed_at)
           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
        (cuid(), doc_type, doc_id, role, worker_id, w["name"], wzor["png"],
         h, now_iso()),
    )
    return {"docType": doc_type, "docId": doc_id, "role": role,
            "signerName": w["name"], "png": wzor["png"]}


def signatures_for(doc_type: str, doc_id: str) -> List[Dict[str, Any]]:
    """Tylko AKTYWNE podpisy. Unieważnione zostają w bazie jako historia,
    ale nie mają prawa trafić ani na ekran, ani na kartę."""
    rows = query_all(
        """SELECT role, signer_name, png, signed_at
             FROM document_signatures
            WHERE doc_type=%s AND doc_id=%s AND superseded_at IS NULL
            ORDER BY signed_at""",
        (doc_type, doc_id),
    )
    return [{"role": r["role"], "signerName": r["signer_name"], "png": r["png"],
             "signedAt": r["signed_at"].isoformat() if r["signed_at"] else None}
            for r in rows]


def supersede_if_changed(doc_type: str, doc_id: str, new_hash: str) -> int:
    """Unieważnia aktywne podpisy, których treść się rozjechała.

    Nie kasujemy wierszy: ślad, że ktoś podpisał POPRZEDNIĄ wersję, jest
    częścią historii dokumentu i przy sporze bywa najważniejszy. Zapis bez
    zmiany treści nie rusza niczego — biuro klika „Zapisz" także wtedy,
    gdy tylko obejrzało wpis.
    """
    rows = query_all(
        "SELECT id FROM document_signatures WHERE doc_type=%s AND doc_id=%s "
        "AND superseded_at IS NULL AND content_hash <> %s",
        (doc_type, doc_id, new_hash),
    )
    for r in rows:
        execute("UPDATE document_signatures SET superseded_at=%s WHERE id=%s",
                (now_iso(), r["id"]))
    return len(rows)
