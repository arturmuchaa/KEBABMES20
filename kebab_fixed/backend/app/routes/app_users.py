"""Zarządzanie kontami biura (tylko admin — egzekwuje middleware)."""
from fastapi import APIRouter

from app.models.auth import AppUserCreate, AppUserUpdate
from app.services import app_users_service as svc

router = APIRouter(tags=["app-users"])


@router.get("/api/app-users")
def list_users():
    return svc.list_users()


@router.post("/api/app-users")
def create_user(dto: AppUserCreate):
    return svc.create_user(dto)


@router.put("/api/app-users/{uid}")
def update_user(uid: str, dto: AppUserUpdate):
    return svc.update_user(uid, dto)
