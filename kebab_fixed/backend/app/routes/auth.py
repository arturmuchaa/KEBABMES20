"""Endpointy uwierzytelniania."""
from fastapi import APIRouter, Header, Query, Request

from app.models.auth import ChangePasswordDto, LoginDto, LoginPinDto
from app.services import auth_service as svc

router = APIRouter(tags=["auth"])


def _token(authorization: str | None) -> str:
    if authorization and authorization.lower().startswith("bearer "):
        return authorization[7:]
    return ""


@router.post("/api/auth/login")
def login(dto: LoginDto):
    return svc.login_office(dto.login, dto.password)


@router.get("/api/auth/operators")
def operators(department: str = Query(...)):
    return svc.list_operators(department)


@router.post("/api/auth/login-pin")
def login_pin(dto: LoginPinDto):
    return svc.login_pin(dto.worker_id, dto.pin, dto.label)


@router.get("/api/auth/me")
def me(request: Request):
    # middleware już zweryfikował sesję i wstawił podmiot do request.state
    return getattr(request.state, "subject", None)


@router.post("/api/auth/logout")
def logout(authorization: str | None = Header(default=None)):
    svc.logout(_token(authorization))
    return {"ok": True}


@router.post("/api/auth/change-password")
def change_password(dto: ChangePasswordDto, request: Request):
    svc.change_password(request.state.subject, dto.old_password, dto.new_password)
    return {"ok": True}
