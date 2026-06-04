"""Endpointy wydań (dispatches)."""
from fastapi import APIRouter

from app.models.dispatches import CreateDispatchRequest, DispatchScanRequest
from app.services import dispatches_service as svc

router = APIRouter(prefix="/api/dispatches", tags=["dispatches"])


@router.post("")
def create(dto: CreateDispatchRequest):
    return svc.create_dispatch(dto.model_dump())


@router.get("/open")
def list_open():
    return svc.list_open_dispatches()


@router.get("/{dispatch_id}")
def detail(dispatch_id: str):
    return svc.dispatch_detail(dispatch_id)


@router.get("/{dispatch_id}/batch-breakdown")
def batch_breakdown(dispatch_id: str):
    return svc.dispatch_batch_breakdown(dispatch_id)


@router.post("/{dispatch_id}/scan")
def scan(dispatch_id: str, body: DispatchScanRequest):
    return svc.scan_into_dispatch(dispatch_id, body.code)


@router.post("/{dispatch_id}/remove")
def remove(dispatch_id: str, body: DispatchScanRequest):
    return svc.remove_unit(dispatch_id, body.code)


@router.post("/{dispatch_id}/close")
def close(dispatch_id: str):
    return svc.close_dispatch(dispatch_id)
