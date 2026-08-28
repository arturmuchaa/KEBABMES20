"""Grupy odbiorców — kilka spółek jednego kontrahenta z wspólną pulą wyrobu."""
from typing import List

from fastapi import APIRouter, Body

from app.services import client_groups_service as svc

router = APIRouter(prefix="/api/client-groups", tags=["client-groups"])


@router.get("")
def list_groups():
    return svc.list_groups()


@router.post("")
def create_group(name: str = Body(..., embed=True)):
    return svc.create_group(name)


@router.patch("/{group_id}")
def rename_group(group_id: str, name: str = Body(..., embed=True)):
    return svc.rename_group(group_id, name)


@router.put("/{group_id}/members")
def set_members(group_id: str, client_ids: List[str] = Body(..., embed=True)):
    return svc.set_members(group_id, client_ids)


@router.delete("/{group_id}")
def delete_group(group_id: str):
    return svc.delete_group(group_id)
