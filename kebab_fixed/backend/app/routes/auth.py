"""Endpointy uwierzytelniania."""
from fastapi import APIRouter, Header, HTTPException, Query, Request, status

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


# Udostępnienie id+name aktywnych pracowników bez uwierzytelnienia jest celowe —
# ekran logowania PIN (kiosk/LAN) potrzebuje listy operatorów do wyboru.
@router.get("/api/auth/operators")
def operators(department: str = Query(...)):
    return svc.list_operators(department)


@router.post("/api/auth/login-pin")
def login_pin(dto: LoginPinDto):
    return svc.login_pin(dto.worker_id, dto.pin, dto.label)


@router.get("/api/auth/me")
def me(request: Request):
    subject = getattr(request.state, "subject", None)
    if subject is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Brak sesji")
    return subject


@router.post("/api/auth/logout")
def logout(authorization: str | None = Header(default=None)):
    svc.logout(_token(authorization))
    return {"ok": True}


@router.post("/api/auth/change-password")
def change_password(dto: ChangePasswordDto, request: Request):
    svc.change_password(request.state.subject, dto.old_password, dto.new_password)
    return {"ok": True}
