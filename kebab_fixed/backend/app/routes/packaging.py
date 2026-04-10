"""Packaging endpoints."""
from fastapi import APIRouter

from app.models.packaging import PackagingReceive
from app.services import packaging_service as svc

router = APIRouter(prefix="/api/packaging", tags=["packaging"])


@router.get("")
def list_packaging():
    return svc.list_packaging()


@router.get("/all")
def list_all_packaging():
    return svc.list_all_packaging()


@router.post("")
def receive_packaging(dto: PackagingReceive):
    return svc.receive_packaging(dto)


@router.patch("/{packaging_id}/use")
def use_packaging(packaging_id: str, body: dict):
    return svc.use_packaging(packaging_id, body)
