"""Production plans endpoints."""
from typing import List, Any, Dict

from fastapi import APIRouter
from pydantic import BaseModel

from app.models.production import ProductionPlanCreate
from app.services import production_plans_service as svc

router = APIRouter(prefix="/api/production-plans", tags=["production-plans"])


class WorkerEntryDto(BaseModel):
    workerId:   str = ""
    workerName: str = ""
    pieces:     int = 0
    addedAt:    str = ""


class LineProgressDto(BaseModel):
    qty_done:       int = 0
    line_status:    str = "PLANNED"
    worker_entries: List[WorkerEntryDto] = []


class TabletFinishDto(BaseModel):
    entries: List[Dict[str, Any]] = []


@router.get("")
def list_plans():
    return svc.list_plans()


@router.post("")
def create_plan(dto: ProductionPlanCreate):
    return svc.create_plan(dto)


# Musi stać PO trasach statycznych (""), żeby nie przechwyciło ich {plan_id}.
@router.get("/{plan_id}")
def get_plan(plan_id: str):
    return svc.get_plan(plan_id)


@router.put("/{plan_id}")
def update_plan(plan_id: str, dto: ProductionPlanCreate):
    return svc.update_plan(plan_id, dto)


@router.delete("/{plan_id}")
def delete_plan(plan_id: str):
    """Usuń plan, którego nikt jeszcze nie zaczął robić (szkic albo aktywny
    bez wyprodukowanej sztuki). Rezerwacje mięsa wracają do puli."""
    return svc.delete_plan(plan_id)


@router.patch("/{plan_id}/status")
def update_plan_status(plan_id: str, body: dict):
    return svc.update_plan_status(plan_id, body.get("status", ""))


@router.patch("/{plan_id}/lines/{line_id}/progress")
def update_line_progress(plan_id: str, line_id: str, body: LineProgressDto):
    return svc.update_line_progress(
        plan_id,
        line_id,
        qty_done=body.qty_done,
        line_status=body.line_status,
        worker_entries=[e.model_dump() for e in body.worker_entries],
    )


@router.post("/{plan_id}/lines/{line_id}/move-pieces")
def move_line_pieces(plan_id: str, line_id: str, body: dict):
    """Przepisz sztuki z jednego pracownika na drugiego (pomyłka operatora).

    Postęp pozycji się nie zmienia — zmienia się tylko to, komu liczymy pracę
    (a więc i wypłatę).
    """
    return svc.move_line_pieces(
        plan_id, line_id,
        str(body.get("fromWorkerId") or ""),
        str(body.get("toWorkerId") or ""),
        int(body.get("pieces") or 0),
        by=str(body.get("by") or ""),
        to_worker_name=str(body.get("toWorkerName") or ""),
    )


@router.patch("/{plan_id}/lines/{line_id}/packaging")
def change_line_packaging(plan_id: str, line_id: str, body: dict):
    """Hala zmienia tuleję pozycji (np. METAL 65 → KARTON 65).

    Zdarza się, że metalowe skończą się w trakcie dnia. Bez tej trasy operator
    robiłby sztuki „na papierze" z tulei, której nie ma na stanie.
    """
    from app.services.line_packaging_service import change_line_packaging as zmien

    return zmien(plan_id, line_id, str(body.get("packagingId") or body.get("packaging_id") or ""))


@router.post("/{plan_id}/tablet-finish")
def tablet_finish(plan_id: str, body: TabletFinishDto):
    """Tablet zakończył produkcję — czeka na potwierdzenie biura."""
    return svc.tablet_finish(plan_id, body.entries)


@router.post("/{plan_id}/tablet-reopen")
def tablet_reopen(plan_id: str):
    """Cofa stan 'tablet zakończył'."""
    return svc.tablet_reopen(plan_id)


@router.post("/{plan_id}/office-confirm")
def office_confirm(plan_id: str):
    """Biuro potwierdza koniec produkcji — uruchamia finish_day."""
    return svc.office_confirm(plan_id)
