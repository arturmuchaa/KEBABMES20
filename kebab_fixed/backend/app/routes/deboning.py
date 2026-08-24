"""Deboning endpoints."""
from fastapi import APIRouter, HTTPException, Query, Request

from app.models.deboning import (
    DeboningEntryCorrect,
    DeboningEntryCreate,
    DeboningEntryUpdate,
    DeboningTakeCreate,
    DeboningTakeComplete,
    DeboningTakeUpdate,
)
from app.services import deboning_service as svc
from app.services import batch_byproducts_service as byproducts_svc
from app.services import settings_service

router = APIRouter(tags=["deboning"])


# IMPORTANT: /entries/trace/{id} and /entries MUST be before /deboning/{id}
# to prevent "entries" from being captured as a path parameter.

# Tary wózków (ważenie RS232 w HMI v10): GET czyta panel hali, PUT tylko
# biuro (rozdział ról w app/auth/permissions.py).

@router.get("/api/deboning/cart-tares")
def get_cart_tares():
    return {"cartTares": settings_service.get_cart_tares()}


@router.put("/api/deboning/cart-tares")
def save_cart_tares(body: dict):
    try:
        tares = settings_service.save_cart_tares(body.get("cartTares"))
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"cartTares": tares}


# Kolejność partii na pasku HMI: hala i czyta, i ustawia (przytrzymanie kafla
# + przeciągnięcie). Trasa siedzi pod /api/deboning, bo /api/settings jest
# zarezerwowane dla biura, a to ustawienie należy do stanowiska rozbioru.

@router.get("/api/deboning/batch-order")
def get_batch_order():
    return {"order": settings_service.get_hmi_batch_order()}


@router.put("/api/deboning/batch-order")
def save_batch_order(body: dict):
    try:
        order = settings_service.save_hmi_batch_order(body.get("order"))
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"order": order}


@router.get("/api/deboning/entries/trace/{batch_id}")
def deboning_trace(batch_id: str):
    return svc.deboning_trace(batch_id)


# ── Ważenie zbiorcze produktów ubocznych (grzbiety + kości) po partii ──
@router.get("/api/deboning/byproducts/pending")
def byproducts_pending():
    return {"pending": byproducts_svc.pending()}


@router.get("/api/deboning/byproducts")
def byproducts_list():
    return {"records": byproducts_svc.list_all()}


@router.get("/api/deboning/byproducts/today")
def byproducts_today():
    return byproducts_svc.today_totals()


@router.get("/api/deboning/byproducts/weighings")
def byproducts_weighings(
    date_from: str = Query(..., alias="date_from"),
    date_to: str = Query(..., alias="date_to"),
):
    """Dziennik ważeń ubocznych (zakładki Grzbiety/Kości w biurze).
    MUSI stać przed /{raw_batch_id} — inaczej „weighings" wpadnie w parametr."""
    return byproducts_svc.list_weighings(date_from, date_to)


@router.post("/api/deboning/byproducts/weighings/correct")
def byproducts_correct_weighing(body: dict, request: Request):
    """Popraw albo usuń pojedyncze ważenie ubocznych (jedną paletę).

    Istnieje, bo dubel na dokumencie identyfikowalności nie może wymagać
    dostępu do bazy (24.08.2026 — partia 503 dostała dwie te same palety
    grzbietów minutę po sobie).

    MUSI stać przed „/{raw_batch_id}/…", inaczej „weighings" wpadnie
    w parametr ścieżki.
    """
    return byproducts_svc.correct_weighing(
        str(body.get("rawBatchId") or ""),
        str(body.get("kind") or ""),
        str(body.get("weighedAt") or ""),
        delete=bool(body.get("delete")),
        net_kg=body.get("netKg"),
        gross=body.get("grossKg"),
        containers=body.get("containers"),
        reason=str(body.get("reason") or ""),
        subject=_subject_of(request),
    )


@router.post("/api/deboning/byproducts/{raw_batch_id}/close")
def byproducts_close(raw_batch_id: str, body: dict = None):
    """Zamknij ważenie ubocznych — kafel znika z HMI, kilogramy zostają.
    Powód wymagany (ślad audytowy). Doważenie otwiera partię z powrotem."""
    body = body or {}
    return byproducts_svc.close_weighing(
        raw_batch_id, (body.get("by") or "").strip(), (body.get("reason") or "").strip()
    )


@router.post("/api/deboning/byproducts/{raw_batch_id}/reopen")
def byproducts_reopen(raw_batch_id: str):
    return byproducts_svc.reopen_weighing(raw_batch_id)


@router.get("/api/deboning/byproducts/{raw_batch_id}")
def byproducts_get(raw_batch_id: str):
    return byproducts_svc.get(raw_batch_id) or {}


@router.post("/api/deboning/byproducts/{raw_batch_id}/ensure")
def byproducts_ensure(raw_batch_id: str, body: dict = None):
    """Ważenie ubocznych W TRAKCIE rozbioru — rekord bez finished_at."""
    body = body or {}
    return byproducts_svc.ensure_record(raw_batch_id, (body.get("operator") or "").strip())


@router.post("/api/deboning/byproducts/{raw_batch_id}/finish")
def byproducts_finish(raw_batch_id: str, body: dict = None):
    body = body or {}
    return byproducts_svc.finish_batch(raw_batch_id, (body.get("operator") or "").strip())


@router.post("/api/deboning/byproducts/{raw_batch_id}/weigh")
def byproducts_weigh(raw_batch_id: str, body: dict):
    pallets = body.get("pallets") or []
    kg = float(body.get("kg") or 0)
    # Pusta lista palet = operator zdjął ostatnią. Wtedy kg=None, żeby frakcja
    # wróciła na kafel jako NIEZWAŻONA — zapisane „0 kg" udawałoby zważoną i
    # zdejmowało partię z ważenia (patrz _write_fraction).
    return byproducts_svc.record(
        raw_batch_id,
        (body.get("kind") or "").strip(),
        None if (not pallets and kg <= 0) else kg,
        pallets,
    )


@router.get("/api/deboning/stats")
def deboning_stats(
    date_from: str = Query(..., alias="date_from"),
    date_to: str = Query(..., alias="date_to"),
):
    return svc.deboning_stats(date_from, date_to)


@router.get("/api/deboning/weighings")
def list_take_weighings(
    date_from: str = Query(..., alias="date_from"),
    date_to: str = Query(..., alias="date_to"),
):
    return svc.list_take_weighings(date_from, date_to)


@router.get("/api/deboning/yield-overrides")
def yield_overrides(
    date_from: str = Query(..., alias="date_from"),
    date_to: str = Query(..., alias="date_to"),
):
    """Wpisy zapisane mimo przekroczenia pasma wydajności (kod serwisowy)."""
    return svc.yield_overrides(date_from, date_to)


@router.get("/api/deboning/worker-entries")
def worker_entries(
    worker_id: str = Query(..., alias="worker_id"),
    date_from: str = Query(None, alias="date_from"),
    date_to: str = Query(None, alias="date_to"),
):
    """Kartoteka pracownika: pobrania + porcje ważeń. Bez dat = całość."""
    return svc.worker_entries(worker_id, date_from or None, date_to or None)


@router.get("/api/deboning/entries")
def list_deboning_entries(
    session_id: str = Query(None, alias="session_id"),
    with_open_takes: bool = Query(False, alias="with_open_takes"),
    raw_batch_id: str = Query(None, alias="raw_batch_id"),
):
    return svc.list_deboning_entries(
        session_id, with_open_takes=with_open_takes, raw_batch_id=raw_batch_id
    )


@router.get("/api/deboning/panel")
def deboning_panel(limit: int = Query(60, ge=1, le=200)):
    """Panel rozbioru (biuro): partie z aktywnością rozbioru + agregaty
    do kontroli i korekt. Myśli partiami, nie dniami."""
    return {"batches": svc.deboning_panel(limit)}


def _subject_of(request: Request) -> str:
    """Kto wykonał akcję — do śladu audytowego. Pusty string = usługa
    dopisze 'kiosk' (stacja hali bywa nieuwierzytelniona per człowiek)."""
    subject = getattr(request.state, "subject", None) or {}
    return str(subject.get("username") or subject.get("id") or "")


@router.post("/api/deboning/entries")
def create_deboning_entry(dto: DeboningEntryCreate, request: Request):
    return svc.create_deboning_entry(dto, _subject_of(request))


@router.post("/api/deboning/takes")
def create_deboning_take(dto: DeboningTakeCreate):
    return svc.create_deboning_take(dto)


@router.post("/api/deboning/takes/{entry_id}/complete")
def complete_deboning_take(entry_id: str, dto: DeboningTakeComplete, request: Request):
    return svc.complete_deboning_take(entry_id, dto, _subject_of(request))


@router.post("/api/deboning/takes/{entry_id}/weigh-part")
def weigh_part_deboning_take(entry_id: str, dto: DeboningTakeComplete):
    """Częściowe ważenie mięsa — porcja na magazyn, pobranie zostaje otwarte."""
    return svc.weigh_part_deboning_take(entry_id, dto)


@router.patch("/api/deboning/takes/{entry_id}")
def update_deboning_take(entry_id: str, dto: DeboningTakeUpdate):
    return svc.update_deboning_take(entry_id, dto)


@router.patch("/api/deboning/entries/{entry_id}")
def update_deboning_entry(entry_id: str, dto: DeboningEntryUpdate, request: Request):
    subject = getattr(request.state, "subject", None) or {}
    by = str(subject.get("username") or subject.get("id") or "")
    return svc.update_deboning_entry(entry_id, dto, by)


@router.delete("/api/deboning/entries/{entry_id}")
def delete_deboning_entry(entry_id: str):
    return svc.delete_deboning_entry(entry_id)


@router.post("/api/deboning/entries/{entry_id}/change-batch")
def change_deboning_entry_batch(entry_id: str, body: dict, request: Request):
    """Korekta z biura: przenieś wpis rozbioru na inną partię surowca
    (operator wybrał złą). Wpis zostaje identyczny — zmienia się tylko partia.
    Działa TAKŻE na zmianie zatwierdzonej; zostawia ślad w historii korekt."""
    raw_batch_id = str(body.get("rawBatchId") or body.get("raw_batch_id") or "")
    if not raw_batch_id:
        raise HTTPException(400, "rawBatchId wymagane")
    subject = getattr(request.state, "subject", None) or {}
    by = str(subject.get("username") or subject.get("id") or "")
    return svc.change_deboning_entry_batch(
        entry_id, raw_batch_id, by, str(body.get("reason") or "")
    )


@router.post("/api/deboning/entries/office-add")
def office_add_deboning_entry(dto: DeboningEntryCreate, request: Request):
    """Dopisanie brakującego wpisu rozbioru Z BIURA — także do zmiany
    zatwierdzonej (operator zapomniał zważyć, biuro prostuje po fakcie).

    Osobny endpoint, a nie flaga na POST /entries, żeby ścieżka HMI została
    twardo zablokowana na zatwierdzonej zmianie. Powód obowiązkowy — wpis
    dopisany wstecz rusza akord i bilans partii.
    """
    subject = getattr(request.state, "subject", None) or {}
    by = str(subject.get("username") or subject.get("id") or "")
    reason = str(getattr(dto, "reason", "") or "")
    return svc.create_deboning_entry(dto, by, office_correction=True, reason=reason)


@router.post("/api/deboning/entries/{entry_id}/correct")
def correct_deboning_entry(entry_id: str, dto: DeboningEntryCorrect, request: Request):
    """Korekta z biura: pracownik i/lub kg — działa TAKŻE na zatwierdzonej
    zmianie (to jest jej cel). Dostęp: wyłącznie biuro (permissions.py)."""
    subject = getattr(request.state, "subject", None) or {}
    by = str(subject.get("username") or subject.get("id") or "")
    return svc.correct_deboning_entry(
        entry_id, dto.worker_id, dto.kg_quarter, dto.kg_meat, dto.reason, by,
        override_weighings=dto.override_weighings,
    )


@router.post("/api/deboning/entries/{entry_id}/office-delete")
def office_delete_deboning_entry(entry_id: str, body: dict, request: Request):
    """Usunięcie wpisu z BIURA — omija okno 15 minut, które pilnuje hali.

    Komunikat blokady na HMI od zawsze odsyłał „cofnij przez biuro", a biuro
    takiej ścieżki nie miało (prod 2026-08-14). Reszta blokad zostaje: zużyte
    mięso i rozliczone uboczne. Dostęp wyłącznie biuro (permissions.py).
    """
    subject = getattr(request.state, "subject", None) or {}
    by = str(subject.get("username") or subject.get("id") or "")
    return svc.delete_deboning_entry(
        entry_id, office_correction=True, by_subject=by,
        reason=str((body or {}).get("reason") or ""),
    )


@router.post("/api/deboning/entries/{entry_id}/hall-delete")
def hall_delete_deboning_entry(entry_id: str, body: dict, request: Request):
    """Usunięcie wpisu Z HALI — z rozpiski pobrań pracownika na HMI.

    Przycisk „Cofnij" żyje 60 s i dotyczy tylko OSTATNIEGO wpisu, więc operator,
    który zauważył pomyłkę po godzinie, nie miał już czego kliknąć. Ta ścieżka
    omija WYŁĄCZNIE limit wieku.

    Czego NIE omija: zmiany zamkniętej i zatwierdzonej (dzień domknięty prostuje
    biuro — patrz office-delete) ani blokad fizycznych, czyli zużytego mięsa
    i rozliczonych ubocznych. Ślad zostaje tak samo jak przy usunięciu z biura.
    """
    subject = getattr(request.state, "subject", None) or {}
    by = str(
        (body or {}).get("operator")
        or subject.get("username") or subject.get("id") or ""
    )
    return svc.delete_deboning_entry(entry_id, hall_correction=True, by_subject=by)


@router.get("/api/deboning/entries/{entry_id}/corrections")
def list_deboning_entry_corrections(entry_id: str):
    """Historia korekt wpisu — kto, kiedy, co na co i dlaczego."""
    return {"corrections": svc.list_entry_corrections(entry_id)}


@router.get("/api/deboning")
def list_deboning_sessions():
    return svc.list_deboning_sessions()


@router.post("/api/deboning")
def create_deboning_session_alias(dto: DeboningEntryCreate):
    return svc.create_deboning_entry(dto)
