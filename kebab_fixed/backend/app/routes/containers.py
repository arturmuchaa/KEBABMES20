"""Saldo pojemników — API biura (RBAC: domyślne 'office')."""
from fastapi import APIRouter, Query

from app.models.containers import (
    ContainerDocCreate,
    ContainerDocFromWz,
    ContainerSettle,
    ContainerGroupCorrect,
    ContainerMovementCreate,
)
from app.services import container_docs_service as docs
from app.services import container_ledger_service as ledger
from app.services import container_partners_service as partners
from app.utils.containers import ASSET_TYPES, CALIBERS

router = APIRouter(prefix="/api/containers", tags=["containers"])


@router.get("/calibers")
def list_calibers():
    """Słownik kalibrów dla formularzy. 'none' = niekalibrowany (operator
    wpisuje liczbę pojemników ręcznie)."""
    return [
        {"value": "none" if kg is None else str(int(kg)),
         "label": "niekalibrowany" if kg is None else f"{int(kg)} kg",
         "kg": kg}
        for kg in CALIBERS
    ]


@router.get("/balances")
def list_balances(q: str = Query(""), nonzero: bool = Query(False)):
    return ledger.balances(q=q, nonzero=nonzero)


@router.get("/pending")
def list_pending(partner_id: str = Query("", alias="partnerId")):
    return ledger.pending_groups(partner_id)


@router.get("/movements")
def list_movements(
    partner_id: str = Query("", alias="partnerId"),
    date_from: str = Query("", alias="from"),
    date_to: str = Query("", alias="to"),
    unconfirmed: bool = Query(False),
):
    return ledger.movements(partner_id=partner_id, date_from=date_from,
                            date_to=date_to, unconfirmed_only=unconfirmed)


@router.post("/movements")
def create_movement(dto: ContainerMovementCreate):
    return ledger.create_manual_movement(
        dto.partner_id, dto.asset_type, dto.qty, dto.movement_date, dto.note)


@router.patch("/groups")
def correct_group(dto: ContainerGroupCorrect):
    return ledger.correct_group(dto.partner_id, dto.source_type, dto.source_id,
                                dto.targets, dto.confirm)


@router.get("/statement")
def get_statement(
    partner_id: str = Query("", alias="partnerId"),
    date_from: str = Query("", alias="from"),
    date_to: str = Query("", alias="to"),
):
    return ledger.statement(partner_id, date_from, date_to)


# IMPORTANT: statyczne ścieżki (/docs) deklarowane nad parametrycznymi
# (/partners/{id}) — stały porządek, żeby nowy endpoint nie przechwycił
# cudzej ścieżki.
@router.get("/docs")
def list_docs(partner_id: str = Query("", alias="partnerId")):
    return docs.list_docs(partner_id)


@router.post("/docs")
def create_doc(dto: ContainerDocCreate):
    return docs.create_doc(
        partner_id=dto.partner_id, ref_type=dto.ref_type, ref_id=dto.ref_id,
        doc_date=dto.doc_date, driver=dto.driver, vehicle=dto.vehicle,
        lines=[line.model_dump(by_alias=True) for line in dto.lines], notes=dto.notes,
        linked_source_type=dto.linked_source_type, linked_source_id=dto.linked_source_id)


@router.get("/docs/{doc_id}")
def get_doc(doc_id: str):
    return docs.get_doc(doc_id)


@router.patch("/docs/{doc_id}/cancel")
def cancel_doc(doc_id: str):
    return docs.cancel_doc(doc_id)


@router.patch("/docs/{doc_id}/settle")
def settle_doc(doc_id: str, dto: ContainerSettle):
    """Zwrot wpisany po powrocie kierowcy. Zamyka dokument także przy
    zwrocie częściowym — reszta zostaje na saldzie."""
    return docs.settle_doc(doc_id, dto.returns)


@router.post("/docs/from-wz")
def create_doc_from_wz(dto: ContainerDocFromWz):
    """Druk na pojemniki wystawiony wprost z WZ towaru (pusta kolumna zwrotu)."""
    return docs.create_doc_from_wz(
        wz_id=dto.wz_id, driver=dto.driver, vehicle=dto.vehicle,
        containers=dto.containers,
        pallets_h1=dto.pallets_h1, pallets_other=dto.pallets_other, notes=dto.notes)


@router.get("/partners/{partner_id}/deliveries")
def list_partner_deliveries(partner_id: str):
    """Dostawy do wskazania na dokumencie pojemnikowym (picker w oknie)."""
    return docs.partner_deliveries(partner_id)


@router.get("/partners/{partner_id}")
def get_partner(partner_id: str):
    """Kartoteka: dane partnera, saldo, ruchy, dokumenty, do rozliczenia."""
    partner = partners.get_partner(partner_id)
    bal = next((b for b in ledger.balances() if b["id"] == partner_id), None)
    return {
        "partner": partner,
        "balance": {a: (bal or {}).get(a, 0) for a in ASSET_TYPES},
        "movements": ledger.movements(partner_id=partner_id),
        "pending": ledger.pending_groups(partner_id),
        "docs": docs.list_docs(partner_id),
    }
