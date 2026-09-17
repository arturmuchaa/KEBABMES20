"""Panel masowania — mięso, pojemniki z przyprawami, wsady."""
from fastapi import APIRouter

from app.models.masownia import SpiceCartCreate, SpiceWeighDto
from app.services import masownia_service as svc

router = APIRouter(prefix="/api/masownia", tags=["masownia"])


@router.get("/mieso")
def list_meat():
    """Kafelki mięsa: palety z ważenia zbiorczego i partie bez palet."""
    return svc.list_meat()


@router.get("/pojemniki")
def list_carts():
    """Pojemniki z odważonymi przyprawami, które czekają na maszynę."""
    return {"data": svc.list_carts()}


@router.post("/pojemniki")
def create_cart(dto: SpiceCartCreate):
    """Załóż pojemnik na wskazany wsad — rezerwuje kilogramy zlecenia."""
    return svc.create_cart(dto)


@router.patch("/pojemniki/{cart_id}")
def weigh_ingredient(cart_id: str, dto: SpiceWeighDto):
    """Zapisz odważony składnik (ze śladem, gdy ważony ręcznie)."""
    return svc.weigh_ingredient(cart_id, dto)


@router.delete("/pojemniki/{cart_id}")
def cancel_cart(cart_id: str):
    """Anuluj pojemnik — zwalnia numer i oddaje kilogramy zleceniu."""
    return svc.cancel_cart(cart_id)
