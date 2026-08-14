"""Przyjęcia surowca — dokument całej dostawy (numer 12/08/2026).

Partie (numery porządkowe) tworzy i edytuje `/api/raw-batches`; tutaj żyje
dokument, który je spina, i partie DOSTAWCY pod każdym numerem porządkowym.
"""
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse

from app.models.receptions import ReceptionCreate
from app.services import raw_batches_service as raw_batches_svc
from app.services import receptions_service as svc
from app.services.hdi_ocr_service import scan_hdi
from app.services.hdi_scan_store import find_attached, save_temp, scan_media_type

router = APIRouter(prefix="/api/receptions", tags=["receptions"])


# UWAGA: /next-number musi stać PRZED /{reception_id}
@router.get("/next-number")
def next_number(when: str = Query("", alias="date"),
                service: bool = Query(False)):
    """Podpowiedź numeru przyjęcia dla dnia (domyślnie dziś).

    `service=1` → własna seria przyjęć na usługę („1/08U").
    """
    return svc.next_delivery_number(when, service)


@router.post("/hdi-scan")
async def hdi_scan(file: UploadFile = File(...)):
    """Skan HDI dostawcy → pozycje do formularza.

    Nie zapisuje NICZEGO w bazie: podział na numery porządkowe jest decyzją
    operatora, a odczyt trzeba mu najpierw pokazać do sprawdzenia. Sam plik
    ląduje w poczekalni i staje się załącznikiem dopiero przy zapisie.
    """
    data = await file.read()
    out = scan_hdi(data, file.filename or "")
    # Skan zostaje jako TYMCZASOWY; trwałym załącznikiem przyjęcia staje się
    # dopiero przy zapisie. Dzięki temu porzucone próby nie zaśmiecają
    # archiwum, a przyjęty surowiec ma komplet dokumentów do kontroli.
    out["scan_id"] = save_temp(data, Path(file.filename or "").suffix)
    return out


@router.get("")
def list_receptions(
    date_from: str = Query("", alias="from"),
    date_to: str = Query("", alias="to"),
    limit: int = Query(200),
):
    return svc.list_receptions(date_from=date_from, date_to=date_to, limit=limit)


@router.post("")
def create_reception(dto: ReceptionCreate):
    """Cała dostawa naraz: dokument + wszystkie numery porządkowe."""
    return svc.create_reception(dto)


@router.post("/{reception_id}/hdi-skan")
async def hdi_scan_attach(reception_id: str, file: UploadFile = File(...)):
    """Dopina skan do przyjęcia już zapisanego (także sprzed archiwum)."""
    return svc.attach_scan(reception_id, await file.read(), file.filename or "")


@router.get("/{reception_id}/hdi-skan")
def hdi_scan_download(reception_id: str):
    """Skan HDI przypięty do przyjęcia — dokument do okazania przy kontroli."""
    rec = svc.get_reception(reception_id)
    plik = find_attached(rec.get("hdi_scan") or "")
    if not plik:
        raise HTTPException(404, "To przyjęcie nie ma wgranego skanu HDI")
    return FileResponse(
        plik, media_type=scan_media_type(plik.suffix),
        filename=f"HDI {rec['reception_no'].replace('/', '-')}{plik.suffix}")


@router.patch("/{reception_id}/cancel")
def cancel_reception(reception_id: str):
    """Anuluj CAŁĄ dostawę — wszystkie numery porządkowe tego dokumentu.

    Wszystko albo nic: ruszony choćby jeden numer → 409 i nic się nie dzieje.
    Pojedynczy numer anuluje się przez PATCH /api/raw-batches/{id}/cancel.
    """
    return raw_batches_svc.cancel_reception(reception_id)


@router.get("/{reception_id}")
def get_reception(reception_id: str):
    """Po id albo po numerze („12/08/2026")."""
    return svc.get_reception(reception_id)
