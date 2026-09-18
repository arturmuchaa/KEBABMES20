"""Panel masowania — mięso, pojemniki z przyprawami, wsady."""
from fastapi import APIRouter

from app.models.masownia import (
    ChargeCreate, ChargeFinish, SpiceCartCreate, SpiceWeighDto,
)
from app.services import masownia_service as svc

router = APIRouter(prefix="/api/masownia", tags=["masownia"])


@router.get("/mieso")
def list_meat():
    """Kafelki mięsa: palety z ważenia zbiorczego i partie bez palet."""
    return svc.list_meat()


@router.get("/nastepny-pp")
def nastepny_pp():
    """Podgląd kolejnego numeru partii łączonej — panel pokazuje go przed startem."""
    return {"batchNo": svc.nastepny_pp()}


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


@router.get("/wsady")
def list_charges():
    """Wsady stojące w masownicach."""
    return {"data": svc.list_charges()}


@router.get("/wsady/dzis")
def list_charges_today():
    """Dzisiejsze odbiory z masownic — historia zmiany i źródło dodruku etykiet."""
    return {"data": svc.list_charges_today()}


@router.post("/wsady")
def load_charge(dto: ChargeCreate):
    """Załaduj masownicę: pojemnik z przyprawami + mięso + woda."""
    return svc.load_charge(dto)


@router.patch("/wsady/{charge_id}/start")
def start_charge(charge_id: str):
    """Puść tę masownicę — stąd liczy się cykl masowania."""
    return svc.start_charge(charge_id)


@router.post("/wsady/start-wszystkie")
def start_all_charges():
    """Puść wszystkie załadowane masownice naraz, jednym stemplem czasu."""
    return svc.start_all_charges()


@router.patch("/wsady/{charge_id}/anuluj")
def cancel_charge(charge_id: str, reason: str = ""):
    """Cofnij załadunek — operator pomylił maszynę albo zlecenie."""
    return svc.cancel_charge(charge_id, reason)


@router.patch("/wsady/{charge_id}/odbior")
def finish_charge(charge_id: str, dto: ChargeFinish):
    """Odbiór z masownicy — kilogramy zważone paleciakiem."""
    return svc.finish_charge(charge_id, dto)
